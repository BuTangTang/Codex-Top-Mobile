import { describe, expect, it } from 'vitest';

import { RPC_METHODS, resolveSocketRpcSessionWriteAuthorizationMethod, resolveSocketRpcProviderStartingMethod } from './rpc.js';

describe('RPC_METHODS (daemon direct sessions)', () => {
  // 手机发送必须接受已有会话写权限校验，但不能被当作启动新执行器的操作。
  it('authorizes external-owner sending as a session write without starting a provider', () => {
    expect(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND).toBe('daemon.directSessions.send');
    expect(resolveSocketRpcSessionWriteAuthorizationMethod('machine-a:daemon.directSessions.send'))
      .toBe('daemon.directSessions.send');
    expect(resolveSocketRpcProviderStartingMethod('machine-a:daemon.directSessions.send')).toBeNull();
  });
  it('includes daemon.directSessions.* methods', () => {
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSIONS_ACP_SESSION_LIST_CAPABILITY_GET).toBe('daemon.directSessions.acpSessionList.capability.get');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST).toBe('daemon.directSessions.candidates.list');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_CANDIDATE_DELETE).toBe('daemon.directSessions.candidate.delete');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_LINK_ENSURE).toBe('daemon.directSessions.link.ensure');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_ATTACH).toBe('daemon.directSessions.attach');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_DETACH).toBe('daemon.directSessions.detach');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET).toBe('daemon.directSessions.followPolicy.set');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_STATUS_GET).toBe('daemon.directSessions.status.get');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_TRANSCRIPT_PAGE).toBe('daemon.directSessions.transcript.page');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER).toBe('daemon.directSessions.transcript.readAfter');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_TAKEOVER).toBe('daemon.directSessions.takeover');
    expect((RPC_METHODS as any).DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST).toBe('daemon.directSessions.takeoverPersist');
  });
});
