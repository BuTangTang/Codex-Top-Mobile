import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ConnectedServiceQuotaSnapshotV1Schema,
  type ConnectedServiceId,
  type ConnectedServiceQuotaSnapshotV1,
} from '@happier-dev/protocol';

import {
  readFakeCodexAppServerRequestLog,
  writeFakeCodexAppServerScript,
  type FakeCodexAppServerRequest,
} from '../../src/testkit/codexAppServerRemoteHarness';
import {
  spawnConnectedCodexGroupAppServerSession,
  startConnectedServicesCodexDaemon,
  startFakeTokenServer,
  type StartedConnectedServicesCodexDaemonFixture,
} from '../../src/testkit/connectedServicesCodexDaemon';
import {
  asRecord,
  createConnectedServiceAuthGroup,
  createConnectedServiceProfile,
  fetchConnectedServiceAuthGroup,
  fetchConnectedServiceProfiles,
  postConnectedServiceQuotaSnapshot,
} from '../../src/testkit/connectedServicesRecovery';
import {
  enqueueSessionPromptForScenario,
  waitForAssistantMessageContaining,
  waitForSessionActive,
} from '../../src/testkit/providers/scenarios/sessionRuntime';
import { createRunDirs } from '../../src/testkit/runDir';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({
  runLabel: 'core',
  ...(process.env.HAPPIER_E2E_LOGS_DIR ? { logsDir: process.env.HAPPIER_E2E_LOGS_DIR } : {}),
});

const SERVICE_ID = 'openai-codex' satisfies ConnectedServiceId;
const WORK_PROFILE_ID = 'work';
const BACKUP_PROFILE_ID = 'backup';
const WORK_ACCOUNT_ID = 'acct-1';
const BACKUP_ACCOUNT_ID = 'acct-backup';
const ACCOUNT_EMAILS = {
  [WORK_ACCOUNT_ID]: 'work@example.test',
  [BACKUP_ACCOUNT_ID]: 'backup@example.test',
} as const;
const APP_SERVER_REQUEST_TIMEOUT_MS = 90_000;
const SLOW_DAEMON_FANOUT_TIMEOUT_MS = 420_000;
const BUSY_SIBLING_TURN_DELAY_MS = 45_000;

type FakeAppServer = Readonly<{
  label: string;
  dir: string;
  requestLogPath: string;
  fakeAppServerPath: string;
}>;

const activeStops: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (activeStops.length > 0) {
    const stop = activeStops.pop();
    if (!stop) continue;
    await stop().catch(() => {});
  }
});

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function createFakeAppServer(testDir: string, label: string): Promise<FakeAppServer> {
  const dir = join(testDir, `fake-codex-${label}`);
  await mkdir(dir, { recursive: true });
  const requestLogPath = join(dir, 'requests.jsonl');
  const fakeAppServerPath = await writeFakeCodexAppServerScript({ dir, requestLogPath });
  return { label, dir, requestLogPath, fakeAppServerPath };
}

async function startFixture(testName: string): Promise<Readonly<{
  testDir: string;
  fixture: StartedConnectedServicesCodexDaemonFixture;
}>> {
  const testDir = run.testDir(testName);
  const tokenServer = await startFakeTokenServer({
    respond: () => ({
      status: 200,
      body: {
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    }),
  });
  activeStops.push(tokenServer.stop);

  const fixture = await startConnectedServicesCodexDaemon({
    testDir,
    testName,
    tokenUrl: tokenServer.tokenUrl,
    accessToken: 'access-work',
    refreshToken: 'refresh-work',
    idToken: null,
    expiresAt: Date.now() + 60 * 60_000,
    daemonExtraEnv: {
      HAPPIER_CONNECTED_SERVICES_REFRESH_ENABLED: '0',
      HAPPIER_CONNECTED_SERVICES_DISABLE_CODEX_QUOTA_ENDPOINT: '1',
    },
  });
  activeStops.push(async () => {
    await fixture.daemon.stop().catch(() => {});
    await fixture.server.stop().catch(() => {});
  });

  await createConnectedServiceProfile({
    fixture,
    serviceId: SERVICE_ID,
    profileId: BACKUP_PROFILE_ID,
    providerEmail: ACCOUNT_EMAILS[BACKUP_ACCOUNT_ID],
    providerAccountId: BACKUP_ACCOUNT_ID,
    accessToken: 'access-backup',
    refreshToken: 'refresh-backup',
    idToken: null,
  });

  return { testDir, fixture };
}

async function seedGroup(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  groupId: string;
}>): Promise<void> {
  await createConnectedServiceAuthGroup({
    fixture: params.fixture,
    serviceId: SERVICE_ID,
    groupId: params.groupId,
    activeProfileId: WORK_PROFILE_ID,
    memberProfileIds: [WORK_PROFILE_ID, BACKUP_PROFILE_ID],
    preTurnProbeMode: 'never',
  });
}

async function expectFakeProfilesRemainConnected(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  context: string;
}>): Promise<void> {
  const profiles = await fetchConnectedServiceProfiles({
    fixture: params.fixture,
    serviceId: SERVICE_ID,
  });
  const statusesByProfileId = new Map(profiles.map((profile) => [
    profile.profileId,
    profile.status,
  ]));
  expect(Object.fromEntries(statusesByProfileId), params.context).toMatchObject({
    [WORK_PROFILE_ID]: 'connected',
    [BACKUP_PROFILE_ID]: 'connected',
  });
}

async function spawnGroupAppServerSession(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  sessionId: string;
  groupId: string;
  appServer: FakeAppServer;
  turnDelayMs?: number;
  loginFailureAccountIds?: readonly string[];
}>): Promise<string> {
  const spawn = await spawnConnectedCodexGroupAppServerSession(params.fixture, {
    sessionId: params.sessionId,
    groupId: params.groupId,
    fakeAppServerPath: params.appServer.fakeAppServerPath,
    environmentVariables: {
      HAPPIER_E2E_FAKE_CODEX_APP_SERVER_ACCOUNT_EMAILS_JSON: JSON.stringify(ACCOUNT_EMAILS),
      ...(typeof params.turnDelayMs === 'number'
        ? { HAPPIER_E2E_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: String(params.turnDelayMs) }
        : {}),
      ...(params.loginFailureAccountIds && params.loginFailureAccountIds.length > 0
        ? { HAPPIER_E2E_FAKE_CODEX_APP_SERVER_LOGIN_FAIL_ACCOUNT_IDS: params.loginFailureAccountIds.join(',') }
        : {}),
    },
  });
  expect(spawn.status).toBe(200);
  expect(spawn.data?.success).toBe(true);
  if (typeof spawn.data?.sessionId !== 'string' || spawn.data.sessionId.length === 0) {
    throw new Error(`Expected spawned session id; data=${JSON.stringify(spawn.data)}`);
  }
  const spawnedSessionId = spawn.data.sessionId;

  await waitForSessionActive({
    baseUrl: params.fixture.serverBaseUrl,
    token: params.fixture.auth.token,
    sessionId: spawnedSessionId,
    timeoutMs: 60_000,
  });
  return spawnedSessionId;
}

function buildQuotaSnapshot(params: Readonly<{
  profileId?: string;
  activeAccountId?: string;
  remainingPct: number;
}>): ConnectedServiceQuotaSnapshotV1 {
  const remainingPct = Math.max(0, Math.min(100, params.remainingPct));
  return ConnectedServiceQuotaSnapshotV1Schema.parse({
    v: 1,
    serviceId: SERVICE_ID,
    profileId: params.profileId ?? WORK_PROFILE_ID,
    fetchedAt: Date.now(),
    staleAfterMs: 60_000,
    planLabel: 'pro',
    accountLabel: ACCOUNT_EMAILS[WORK_ACCOUNT_ID],
    ...(params.activeAccountId ? { activeAccountId: params.activeAccountId } : {}),
    source: 'in_band_provider_snapshot',
    confidence: 'exact',
    meters: [
      {
        meterId: 'weekly',
        label: 'Weekly quota',
        used: null,
        limit: null,
        remainingPct,
        unit: 'unknown',
        utilizationPct: 100 - remainingPct,
        resetAtMs: Date.now() + 60 * 60_000,
        resetsAt: Date.now() + 60 * 60_000,
        status: 'ok',
        providerLimitId: 'weekly',
        details: {
          limitCategory: 'usage_limit',
          providerLimitId: 'weekly',
        },
      },
    ],
  });
}

async function postQuotaSnapshotOrThrow(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  sessionId: string;
  snapshot: ConnectedServiceQuotaSnapshotV1;
}>): Promise<void> {
  const response = await postConnectedServiceQuotaSnapshot({
    fixture: params.fixture,
    sessionId: params.sessionId,
    serviceId: SERVICE_ID,
    snapshot: params.snapshot,
  });
  expect(response.status).toBe(200);
  expect(response.data?.ok).toBe(true);
}

async function readRequests(logPath: string): Promise<readonly FakeCodexAppServerRequest[]> {
  return await readFakeCodexAppServerRequestLog(logPath);
}

function requestParams(request: FakeCodexAppServerRequest): Record<string, unknown> | null {
  return recordValue(request.params);
}

async function waitForRequest(
  requestLogPath: string,
  method: string,
  predicate: (request: FakeCodexAppServerRequest) => boolean = () => true,
  timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS,
): Promise<FakeCodexAppServerRequest> {
  let found: FakeCodexAppServerRequest | null = null;
  await waitFor(async () => {
    const requests = await readRequests(requestLogPath);
    found = requests.find((request) => request.method === method && predicate(request)) ?? null;
    return found !== null;
  }, { timeoutMs, intervalMs: 100, context: `${method} in ${requestLogPath}` });
  if (!found) throw new Error(`request ${method} was not found`);
  return found;
}

async function waitForLoginStart(
  requestLogPath: string,
  accountId: string,
  timeoutMs = 45_000,
): Promise<FakeCodexAppServerRequest> {
  return await waitForRequest(
    requestLogPath,
    'account/login/start',
    (request) => requestParams(request)?.chatgptAccountId === accountId,
    timeoutMs,
  );
}

async function expectSingleInitialize(requestLogPath: string): Promise<void> {
  const requests = await readRequests(requestLogPath);
  expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
}

function throwIfLoginStartObserved(requests: readonly FakeCodexAppServerRequest[], context: string): void {
  const loginStarts = requests.filter((request) => request.method === 'account/login/start');
  if (loginStarts.length > 0) {
    throw new Error(`${context}: observed unexpected account/login/start: ${JSON.stringify(loginStarts)}`);
  }
}

async function expectNoLoginStartDuringQuietRequestWindow(
  requestLogPath: string,
  params: Readonly<{
    context: string;
    quietMs?: number;
    timeoutMs?: number;
  }>,
): Promise<void> {
  const quietMs = params.quietMs ?? 2_000;
  let lastSerialized = JSON.stringify(await readRequests(requestLogPath));
  let quietSinceMs = Date.now();

  await waitFor(async () => {
    const requests = await readRequests(requestLogPath);
    throwIfLoginStartObserved(requests, params.context);
    const serialized = JSON.stringify(requests);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      quietSinceMs = Date.now();
    }
    return Date.now() - quietSinceMs >= quietMs;
  }, {
    timeoutMs: params.timeoutMs ?? 20_000,
    intervalMs: 100,
    failFast: true,
    context: params.context,
  });
}

async function expectInitializeCountStableDuringQuietRequestWindow(
  requestLogPath: string,
  params: Readonly<{
    expectedCount: number;
    context: string;
    quietMs?: number;
    timeoutMs?: number;
  }>,
): Promise<void> {
  const quietMs = params.quietMs ?? 2_000;
  let lastSerialized = JSON.stringify(await readRequests(requestLogPath));
  let quietSinceMs = Date.now();

  await waitFor(async () => {
    const requests = await readRequests(requestLogPath);
    const initializeCount = requests.filter((request) => request.method === 'initialize').length;
    if (initializeCount !== params.expectedCount) {
      throw new Error(`${params.context}: expected ${params.expectedCount} initialize request(s), saw ${initializeCount}`);
    }
    const serialized = JSON.stringify(requests);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      quietSinceMs = Date.now();
    }
    return Date.now() - quietSinceMs >= quietMs;
  }, {
    timeoutMs: params.timeoutMs ?? 20_000,
    intervalMs: 100,
    failFast: true,
    context: params.context,
  });
}

async function expectGroupActiveProfile(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  groupId: string;
  profileId: string;
}>): Promise<void> {
  await waitFor(async () => {
    const group = await fetchConnectedServiceAuthGroup({
      fixture: params.fixture,
      serviceId: SERVICE_ID,
      groupId: params.groupId,
    });
    return asRecord(group)?.activeProfileId === params.profileId;
  }, { timeoutMs: 20_000, intervalMs: 250, context: `group ${params.groupId} active ${params.profileId}` });
}

async function warmIdleAppServerSession(params: Readonly<{
  fixture: StartedConnectedServicesCodexDaemonFixture;
  sessionId: string;
  appServer: FakeAppServer;
  text: string;
}>): Promise<void> {
  await enqueueSessionPromptForScenario({
    baseUrl: params.fixture.serverBaseUrl,
    token: params.fixture.auth.token,
    sessionId: params.sessionId,
    secret: params.fixture.accountSecret,
    text: params.text,
  });
  await waitForRequest(params.appServer.requestLogPath, 'initialize');
  await waitForRequest(
    params.appServer.requestLogPath,
    'turn/start',
    (request) => {
      const input = requestParams(request)?.input;
      return Array.isArray(input)
        && input.some((entry) => {
          const text = recordValue(entry)?.text;
          return typeof text === 'string' && text.includes(params.text);
        });
    },
  );
  await waitForAssistantMessageContaining({
    baseUrl: params.fixture.serverBaseUrl,
    token: params.fixture.auth.token,
    sessionId: params.sessionId,
    secret: params.fixture.accountSecret,
    requiredSubstring: `${params.text}:done`,
    timeoutMs: 30_000,
  });
}

describe('Codex connected-service live hot-auth quota fanout', () => {
  it('hot-applies an exhausted group account to a healthy sibling from warmed spawn identity without restarting it', async () => {
    const testName = 'codex-live-hot-auth-fanout-idle-sibling';
    const { testDir, fixture } = await startFixture(testName);
    const groupId = `codex-hot-auth-${randomUUID()}`;
    await seedGroup({ fixture, groupId });
    const sourceServer = await createFakeAppServer(testDir, 'source');
    const siblingServer = await createFakeAppServer(testDir, 'sibling');
    const sourceSessionIdHint = `fanout-source-${randomUUID()}`;
    const siblingSessionIdHint = `fanout-sibling-${randomUUID()}`;

    const sourceSessionId = await spawnGroupAppServerSession({ fixture, sessionId: sourceSessionIdHint, groupId, appServer: sourceServer });
    const siblingSessionId = await spawnGroupAppServerSession({ fixture, sessionId: siblingSessionIdHint, groupId, appServer: siblingServer });
    await warmIdleAppServerSession({
      fixture,
      sessionId: siblingSessionId,
      appServer: siblingServer,
      text: 'warm healthy sibling',
    });

    await postQuotaSnapshotOrThrow({
      fixture,
      sessionId: sourceSessionId,
      snapshot: buildQuotaSnapshot({ remainingPct: 0, activeAccountId: WORK_ACCOUNT_ID }),
    });

    const login = await waitForLoginStart(siblingServer.requestLogPath, BACKUP_ACCOUNT_ID);
    expect(requestParams(login)).toMatchObject({
      type: 'chatgptAuthTokens',
      chatgptAccountId: BACKUP_ACCOUNT_ID,
      accessToken: '[redacted]',
    });
    await expectSingleInitialize(siblingServer.requestLogPath);
    await expectGroupActiveProfile({ fixture, groupId, profileId: BACKUP_PROFILE_ID });
  }, SLOW_DAEMON_FANOUT_TIMEOUT_MS);

  it('suppresses fanout when the exhausted quota snapshot lacks exact runtime account identity', async () => {
    const testName = 'codex-live-hot-auth-fanout-missing-identity';
    const { testDir, fixture } = await startFixture(testName);
    const groupId = `codex-hot-auth-${randomUUID()}`;
    await seedGroup({ fixture, groupId });
    const sourceServer = await createFakeAppServer(testDir, 'source');
    const siblingServer = await createFakeAppServer(testDir, 'sibling');
    const sourceSessionIdHint = `missing-identity-source-${randomUUID()}`;
    const siblingSessionIdHint = `missing-identity-sibling-${randomUUID()}`;

    const sourceSessionId = await spawnGroupAppServerSession({ fixture, sessionId: sourceSessionIdHint, groupId, appServer: sourceServer });
    await spawnGroupAppServerSession({ fixture, sessionId: siblingSessionIdHint, groupId, appServer: siblingServer });

    await postQuotaSnapshotOrThrow({
      fixture,
      sessionId: sourceSessionId,
      snapshot: buildQuotaSnapshot({ remainingPct: 0 }),
    });

    await expectNoLoginStartDuringQuietRequestWindow(siblingServer.requestLogPath, {
      context: 'missing identity fanout suppression',
    });
  }, SLOW_DAEMON_FANOUT_TIMEOUT_MS);

  it('hot-applies a same-account busy sibling before its active turn completes without restarting it', async () => {
    const testName = 'codex-live-hot-auth-fanout-busy-sibling';
    const { testDir, fixture } = await startFixture(testName);
    const groupId = `codex-hot-auth-${randomUUID()}`;
    await seedGroup({ fixture, groupId });
    const sourceServer = await createFakeAppServer(testDir, 'source');
    const siblingServer = await createFakeAppServer(testDir, 'sibling');
    const sourceSessionIdHint = `busy-source-${randomUUID()}`;
    const siblingSessionIdHint = `busy-sibling-${randomUUID()}`;

    const sourceSessionId = await spawnGroupAppServerSession({ fixture, sessionId: sourceSessionIdHint, groupId, appServer: sourceServer });
    const siblingSessionId = await spawnGroupAppServerSession({
      fixture,
      sessionId: siblingSessionIdHint,
      groupId,
      appServer: siblingServer,
      turnDelayMs: BUSY_SIBLING_TURN_DELAY_MS,
    });
    await expectFakeProfilesRemainConnected({
      fixture,
      context: 'fake profile health before busy-sibling fanout',
    });

    await enqueueSessionPromptForScenario({
      baseUrl: fixture.serverBaseUrl,
      token: fixture.auth.token,
      sessionId: siblingSessionId,
      secret: fixture.accountSecret,
      text: 'busy sibling turn',
    });
    await waitForRequest(siblingServer.requestLogPath, 'turn/start');

    await postQuotaSnapshotOrThrow({
      fixture,
      sessionId: sourceSessionId,
      snapshot: buildQuotaSnapshot({ remainingPct: 0, activeAccountId: WORK_ACCOUNT_ID }),
    });

    await waitForLoginStart(siblingServer.requestLogPath, BACKUP_ACCOUNT_ID, 60_000);
    const requestsAfterLogin = await readRequests(siblingServer.requestLogPath);
    const loginIndex = requestsAfterLogin.findIndex((request) => (
      request.method === 'account/login/start'
      && requestParams(request)?.chatgptAccountId === BACKUP_ACCOUNT_ID
    ));
    const turnCompletedIndex = requestsAfterLogin.findIndex((request) => {
      const promptText = requestParams(request)?.promptText;
      return request.method === 'happier/test/turn/completed'
        && typeof promptText === 'string'
        && promptText.includes('busy sibling turn');
    });
    expect(loginIndex).toBeGreaterThanOrEqual(0);
    expect(turnCompletedIndex === -1 || loginIndex < turnCompletedIndex).toBe(true);

    await waitForRequest(siblingServer.requestLogPath, 'happier/test/turn/completed', (request) => {
      const promptText = requestParams(request)?.promptText;
      return typeof promptText === 'string' && promptText.includes('busy sibling turn');
    }, 60_000);
    await expectSingleInitialize(siblingServer.requestLogPath);
  }, SLOW_DAEMON_FANOUT_TIMEOUT_MS);

  it('fails closed for a healthy sibling when direct live auth is unavailable and does not restart it', async () => {
    const testName = 'codex-live-hot-auth-fanout-live-unavailable';
    const { testDir, fixture } = await startFixture(testName);
    const groupId = `codex-hot-auth-${randomUUID()}`;
    await seedGroup({ fixture, groupId });
    const sourceServer = await createFakeAppServer(testDir, 'source');
    const siblingServer = await createFakeAppServer(testDir, 'sibling');
    const sourceSessionIdHint = `live-unavailable-source-${randomUUID()}`;
    const siblingSessionIdHint = `live-unavailable-sibling-${randomUUID()}`;

    const sourceSessionId = await spawnGroupAppServerSession({ fixture, sessionId: sourceSessionIdHint, groupId, appServer: sourceServer });
    const siblingSessionId = await spawnGroupAppServerSession({
      fixture,
      sessionId: siblingSessionIdHint,
      groupId,
      appServer: siblingServer,
      loginFailureAccountIds: [BACKUP_ACCOUNT_ID],
    });
    await warmIdleAppServerSession({
      fixture,
      sessionId: siblingSessionId,
      appServer: siblingServer,
      text: 'warm live-unavailable sibling',
    });

    await postQuotaSnapshotOrThrow({
      fixture,
      sessionId: sourceSessionId,
      snapshot: buildQuotaSnapshot({ remainingPct: 0, activeAccountId: WORK_ACCOUNT_ID }),
    });

    await waitForLoginStart(siblingServer.requestLogPath, BACKUP_ACCOUNT_ID);
    await expectInitializeCountStableDuringQuietRequestWindow(siblingServer.requestLogPath, {
      expectedCount: 1,
      context: 'live auth unavailable does not restart sibling',
    });
  }, SLOW_DAEMON_FANOUT_TIMEOUT_MS);
});
