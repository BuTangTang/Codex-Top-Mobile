import axios from 'axios';
import { logger } from '@/ui/logger';
import type { Credentials } from '@/persistence';
import type { DaemonState, Machine, MachineMetadata, MachineRegistrationIdentity } from './types';
import { MachineRegistrationIdentitySchema } from './types';
import { decodeBase64, encodeBase64, encrypt, decrypt } from './encryption';
import { PushNotificationClient } from './pushNotifications';
import { configuration } from '@/configuration';
import { resolveMachineEncryptionContext } from './client/encryptionKey';
import { resolveServerHttpBaseUrl } from './client/serverHttpBaseUrl';
import { shouldTreatGetOrCreateMachineErrorAsOffline } from './client/offlineErrors';
import { resolveMachineRegistrationIdentity } from '@/daemon/machineIdentity/resolveMachineRegistrationIdentity';
import { consumeMachineReplacementCandidateAfterRegistration } from '@/daemon/machineIdentity/machineReplacementCandidates';
import {
  MachineIdConflictError,
  MachineRevokedError,
  MachineReplacedError,
  MachineContentPublicKeyMismatchError,
} from './machine/machineRegistrationErrors';

function didServerAcknowledgeMachineReplacement(
  data: unknown,
  expectedReplacesMachineId: string,
): boolean {
  const object = typeof data === 'object' && data !== null ? data as Record<string, unknown> : null;
  const replacement = object && typeof object.machineReplacement === 'object' && object.machineReplacement !== null
    ? object.machineReplacement as Record<string, unknown>
    : null;
  if (!replacement) return false;

  const status = replacement.status;
  if (status !== 'applied' && status !== 'alreadyApplied') return false;

  const acknowledgedMachineId = replacement.replacesMachineId ?? replacement.replacedMachineId;
  if (acknowledgedMachineId === undefined || acknowledgedMachineId === null) return true;
  return typeof acknowledgedMachineId === 'string' && acknowledgedMachineId.trim() === expectedReplacesMachineId;
}

function doesMachineRowPointAtReplacement(data: unknown, expectedReplacementMachineId: string): boolean {
  const object = typeof data === 'object' && data !== null ? data as Record<string, unknown> : null;
  const machine = object && typeof object.machine === 'object' && object.machine !== null
    ? object.machine as Record<string, unknown>
    : null;
  return machine?.replacedByMachineId === expectedReplacementMachineId;
}

function readReplacementMachineId(value: unknown): string | null {
  const object = readRecord(value);
  const candidate = object?.replacedByMachineId ?? object?.replacementMachineId;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function readResponseErrorCode(value: unknown): string | null {
  const error = readRecord(value)?.error;
  return typeof error === 'string' ? error : null;
}

function isMachineReplacedResponseErrorCode(error: string | null): boolean {
  return error === 'machine_replaced' || error === 'machine-replaced';
}

// 机器HTTP注册与推送的唯一owner；默认API保留其它能力并继承同一实现。
export class ApiClientCore {
  protected readonly credential: Credentials;
  protected readonly pushClient: PushNotificationClient;

  // 保留同一凭据对象和原推送初始化，不增加认证、网络请求或重试。
  constructor(credential: Credentials) {
    this.credential = credential;
    this.pushClient = new PushNotificationClient(credential.token, resolveServerHttpBaseUrl());
  }

  /**
   * Register or update machine with the server
   * Returns the current machine state from the server with decrypted metadata and daemonState
   */
  async getOrCreateMachine(opts: {
    machineId: string,
    metadata: MachineMetadata,
    daemonState?: DaemonState,
    timeoutMs?: number,
    registrationIdentity?: MachineRegistrationIdentity,
  }): Promise<Machine> {
    const { encryptionKey, encryptionVariant, dataEncryptionKey } = resolveMachineEncryptionContext(this.credential);
    const registrationIdentity = opts.registrationIdentity
      ? MachineRegistrationIdentitySchema.parse(opts.registrationIdentity)
      : await this.resolveMachineRegistrationIdentity(opts.machineId);
    const machinesUrl = `${resolveServerHttpBaseUrl()}/v1/machines`;

    // Create machine
    try {
      const timeoutMs =
        typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
          ? Math.floor(opts.timeoutMs)
          : 60_000;
      const response = await axios.post(
        machinesUrl,
        {
          id: opts.machineId,
          metadata: encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.metadata)),
          daemonState: opts.daemonState ? encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.daemonState)) : undefined,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : undefined,
          contentPublicKey:
            this.credential.encryption.type === 'dataKey'
              ? encodeBase64(this.credential.encryption.publicKey)
              : undefined,
          ...(registrationIdentity
            ? {
                installationId: registrationIdentity.installationId,
                installationPublicKey: registrationIdentity.installationPublicKey,
                installationProof: registrationIdentity.installationProof,
                replacesMachineId: registrationIdentity.replacesMachineId,
                replacementReason: registrationIdentity.replacementReason,
                contentPublicKeyFingerprint: registrationIdentity.contentPublicKeyFingerprint,
              }
            : null),
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs
        }
      );


      const raw = response.data.machine;
      const replacementMachineId = readReplacementMachineId(raw);
      if (replacementMachineId) {
        throw new MachineReplacedError(opts.machineId, replacementMachineId);
      }
      logger.debug(`[API] Machine ${opts.machineId} registered/updated with server`);
      const didAcknowledgeReplacement = registrationIdentity?.replacesMachineId
        ? didServerAcknowledgeMachineReplacement(response.data, registrationIdentity.replacesMachineId)
          || await this.didServerAlreadyApplyMachineReplacement({
            replacesMachineId: registrationIdentity.replacesMachineId,
            replacementMachineId: opts.machineId,
            timeoutMs,
          })
        : false;
      if (
        registrationIdentity?.replacementCandidateAccountId
        && registrationIdentity.replacesMachineId
        && didAcknowledgeReplacement
      ) {
        await consumeMachineReplacementCandidateAfterRegistration({
          accountId: registrationIdentity.replacementCandidateAccountId,
          didRegister: true,
          replacesMachineId: registrationIdentity.replacesMachineId,
        });
      }

      // Return decrypted machine like we do for sessions
      const machine: Machine = {
        id: raw.id,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: raw.metadata ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.metadata)) : null,
        metadataVersion: raw.metadataVersion || 0,
        daemonState: raw.daemonState ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.daemonState)) : null,
        daemonStateVersion: raw.daemonStateVersion || 0,
      };
      return machine;
    } catch (error) {
      if (
        axios.isAxiosError(error)
        && error.response?.status === 409
        && readResponseErrorCode(error.response.data) === 'machine_id_conflict'
      ) {
        throw new MachineIdConflictError(opts.machineId);
      }

      if (
        axios.isAxiosError(error)
        && error.response?.status === 410
        && readResponseErrorCode(error.response.data) === 'machine_revoked'
      ) {
        throw new MachineRevokedError(opts.machineId);
      }

      if (
        axios.isAxiosError(error)
        && error.response?.status === 410
        && isMachineReplacedResponseErrorCode(readResponseErrorCode(error.response.data))
      ) {
        throw new MachineReplacedError(opts.machineId, readReplacementMachineId(error.response.data));
      }

      if (axios.isAxiosError(error) && error.response?.status === 400) {
        const body = readRecord(error.response.data);
        const reason = typeof body?.reason === 'string' ? body.reason : '';
        if (body?.error === 'invalid-params' && reason === 'content_public_key_mismatch') {
          // Do not retry: this indicates a credentials/key mismatch, not a transient network failure.
          throw new MachineContentPublicKeyMismatchError(opts.machineId, reason);
        }
      }

      if (shouldTreatGetOrCreateMachineErrorAsOffline(error, { url: machinesUrl })) {
        // Fail closed: callers must not treat a registration failure as a usable machine identity.
        throw error;
      }

      // For other errors, rethrow
      throw error;
    }
  }

  private async resolveMachineRegistrationIdentity(machineId: string): Promise<MachineRegistrationIdentity | undefined> {
    if (!configuration.installationIdentityFile) return undefined;
    const identity = await resolveMachineRegistrationIdentity({
      machineId,
      token: this.credential.token,
      contentPublicKey: this.credential.encryption.type === 'dataKey'
        ? this.credential.encryption.publicKey
        : undefined,
    });
    return {
      installationId: identity.installationId,
      installationPublicKey: identity.installationPublicKey,
      installationProof: identity.installationProof,
      ...(identity.replacesMachineId ? { replacesMachineId: identity.replacesMachineId } : null),
      ...(identity.replacementReason ? { replacementReason: identity.replacementReason } : null),
      ...(identity.contentPublicKeyFingerprint ? { contentPublicKeyFingerprint: identity.contentPublicKeyFingerprint } : null),
      ...(identity.replacementCandidateAccountId ? { replacementCandidateAccountId: identity.replacementCandidateAccountId } : null),
    };
  }

  private async didServerAlreadyApplyMachineReplacement(opts: Readonly<{
    replacesMachineId: string;
    replacementMachineId: string;
    timeoutMs: number;
  }>): Promise<boolean> {
    try {
      const response = await axios.get(
        `${resolveServerHttpBaseUrl()}/v1/machines/${encodeURIComponent(opts.replacesMachineId)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json',
          },
          timeout: opts.timeoutMs,
        },
      );
      return doesMachineRowPointAtReplacement(response.data, opts.replacementMachineId);
    } catch {
      return false;
    }
  }

  push(): PushNotificationClient {
    return this.pushClient;
  }

}
