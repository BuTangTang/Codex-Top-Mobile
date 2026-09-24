import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { type ConnectedServiceId } from '@happier-dev/protocol';

import { createTestAuth } from '../../src/testkit/auth';
import { seedCliAuthForServer } from '../../src/testkit/cliAuth';
import { createConnectedServiceProfile } from '../../src/testkit/connectedServicesRecovery';
import {
  readFakeCodexAppServerRequestLog,
  writeFakeCodexAppServerScript,
} from '../../src/testkit/codexAppServerRemoteHarness';
import { daemonControlPostJson } from '../../src/testkit/daemon/controlServerClient';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { decryptLegacyBase64Normalized } from '../../src/testkit/decryptLegacyBase64Normalized';
import { fetchJson } from '../../src/testkit/http';
import { writeTestManifestForServer } from '../../src/testkit/manifestForServer';
import { ensureCliSharedDepsBuilt } from '../../src/testkit/process/cliDist';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { fetchMessagesSince, fetchSessionV2, type SessionMessageRow } from '../../src/testkit/sessions';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({ runLabel: 'core' });

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function decodeTranscriptRecord(row: SessionMessageRow, secret: Uint8Array): UnknownRecord | null {
  const decoded = decryptLegacyBase64Normalized(row.content.c, secret);
  return asRecord(decoded);
}

function readTranscriptEventData(row: SessionMessageRow, secret: Uint8Array): UnknownRecord | null {
  const record = decodeTranscriptRecord(row, secret);
  const content = asRecord(record?.content);
  if (content?.type !== 'event') return null;
  return asRecord(content.data);
}

async function fetchSwitchAttemptEvents(params: Readonly<{
  serverBaseUrl: string;
  token: string;
  sessionId: string;
  afterSeq: number;
  secret: Uint8Array;
}>): Promise<UnknownRecord[]> {
  const rows = await fetchMessagesSince({
    baseUrl: params.serverBaseUrl,
    token: params.token,
    sessionId: params.sessionId,
    afterSeq: params.afterSeq,
  });
  return rows.flatMap((row) => {
    const event = readTranscriptEventData(row, params.secret);
    return event?.type === 'connected-service-account-switch-attempt' ? [event] : [];
  });
}

describe('core e2e: Codex connected-service auth switch projection', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop().catch(() => {});
    daemon = null;
    await server?.stop().catch(() => {});
    server = null;
  }, 60_000);

  it('persists successful rematerialized switch attempts with restart outcome semantics', async () => {
    const serviceId: ConnectedServiceId = 'openai-codex';
    const testDir = run.testDir(`connected-services-codex-auth-switch-success-${randomUUID()}`);
    server = await startServerLight({
      testDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_CONNECTED_SERVICES__ENABLED: '1',
        HAPPIER_FEATURE_CONNECTED_SERVICES_ACCOUNT_GROUPS__ENABLED: '1',
        HAPPIER_FEATURE_CONNECTED_SERVICES_ACCOUNT_FALLBACK__ENABLED: '1',
      },
    });

    const auth = await createTestAuth(server.baseUrl);
    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const workspaceDir = resolve(join(testDir, 'workspace'));
    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const secret = Uint8Array.from(randomBytes(32));
    const { serverId } = await seedCliAuthForServer({
      cliHome: daemonHomeDir,
      serverUrl: server.baseUrl,
      token: auth.token,
      secret,
    });

    await createConnectedServiceProfile({
      fixture: {
        serverBaseUrl: server.baseUrl,
        auth,
        accountSecret: secret,
      },
      serviceId,
      profileId: 'work',
      providerEmail: 'work@example.test',
      providerAccountId: 'acct-work',
    });
    await createConnectedServiceProfile({
      fixture: {
        serverBaseUrl: server.baseUrl,
        auth,
        accountSecret: secret,
      },
      serviceId,
      profileId: 'backup',
      providerEmail: 'backup@example.test',
      providerAccountId: 'acct-backup',
    });

    const requestLogPath = resolve(join(testDir, 'fake-codex-app-server.requests.jsonl'));
    const fakeAppServer = await writeFakeCodexAppServerScript({ dir: testDir, requestLogPath });

    writeTestManifestForServer({
      testDir,
      server,
      runId: run.runId,
        testName: 'connected-services-codex-auth-switch-success',
      sessionIds: [],
      env: {
        CI: process.env.CI,
        HAPPIER_HOME_DIR: daemonHomeDir,
        HAPPIER_SERVER_URL: server.baseUrl,
        HAPPIER_WEBAPP_URL: server.baseUrl,
        HAPPIER_ACTIVE_SERVER_ID: serverId,
        HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
      },
    });

    const daemonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CI: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_HOME_DIR: daemonHomeDir,
      HAPPIER_SERVER_URL: server.baseUrl,
      HAPPIER_WEBAPP_URL: server.baseUrl,
      HAPPIER_ACTIVE_SERVER_ID: serverId,
      HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
      HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '2000',
      HAPPIER_DAEMON_HEARTBEAT_INTERVAL: '5000',
      HAPPIER_CONNECTED_SERVICES_REFRESH_ENABLED: '0',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    };

    await ensureCliSharedDepsBuilt({ testDir, env: daemonEnv });
    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      env: daemonEnv,
      startupTimeoutMs: 120_000,
    });

    await waitFor(async () => {
      const list = await daemonControlPostJson({
        port: daemon!.state.httpPort,
        path: '/list',
        body: {},
        controlToken: daemon!.state.controlToken,
      });
      return list.status === 200;
    }, { timeoutMs: 20_000 });

    const requestedSessionId = `auth-switch-success-${randomUUID()}`;
    const spawn = await daemonControlPostJson<{ success?: boolean; sessionId?: unknown; error?: string }>({
      port: daemon.state.httpPort,
      path: '/spawn-session',
      controlToken: daemon.state.controlToken,
      body: {
        directory: workspaceDir,
        agent: 'codex',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        sessionId: requestedSessionId,
        terminal: { mode: 'plain' },
        codexBackendMode: 'appServer',
        environmentVariables: {
          HAPPIER_HOME_DIR: daemonHomeDir,
          HAPPIER_SERVER_URL: server.baseUrl,
          HAPPIER_WEBAPP_URL: server.baseUrl,
          HAPPIER_VARIANT: 'dev',
          HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
          HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '2000',
        },
        connectedServices: {
          v: 1,
          bindingsByServiceId: {
            [serviceId]: { source: 'connected', selection: 'profile', profileId: 'work' },
          },
        },
      },
      timeoutMs: 150_000,
    });
    expect(spawn.status).toBe(200);
    expect(spawn.data?.success).toBe(true);
    if (typeof spawn.data?.sessionId !== 'string' || spawn.data.sessionId.length === 0) {
      throw new Error(`Expected spawned session id; error=${String(spawn.data?.error)}`);
    }
    const sessionId = spawn.data.sessionId;

    const baseline = await fetchSessionV2(server.baseUrl, auth.token, sessionId);
    const baselineSeq = baseline.seq ?? 0;

    const switchResult = await daemonControlPostJson<{ ok?: boolean; result?: unknown }>({
      port: daemon.state.httpPort,
      path: '/connected-service-auth/session/switch',
      controlToken: daemon.state.controlToken,
      body: {
        sessionId,
        agentId: 'codex',
        expectedGroupGenerationByServiceId: {},
        bindings: {
          v: 1,
          bindingsByServiceId: {
            [serviceId]: { source: 'connected', selection: 'profile', profileId: 'backup' },
          },
        },
      },
      timeoutMs: 90_000,
    });

    expect(switchResult.status).toBe(200);
    expect(switchResult.data?.ok).toBe(true);
    const innerResult = asRecord(switchResult.data?.result);
    expect(innerResult).toMatchObject({
      ok: true,
    });

    await waitFor(async () => {
      const requests = await readFakeCodexAppServerRequestLog(requestLogPath);
      return requests.some((entry) => entry.method === 'account/login/start');
    }, { timeoutMs: 20_000, context: 'Codex auth switch attempts account/login/start' });

    let attemptEvents: UnknownRecord[] = [];
    await waitFor(async () => {
      attemptEvents = await fetchSwitchAttemptEvents({
        serverBaseUrl: server!.baseUrl,
        token: auth.token,
        sessionId,
        afterSeq: baselineSeq,
        secret,
      });
      return attemptEvents.length > 0;
    }, { timeoutMs: 45_000, context: 'successful auth switch attempt transcript event is committed' });

    const succeededRestartAttempt = attemptEvents.find((event) => (
      event.ok === true
      && event.action === 'restart_requested'
      && event.attemptedContinuityMode === 'restart'
      && event.outcome === 'succeeded'
      && event.outcomeAction === 'restarted'
    ));
    expect(succeededRestartAttempt).toMatchObject({
      type: 'connected-service-account-switch-attempt',
      ok: true,
      action: 'restart_requested',
      attemptedContinuityMode: 'restart',
      outcome: 'succeeded',
      outcomeAction: 'restarted',
    });
    expect(succeededRestartAttempt).not.toMatchObject({
      ok: false,
      errorCode: 'post_switch_verification_failed',
    });
  }, 360_000);
});
