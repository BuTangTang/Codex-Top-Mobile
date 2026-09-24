import { describe, expect, it } from 'vitest';

import {
    buildSessionDebugInformation,
    isSessionDebugInformationEnabled,
    resolveProviderSessionIdForDebug,
    resolveProviderSessionArtifactPath,
} from './sessionDebugInformation';

describe('sessionDebugInformation', () => {
    it('enables debug information actions for dev builds or the local developer-mode setting', () => {
        expect(isSessionDebugInformationEnabled(false, false)).toBe(false);
        expect(isSessionDebugInformationEnabled(true, false)).toBe(true);
        expect(isSessionDebugInformationEnabled(false, true)).toBe(true);
    });

    /** 验证显示品牌已更新，同时原始会话标识与路径保持不变。 */
    it('builds debug text with only available session values', () => {
        const result = buildSessionDebugInformation({
            session: {
                id: 'happy-session-1',
                metadata: {
                    sessionLogPath: ' /tmp/happier/session.log ',
                },
            },
            providerDisplayName: 'Claude',
            providerSessionId: ' claude-session-1 ',
        });

        expect(result.text).toBe([
            'Codex Top session ID: happy-session-1',
            'Claude session ID: claude-session-1',
            'Codex Top logs: /tmp/happier/session.log',
        ].join('\n'));
        expect(result.providerSessionArtifactPath).toBeNull();
    });

    /** 验证缺失的诊断信息不会生成多余显示行。 */
    it('omits unavailable values instead of writing placeholder lines', () => {
        const result = buildSessionDebugInformation({
            session: {
                id: 'happy-session-2',
                metadata: {
                    claudeTranscriptPath: '   ',
                    sessionLogPath: null,
                },
            },
            providerDisplayName: 'Claude',
            providerSessionId: null,
        });

        expect(result.text).toBe('Codex Top session ID: happy-session-2');
        expect(result.text).not.toContain('Not available');
        expect(result.text).not.toContain('Claude session ID');
        expect(result.text).not.toContain('Codex Top logs');
        expect(result.text).not.toContain('Claude session logs');
    });

    it('resolves known provider artifact paths from session metadata', () => {
        expect(resolveProviderSessionArtifactPath({
            claudeTranscriptPath: ' /tmp/claude/session.jsonl ',
        })).toBe('/tmp/claude/session.jsonl');

        expect(resolveProviderSessionArtifactPath({
            piSessionFile: ' /tmp/pi/session.jsonl ',
        })).toBe('/tmp/pi/session.jsonl');

        expect(resolveProviderSessionArtifactPath({
            agentRuntimeDescriptorV1: {
                v: 1,
                providerId: 'pi',
                provider: {
                    resumeStrategy: 'sessionFileAbsolutePreferred',
                    sessionFile: ' /tmp/pi/from-runtime.jsonl ',
                },
            },
        })).toBe('/tmp/pi/from-runtime.jsonl');
    });

    it('resolves provider session ids separately from provider artifact paths', () => {
        expect(resolveProviderSessionIdForDebug({
            metadata: {
                agentRuntimeDescriptorV1: {
                    v: 1,
                    providerId: 'pi',
                    provider: {
                        resumeStrategy: 'sessionFileAbsolutePreferred',
                        vendorSessionId: 'pi-session-1',
                        sessionFile: '/tmp/pi/session.jsonl',
                    },
                },
                piSessionId: 'legacy-pi-session',
                piSessionFile: '/tmp/pi/session.jsonl',
            },
            vendorResumeIdField: 'piSessionId',
        })).toBe('pi-session-1');

        expect(resolveProviderSessionIdForDebug({
            metadata: {
                agentRuntimeDescriptorV1: {
                    v: 1,
                    providerId: 'codex',
                    provider: {
                        backendMode: 'appServer',
                        vendorSessionId: 'codex-runtime-session',
                    },
                },
                codexSessionId: 'codex-legacy-session',
            },
            vendorResumeIdField: 'codexSessionId',
        })).toBe('codex-runtime-session');

        expect(resolveProviderSessionIdForDebug({
            metadata: {
                geminiSessionId: ' gemini-session-1 ',
            },
            vendorResumeIdField: 'geminiSessionId',
        })).toBe('gemini-session-1');
    });

    /** 验证提供方日志按真实路径显示，产品名称不影响字段归属。 */
    it('adds the provider logs line only when a known artifact path exists', () => {
        const withArtifact = buildSessionDebugInformation({
            session: {
                id: 'happy-session-3',
                metadata: {
                    flavor: 'claude',
                    claudeTranscriptPath: '/tmp/claude/session.jsonl',
                },
            },
            providerDisplayName: 'Claude',
            providerSessionId: 'claude-session-3',
        });

        expect(withArtifact.text).toBe([
            'Codex Top session ID: happy-session-3',
            'Claude session ID: claude-session-3',
            'Claude session logs: /tmp/claude/session.jsonl',
        ].join('\n'));

        const withoutArtifact = buildSessionDebugInformation({
            session: {
                id: 'happy-session-4',
                metadata: {
                    flavor: 'codex',
                },
            },
            providerDisplayName: 'Codex',
            providerSessionId: 'codex-session-4',
        });

        expect(withoutArtifact.text).toBe([
            'Codex Top session ID: happy-session-4',
            'Codex session ID: codex-session-4',
        ].join('\n'));
    });
});
