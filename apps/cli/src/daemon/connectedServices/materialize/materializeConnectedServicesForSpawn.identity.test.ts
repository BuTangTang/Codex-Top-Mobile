import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { materializeConnectedServicesForSpawn } from './materializeConnectedServicesForSpawn';
import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';

describe('materializeConnectedServicesForSpawn materialization identity', () => {
  it('uses the stable materialization identity instead of the transient spawn key for provider-local auth homes', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-identity-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-identity-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 10,
      serviceId: 'anthropic',
      profileId: 'work',
      kind: 'token',
      token: {
        token: 'sk-ant-test',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const identity = {
      v: 1,
      id: 'csm_stable_pi_1',
      createdAtMs: 123,
    } as const;
    const params = {
      agentId: 'pi',
      materializationKey: 'spawn-transient-1',
      connectedServiceMaterializationIdentityV1: identity,
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['anthropic', record]]),
    } satisfies Parameters<typeof materializeConnectedServicesForSpawn>[0] & {
      connectedServiceMaterializationIdentityV1: typeof identity;
    };

    const result = await materializeConnectedServicesForSpawn(params);

    expect(result).not.toBeNull();
    expect(result!.env.PI_CODING_AGENT_DIR).toBe(
      join(baseDir, identity.id, 'pi', 'pi-agent-dir'),
    );
    await expect(readFile(join(result!.env.PI_CODING_AGENT_DIR, 'auth.json'), 'utf8')).resolves.toContain('sk-ant-test');
  });

  it('isolates Codex auth homes by materialization identity for the same connected-service profile', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-codex-identity-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-codex-identity-'));
    const sourceCodexHome = await mkdtemp(join(tmpdir(), 'happier-source-codex-home-codex-identity-'));
    await writeFile(join(sourceCodexHome, 'config.toml'), 'model = "gpt-5.2-codex"\n');
    await mkdir(join(sourceCodexHome, 'sessions'), { recursive: true });
    await writeFile(join(sourceCodexHome, 'sessions', 'rollout-source.jsonl'), '{}\n');

    const firstRecord = buildConnectedServiceCredentialRecord({
      now: 10,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: null,
      oauth: {
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        idToken: 'id-one',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });
    const secondRecord = buildConnectedServiceCredentialRecord({
      now: 20,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: null,
      oauth: {
        accessToken: 'access-two',
        refreshToken: 'refresh-two',
        idToken: 'id-two',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const firstIdentity = { v: 1, id: 'csm_codex_one', createdAtMs: 1 } as const;
    const secondIdentity = { v: 1, id: 'csm_codex_two', createdAtMs: 2 } as const;

    const first = await materializeConnectedServicesForSpawn({
      agentId: 'codex',
      materializationKey: 'transient-one',
      connectedServiceMaterializationIdentityV1: firstIdentity,
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['openai-codex', firstRecord]]),
      processEnv: {
        CODEX_HOME: sourceCodexHome,
        HOME: tmpdir(),
      },
    });
    const second = await materializeConnectedServicesForSpawn({
      agentId: 'codex',
      materializationKey: 'transient-two',
      connectedServiceMaterializationIdentityV1: secondIdentity,
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['openai-codex', secondRecord]]),
      processEnv: {
        CODEX_HOME: sourceCodexHome,
        HOME: tmpdir(),
      },
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.env.CODEX_HOME).toBe(join(baseDir, firstIdentity.id, 'codex', 'codex-home'));
    expect(second!.env.CODEX_HOME).toBe(join(baseDir, secondIdentity.id, 'codex', 'codex-home'));
    expect(first!.env.CODEX_HOME).not.toBe(second!.env.CODEX_HOME);
    expect(first!.env[HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]).toBe(
      join(baseDir, firstIdentity.id, 'codex'),
    );
    expect(second!.env[HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]).toBe(
      join(baseDir, secondIdentity.id, 'codex'),
    );

    const firstAuth = JSON.parse(await readFile(join(first!.env.CODEX_HOME!, 'auth.json'), 'utf8'));
    const secondAuth = JSON.parse(await readFile(join(second!.env.CODEX_HOME!, 'auth.json'), 'utf8'));
    expect(firstAuth.refresh_token).toBe('refresh-one');
    expect(secondAuth.refresh_token).toBe('refresh-two');
    await expect(readFile(join(first!.env.CODEX_HOME!, 'sessions', 'rollout-source.jsonl'), 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(join(second!.env.CODEX_HOME!, 'sessions', 'rollout-source.jsonl'), 'utf8')).resolves.toBe('{}\n');
  });
});
