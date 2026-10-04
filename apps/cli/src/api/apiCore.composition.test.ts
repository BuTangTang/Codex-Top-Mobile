import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tweetnacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';
import type { DaemonState, MachineMetadata } from './types';

const constructorEvents = vi.hoisted(() => [] as string[]);

vi.mock('expo-server-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('expo-server-sdk')>();
  // 只观察外部SDK构造边界，仍执行真实Expo初始化并保留其全部方法。
  class ObservedExpo extends actual.Expo {
    constructor(options?: ConstructorParameters<typeof actual.Expo>[0]) {
      constructorEvents.push('expo');
      super(options);
    }
  }
  return { ...actual, Expo: ObservedExpo };
});

type CapturedRequest = Readonly<{
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}>;
type FixtureResponse = Readonly<{ status?: number; body: unknown }>;
type ResponseFactory = FixtureResponse | ((request: CapturedRequest) => FixtureResponse | Promise<FixtureResponse>);

let home: string;
let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];
let responses: ResponseFactory[];

// 合成JWT只用于本地账号归属与签名证明，不代表任何真实认证。
function createJwt(accountId: string): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url'),
    '',
  ].join('.');
}

// 合成凭据的getter仅记录读取顺序；加密密钥与SDK实现保持真实。
function createCredentials(variant: 'legacy' | 'dataKey' = 'legacy', observeConstructor = false): Credentials {
  return {
    get token() {
      if (observeConstructor) constructorEvents.push('credential-token');
      return createJwt('synthetic-account');
    },
    encryption: variant === 'legacy'
      ? { type: 'legacy', secret: new Uint8Array(32).fill(1) }
      : { type: 'dataKey', publicKey: tweetnacl.box.keyPair().publicKey, machineKey: new Uint8Array(32).fill(2) },
  };
}

// 元数据全部位于独立临时HOME，不引用真实用户路径或账号状态。
function createMetadata(): MachineMetadata {
  return {
    host: 'synthetic-host',
    platform: 'synthetic-platform',
    happyCliVersion: 'synthetic-version',
    homeDir: home,
    happyHomeDir: home,
    happyLibDir: join(home, 'lib'),
  };
}

// 本地relay用真实加密函数回传机器快照，以验证请求和解密契约。
async function createMachineResponse(credentials: Credentials, machineId: string, extra: Record<string, unknown> = {}): Promise<FixtureResponse> {
  const { encrypt, encodeBase64 } = await import('./encryption');
  const key = credentials.encryption.type === 'legacy' ? credentials.encryption.secret : credentials.encryption.machineKey;
  const daemonState: DaemonState = { status: 'running', pid: 12345 };
  return {
    body: {
      machine: {
        id: machineId,
        metadata: encodeBase64(encrypt(key, credentials.encryption.type, createMetadata())),
        metadataVersion: 3,
        daemonState: encodeBase64(encrypt(key, credentials.encryption.type, daemonState)),
        daemonStateVersion: 5,
      },
      ...extra,
    },
  };
}

// 请求只抵达本测试127.0.0.1服务器；原Axios、身份存储与候选消费都不替换。
async function startRelayFixture(): Promise<void> {
  requests = [];
  responses = [];
  server = createServer(async (request, response) => {
    try {
      let rawBody = '';
      for await (const chunk of request) rawBody += String(chunk);
      const captured: CapturedRequest = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {},
      };
      requests.push(captured);
      const queued = responses.shift();
      const result = typeof queued === 'function' ? await queued(captured) : queued;
      response.writeHead(result?.status ?? (result ? 200 : 500), { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result?.body ?? { error: 'unexpected_synthetic_request' }));
    } catch {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'synthetic_fixture_failure' }));
    }
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic relay has no TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe('ApiClientCore composition', () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'happier-api-core-'));
    await startRelayFixture();
    vi.stubEnv('HAPPIER_HOME_DIR', home);
    vi.stubEnv('HAPPIER_ACTIVE_SERVER_ID', 'synthetic');
    vi.stubEnv('HAPPIER_SERVER_URL', baseUrl);
    vi.stubEnv('HAPPIER_WEBAPP_URL', baseUrl);
    vi.stubEnv('HAPPIER_LOCAL_SERVER_URL', '');
    vi.stubEnv('HAPPIER_PUBLIC_SERVER_URL', '');
    vi.stubEnv('HTTP_PROXY', '');
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('ALL_PROXY', '');
    vi.stubEnv('NO_PROXY', '*');
    vi.resetModules();
    constructorEvents.length = 0;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('preserves default connected-service then push construction and initializes only push in Core', async () => {
    const { ApiClient } = await import('./api');
    const { ApiClientCore } = await import('./apiCore');
    const { configuration } = await import('@/configuration');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const api = await ApiClient.create(createCredentials('legacy', true));
    expect(constructorEvents).toEqual(['credential-token', 'credential-token', 'expo']);
    expect(api).toBeInstanceOf(ApiClient);
    expect(api.push()).toBe(api.push());
    constructorEvents.length = 0;
    const core = new ApiClientCore(createCredentials('legacy', true));
    expect(constructorEvents).toEqual(['credential-token', 'expo']);
    expect(core.push()).toBe(core.push());
    expect(requests).toEqual([]);
    expect(interval).not.toHaveBeenCalled();
    expect(existsSync(configuration.installationIdentityFile)).toBe(false);
  });

  it.each(['legacy', 'dataKey'] as const)('keeps real %s registration encryption and decrypted snapshots through Core and default API', async (variant) => {
    const credentials = createCredentials(variant);
    const { ApiClient } = await import('./api');
    const { ApiClientCore } = await import('./apiCore');
    const { decrypt, decodeBase64, encodeBase64 } = await import('./encryption');
    const { MachineRegistrationIdentitySchema } = await import('./types');
    const { verifyMachineInstallationProof } = await import('@happier-dev/protocol');
    const metadata = createMetadata();
    const daemonState: DaemonState = { status: 'running', pid: 12345 };
    const clients = [new ApiClientCore(credentials), await ApiClient.create(credentials)];
    for (const client of clients) {
      responses.push(await createMachineResponse(credentials, 'synthetic-machine'));
      const machine = await client.getOrCreateMachine({ machineId: 'synthetic-machine', metadata, daemonState, timeoutMs: 2_000 });
      expect(machine).toEqual(expect.objectContaining({
        id: 'synthetic-machine', metadata, daemonState, metadataVersion: 3, daemonStateVersion: 5,
        encryptionVariant: variant,
      }));
      const key = credentials.encryption.type === 'legacy' ? credentials.encryption.secret : credentials.encryption.machineKey;
      expect(machine.encryptionKey).toBe(key);
      const captured = requests.at(-1)!;
      expect(captured.method).toBe('POST');
      expect(captured.path).toBe('/v1/machines');
      expect(captured.headers.authorization).toBe(`Bearer ${credentials.token}`);
      expect(decrypt(key, variant, decodeBase64(captured.body.metadata as string))).toEqual(metadata);
      expect(decrypt(key, variant, decodeBase64(captured.body.daemonState as string))).toEqual(daemonState);
      const registrationIdentity = MachineRegistrationIdentitySchema.parse(captured.body);
      expect(verifyMachineInstallationProof({
        payload: {
          version: 1,
          installationId: registrationIdentity.installationId,
          machineId: 'synthetic-machine',
          accountId: 'synthetic-account',
          ...(variant === 'dataKey' ? { contentPublicKeyFingerprint: registrationIdentity.contentPublicKeyFingerprint } : {}),
        },
        proof: registrationIdentity.installationProof,
        publicKey: registrationIdentity.installationPublicKey,
      })).toBe(true);
      if (credentials.encryption.type === 'dataKey') {
        expect(captured.body.contentPublicKey).toBe(encodeBase64(credentials.encryption.publicKey));
        expect(captured.body.dataEncryptionKey).toBeTypeOf('string');
      } else {
        expect(captured.body.contentPublicKey).toBeUndefined();
        expect(captured.body.dataEncryptionKey).toBeUndefined();
      }
    }
    expect(requests).toHaveLength(2);
  });

  it.each(['missing', 'acknowledged', 'already-applied'] as const)('consumes replacement candidate only with %s server proof', async (proof) => {
    const credentials = createCredentials();
    const { ApiClientCore } = await import('./apiCore');
    const candidates = await import('@/daemon/machineIdentity/machineReplacementCandidates');
    await candidates.recordMachineReplacementCandidateForActiveServer({
      accountId: 'synthetic-account', machineId: 'synthetic-old', replacementReason: 'reauth', now: 1,
    });
    responses.push(await createMachineResponse(credentials, 'synthetic-new', proof === 'acknowledged'
      ? { machineReplacement: { status: 'applied', replacesMachineId: 'synthetic-old' } } : {}));
    if (proof !== 'acknowledged') {
      responses.push(proof === 'already-applied'
        ? { body: { machine: { replacedByMachineId: 'synthetic-new' } } }
        : { status: 404, body: { error: 'machine_not_found' } });
    }
    await new ApiClientCore(credentials).getOrCreateMachine({ machineId: 'synthetic-new', metadata: createMetadata(), timeoutMs: 2_000 });
    const candidate = await candidates.readMachineReplacementCandidateForActiveServer({ accountId: 'synthetic-account' });
    expect(candidate).toEqual(proof === 'missing' ? {
      machineId: 'synthetic-old', replacementReason: 'reauth', createdAt: 1,
    } : null);
    expect(requests[0].body).toEqual(expect.objectContaining({ replacesMachineId: 'synthetic-old', replacementReason: 'reauth' }));
    expect(requests.map(request => `${request.method} ${request.path}`)).toEqual(proof === 'acknowledged'
      ? ['POST /v1/machines'] : ['POST /v1/machines', 'GET /v1/machines/synthetic-old']);
  });

  it.each([
    { status: 409, body: { error: 'machine_id_conflict' }, name: 'MachineIdConflictError' },
    { status: 410, body: { error: 'machine_revoked' }, name: 'MachineRevokedError' },
    { status: 410, body: { error: 'machine-replaced', replacementMachineId: 'synthetic-replacement' }, name: 'MachineReplacedError' },
    { status: 400, body: { error: 'invalid-params', reason: 'content_public_key_mismatch' }, name: 'MachineContentPublicKeyMismatchError' },
  ])('keeps $name constructor and does not add registration retries', async (failure) => {
    const { ApiClientCore } = await import('./apiCore');
    const publicApi = await import('./api');
    const errors = await import('./machine/machineRegistrationErrors');
    responses.push({ status: failure.status, body: failure.body });
    const caught = await new ApiClientCore(createCredentials()).getOrCreateMachine({
      machineId: 'synthetic-machine', metadata: createMetadata(),
    }).catch(error => error as Error);
    const constructor = errors[failure.name as keyof typeof errors];
    expect(Object.getPrototypeOf(caught).constructor).toBe(constructor);
    expect(publicApi[failure.name as keyof typeof publicApi]).toBe(constructor);
    expect(caught).toEqual(expect.objectContaining({ name: failure.name, machineId: 'synthetic-machine' }));
    expect(requests).toHaveLength(1);
  });

  it('uses the existing recovery owner for one rotation and confirmed replacement', async () => {
    const credentials = createCredentials();
    const { ApiClientCore } = await import('./apiCore');
    const { ensureMachineRegistered } = await import('./machine/ensureMachineRegistered');
    const { configuration } = await import('@/configuration');
    const { updateSettings, readSettings } = await import('@/persistence');
    const candidates = await import('@/daemon/machineIdentity/machineReplacementCandidates');
    await updateSettings(settings => ({
      ...settings,
      machineIdByServerId: { [configuration.activeServerId]: 'synthetic-old' },
      lastTokenSubByServerId: { [configuration.activeServerId]: 'synthetic-account' },
      machineIdByServerIdByAccountId: { [configuration.activeServerId]: { 'synthetic-account': 'synthetic-old' } },
    }));
    responses.push({ status: 409, body: { error: 'machine_id_conflict' } });
    responses.push(async request => createMachineResponse(credentials, request.body.id as string, {
      machineReplacement: { status: 'applied', replacesMachineId: 'synthetic-old' },
    }));
    const result = await ensureMachineRegistered({
      api: new ApiClientCore(credentials), machineId: 'synthetic-old', metadata: createMetadata(),
      recoveryLogger: { info: () => {} },
    });
    expect(result.didRotateMachineId).toBe(true);
    expect(result.machineId).not.toBe('synthetic-old');
    expect(result.machine.id).toBe(result.machineId);
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toEqual(expect.objectContaining({
      id: result.machineId, replacesMachineId: 'synthetic-old', replacementReason: 'rotation',
    }));
    expect((await readSettings()).machineIdByServerIdByAccountId?.[configuration.activeServerId]?.['synthetic-account']).toBe(result.machineId);
    expect(await candidates.readMachineReplacementCandidateForActiveServer({ accountId: 'synthetic-account' })).toBeNull();
  });

  it('retains the same push client and local API endpoint with public URL configured', async () => {
    vi.stubEnv('HAPPIER_PUBLIC_SERVER_URL', 'https://synthetic-public.invalid');
    const { ApiClientCore } = await import('./apiCore');
    const credentials = createCredentials();
    const core = new ApiClientCore(credentials);
    responses.push({ body: { tokens: [{ id: 'synthetic-push', token: 'ExponentPushToken[synthetic]', createdAt: 1, updatedAt: 1 }] } });
    expect(await core.push().fetchPushTokens()).toEqual([{ id: 'synthetic-push', token: 'ExponentPushToken[synthetic]', createdAt: 1, updatedAt: 1 }]);
    expect(core.push()).toBe(core.push());
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/v1/push-tokens');
    expect(requests[0].headers.authorization).toBe(`Bearer ${credentials.token}`);
  });
});
