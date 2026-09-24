import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

import {
  CLAUDE_CODE_E2E_OAUTH_SCOPE,
  CLAUDE_SUBSCRIPTION_SERVICE_ID,
  createConnectedServiceAuthGroup,
  createConnectedServiceProfile,
  fetchConnectedServiceAuthGroup,
  spawnConnectedClaudeGroupSession,
  startConnectedServiceRecoveryTokenServer,
  startConnectedServicesClaudeDaemon,
  type ConnectedServiceRecoveryTokenServer,
  type StartedConnectedServicesClaudeDaemonFixture,
} from '../../src/testkit/connectedServicesRecovery';
import { decryptLegacyBase64Normalized } from '../../src/testkit/decryptLegacyBase64Normalized';
import {
  fakeClaudeFixturePath,
  waitForFakeClaudeNativeAuthContract,
  type FakeClaudeNativeAuthContract,
} from '../../src/testkit/fakeClaude';
import { createRunDirs } from '../../src/testkit/runDir';
import { fetchMessagesSince, fetchSessionV2, type SessionMessageRow } from '../../src/testkit/sessions';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({
  runLabel: 'core',
  ...(process.env.HAPPIER_E2E_LOGS_DIR ? { logsDir: process.env.HAPPIER_E2E_LOGS_DIR } : {}),
});

const PRIMARY_TOKEN = 'claude-predictive-soft-switch-primary-access-token';
const BACKUP_TOKEN = 'claude-predictive-soft-switch-backup-access-token';

type UnknownRecord = Record<string, unknown>;

type ClaudeUsageServer = Readonly<{
  usageUrl: string;
  requests: () => readonly UnknownRecord[];
  stop: () => Promise<void>;
}>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

async function startClaudeUsageServer(): Promise<ClaudeUsageServer> {
  const requests: UnknownRecord[] = [];
  const utilizationByAccessToken = new Map([
    [PRIMARY_TOKEN, 99],
    [BACKUP_TOKEN, 10],
  ]);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const accessToken = auth.replace(/^Bearer\s+/iu, '').trim();
    requests.push({
      path: url.pathname,
      method: req.method ?? 'GET',
      accessToken,
      receivedAtMs: Date.now(),
    });

    const utilization = utilizationByAccessToken.get(accessToken);
    res.statusCode = utilization === undefined ? 401 : 200;
    res.setHeader('content-type', 'application/json');
    if (utilization === undefined) {
      res.end(JSON.stringify({ error: 'unknown_token' }));
      return;
    }

    const resetsAt = new Date(Date.now() + 60 * 60_000).toISOString();
    res.end(JSON.stringify({
      five_hour: { utilization, resets_at: resetsAt },
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Claude usage test server missing address');

  return {
    usageUrl: `http://127.0.0.1:${address.port}/api/oauth/usage`,
    requests: () => [...requests],
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function createConnectedServiceAuthGroupWhenReadable(
  params: Parameters<typeof createConnectedServiceAuthGroup>[0],
): Promise<void> {
  await waitFor(async () => {
    try {
      await createConnectedServiceAuthGroup(params);
      return true;
    } catch {
      try {
        const group = await fetchConnectedServiceAuthGroup({
          fixture: params.fixture,
          serviceId: params.serviceId,
          groupId: params.groupId,
        });
        return group.activeProfileId === params.activeProfileId;
      } catch {
        return false;
      }
    }
  }, {
    timeoutMs: 25_000,
    intervalMs: 250,
    context: 'Claude connected-service auth group is readable',
  });
}

async function spawnConnectedClaudeGroupSessionWhenEligible(params: Parameters<typeof spawnConnectedClaudeGroupSession>[0]): Promise<string> {
  let resolvedSessionId: string | null = null;
  await waitFor(async () => {
    try {
      resolvedSessionId = await spawnConnectedClaudeGroupSession(params);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('no_eligible_member')) return false;
      throw error;
    }
  }, {
    timeoutMs: 40_000,
    intervalMs: 500,
    context: 'Claude connected group session spawns once active member is eligible',
  });
  if (!resolvedSessionId) throw new Error('Expected spawned Claude group session id');
  return resolvedSessionId;
}

async function readClaudeAccessToken(credentialsPath: string): Promise<string | null> {
  const parsed = asRecord(JSON.parse(await readFile(credentialsPath, 'utf8')) as unknown);
  const oauth = asRecord(parsed?.claudeAiOauth);
  return typeof oauth?.accessToken === 'string' ? oauth.accessToken : null;
}

async function readFakeClaudeEvents(logPath: string): Promise<UnknownRecord[]> {
  let raw = '';
  try {
    raw = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const record = asRecord(parsed);
      return record ? [record] : [];
    } catch {
      return [];
    }
  });
}

function isRealLocalClaudeSessionInvocation(event: UnknownRecord): boolean {
  if (event.type !== 'invocation') return false;
  if (event.mode !== 'local') return false;
  const argv = Array.isArray(event.argv) ? event.argv : [];
  return argv.includes('--settings')
    && argv.includes('--plugin-dir')
    && !argv.includes('--version')
    && !argv.includes('-v');
}

async function countRealLocalClaudeSessionInvocations(logPath: string): Promise<number> {
  const events = await readFakeClaudeEvents(logPath);
  return events.filter(isRealLocalClaudeSessionInvocation).length;
}

async function waitForQuotaSoftSwitchSuppressionDiagnostic(params: Readonly<{
  fixture: StartedConnectedServicesClaudeDaemonFixture;
  reason: string;
}>): Promise<void> {
  const logPath = params.fixture.daemon.state.daemonLogPath;
  if (!logPath) throw new Error('Expected started daemon state to expose daemonLogPath for quota diagnostics');
  await waitFor(async () => {
    let raw = '';
    try {
      raw = await readFile(logPath, 'utf8');
    } catch {
      return false;
    }
    return raw.includes('"event":"quota_work_suppressed"')
      && raw.includes('"phase":"soft_switch"')
      && raw.includes(`"reason":"${params.reason}"`);
  }, {
    timeoutMs: 45_000,
    intervalMs: 250,
    context: `quota soft-switch suppression diagnostic ${params.reason}`,
  });
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

async function fetchTranscriptEvents(params: Readonly<{
  fixture: StartedConnectedServicesClaudeDaemonFixture;
  sessionId: string;
  afterSeq: number;
}>): Promise<UnknownRecord[]> {
  const rows = await fetchMessagesSince({
    baseUrl: params.fixture.serverBaseUrl,
    token: params.fixture.auth.token,
    sessionId: params.sessionId,
    afterSeq: params.afterSeq,
  });
  return rows.flatMap((row) => {
    const event = readTranscriptEventData(row, params.fixture.accountSecret);
    return event ? [event] : [];
  });
}

describe('core e2e: Claude connected-service quota predictive switching', () => {
  let fixture: StartedConnectedServicesClaudeDaemonFixture | null = null;
  let tokenServer: ConnectedServiceRecoveryTokenServer | null = null;
  let usageServer: ClaudeUsageServer | null = null;

  afterEach(async () => {
    await fixture?.daemon.stop().catch(() => {});
    await fixture?.server.stop().catch(() => {});
    await tokenServer?.stop().catch(() => {});
    await usageServer?.stop().catch(() => {});
    fixture = null;
    tokenServer = null;
    usageServer = null;
  }, 60_000);

  it('suppresses Claude subscription live soft-threshold switches because provider adoption requires restart proof', async () => {
    const groupId = `cld-predict-${randomUUID()}`;
    const initialPrompt = `E2E_CLAUDE_HOT_APPLY_INITIAL_${randomUUID()}`;
    const testDir = run.testDir(`connected-services-claude-predictive-soft-switch-${randomUUID()}`);
    tokenServer = await startConnectedServiceRecoveryTokenServer({
      respond: (request) => {
        const isBackup = request.body.includes('claude-backup-refresh-token');
        return {
          status: 200,
          body: {
            access_token: isBackup ? BACKUP_TOKEN : PRIMARY_TOKEN,
            refresh_token: isBackup ? 'claude-backup-refresh-token' : 'claude-primary-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: CLAUDE_CODE_E2E_OAUTH_SCOPE,
          },
        };
      },
    });
    usageServer = await startClaudeUsageServer();

    fixture = await startConnectedServicesClaudeDaemon({
      testDir,
      testName: 'connected-services-claude-predictive-soft-switch',
      tokenUrl: tokenServer.tokenUrl,
      fakeClaudePath: fakeClaudeFixturePath(),
      fakeClaudeLogPath: resolve(join(testDir, 'fake-claude-predictive-soft-switch.jsonl')),
      serverExtraEnv: {
        HAPPIER_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED: '1',
      },
      extraEnv: {
        HAPPIER_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED: '1',
        HAPPIER_CONNECTED_SERVICES_QUOTAS_TICK_MS: '5000',
        HAPPIER_CONNECTED_SERVICES_QUOTAS_LOOP_JITTER_MS: '0',
        HAPPIER_CONNECTED_SERVICES_QUOTAS_DISCOVERY_ENABLED: '0',
        HAPPIER_CONNECTED_SERVICES_QUOTAS_FETCH_TIMEOUT_MS: '5000',
        HAPPIER_CONNECTED_SERVICES_QUOTAS_STALE_AFTER_MS: '300000',
        HAPPIER_CONNECTED_SERVICES_AUTH_GROUP_QUOTA_FRESHNESS_MS: '1000',
        HAPPIER_CONNECTED_SERVICES_QUOTA_GROUP_SWITCH_CHECK_MIN_INTERVAL_MS: '0',
        HAPPIER_CONNECTED_SERVICES_QUOTA_GROUP_SWITCH_CHECK_JITTER_MS: '0',
        HAPPIER_CONNECTED_SERVICES_CLAUDE_SUBSCRIPTION_USAGE_URL: usageServer.usageUrl,
      },
    });

    await createConnectedServiceProfile({
      fixture,
      serviceId: CLAUDE_SUBSCRIPTION_SERVICE_ID,
      profileId: 'primary',
      providerEmail: 'claude-primary@example.test',
      accessToken: PRIMARY_TOKEN,
      refreshToken: 'claude-primary-refresh-token',
      idToken: null,
      scope: CLAUDE_CODE_E2E_OAUTH_SCOPE,
      tokenType: 'Bearer',
      providerAccountId: 'acct-claude-primary',
      expiresAt: Date.now() + 60 * 60_000,
    });
    await createConnectedServiceProfile({
      fixture,
      serviceId: CLAUDE_SUBSCRIPTION_SERVICE_ID,
      profileId: 'backup',
      providerEmail: 'claude-backup@example.test',
      accessToken: BACKUP_TOKEN,
      refreshToken: 'claude-backup-refresh-token',
      idToken: null,
      scope: CLAUDE_CODE_E2E_OAUTH_SCOPE,
      tokenType: 'Bearer',
      providerAccountId: 'acct-claude-backup',
      expiresAt: Date.now() + 60 * 60_000,
    });
    await createConnectedServiceAuthGroupWhenReadable({
      fixture,
      serviceId: CLAUDE_SUBSCRIPTION_SERVICE_ID,
      groupId,
      activeProfileId: 'primary',
      memberProfileIds: ['primary', 'backup'],
      preTurnProbeMode: 'never',
    });

    const sessionId = await spawnConnectedClaudeGroupSessionWhenEligible({
      fixture,
      sessionId: `cld-predict-${randomUUID()}`,
      groupId,
      profileId: 'primary',
      initialPrompt,
    });

    const initialContract = await waitForFakeClaudeNativeAuthContract(
      fixture.fakeClaudeLogPath,
      (event: FakeClaudeNativeAuthContract) => event.ok === true && event.claudeConfigDir.length > 0,
      { timeoutMs: 60_000 },
    );
    await expect(readClaudeAccessToken(initialContract.credentialsPath)).resolves.toBe(PRIMARY_TOKEN);
    await expect(countRealLocalClaudeSessionInvocations(fixture.fakeClaudeLogPath)).resolves.toBe(1);

    const baseline = await fetchSessionV2(fixture.serverBaseUrl, fixture.auth.token, sessionId);
    const baselineSeq = baseline.seq ?? 0;

    await waitFor(async () => usageServer!.requests().some((request) => request.accessToken === PRIMARY_TOKEN), {
      timeoutMs: 45_000,
      intervalMs: 250,
      context: 'quota loop probes the active Claude group member',
    });

    await waitForQuotaSoftSwitchSuppressionDiagnostic({
      fixture,
      reason: 'predictive_soft_switch_restart_required',
    });
    const groupAfterSoftThreshold = await fetchConnectedServiceAuthGroup({
      fixture,
      serviceId: CLAUDE_SUBSCRIPTION_SERVICE_ID,
      groupId,
    });
    expect(groupAfterSoftThreshold.activeProfileId).toBe('primary');
    expect(usageServer.requests().some((request) => request.accessToken === BACKUP_TOKEN)).toBe(false);
    await expect(readClaudeAccessToken(initialContract.credentialsPath)).resolves.toBe(PRIMARY_TOKEN);
    await expect(countRealLocalClaudeSessionInvocations(fixture.fakeClaudeLogPath)).resolves.toBe(1);

    const transcriptEvents = await fetchTranscriptEvents({ fixture, sessionId, afterSeq: baselineSeq });
    const switchEvents = transcriptEvents.filter((event) => event.type === 'connected-service-account-switch');
    const attemptEvents = transcriptEvents.filter((event) => event.type === 'connected-service-account-switch-attempt');
    expect(switchEvents).toHaveLength(0);
    expect(attemptEvents).toHaveLength(0);
    expect(JSON.stringify(transcriptEvents)).not.toContain('hot_apply');
    expect(JSON.stringify(transcriptEvents)).not.toContain('same_provider_account_exhausted');
  }, 360_000);
});
