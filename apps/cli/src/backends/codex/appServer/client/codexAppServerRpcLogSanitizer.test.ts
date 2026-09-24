import { describe, expect, it } from 'vitest';

import { sanitizeCodexAppServerRpcLogValue } from './codexAppServerRpcLogSanitizer';

describe('sanitizeCodexAppServerRpcLogValue', () => {
    it('recursively redacts token and secret-bearing fields while preserving non-secret shape', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            accessToken: 'access-secret',
            idToken: 'id-secret',
            refresh_token: 'refresh-secret',
            authorization: 'Bearer auth-secret',
            Cookie: 'session=cookie-secret',
            nested: {
                apiKey: 'api-secret',
                password: 'password-secret',
                clientSecret: 'client-secret',
                notSecret: 'visible',
                items: [
                    { chatgptAccountId: 'account-visible' },
                    { xApiKey: 'array-api-secret' },
                ],
            },
        });

        expect(sanitized).toEqual({
            accessToken: '[REDACTED]',
            idToken: '[REDACTED]',
            refresh_token: '[REDACTED]',
            authorization: '[REDACTED]',
            Cookie: '[REDACTED]',
            nested: {
                apiKey: '[REDACTED]',
                password: '[REDACTED]',
                clientSecret: '[REDACTED]',
                notSecret: 'visible',
                items: [
                    { chatgptAccountId: 'account-visible' },
                    { xApiKey: '[REDACTED]' },
                ],
            },
        });
        expect(JSON.stringify(sanitized)).not.toContain('secret');
    });

    it('redacts secret keys before truncating oversized objects', () => {
        const input: Record<string, unknown> = {
            accessToken: 'access-secret',
        };
        for (let index = 0; index < 70; index += 1) {
            input[`safe${index}`] = `value-${index}`;
        }

        const sanitized = sanitizeCodexAppServerRpcLogValue(input);

        expect(JSON.stringify(sanitized)).not.toContain('access-secret');
        expect(JSON.stringify(sanitized)).toContain('[REDACTED]');
    });

    it('redacts auth credential and private key variants', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            auth: 'auth-secret',
            authentication: 'authentication-secret',
            authHeader: 'Bearer auth-header-secret',
            credential: 'credential-secret',
            credentials: 'credentials-secret',
            privateKey: 'private-key-secret',
            private_key: 'snake-private-key-secret',
            'private-key': 'kebab-private-key-secret',
            nested: {
                NotAuthentication: 'visible',
                notionApiKey: 'notion-api-secret',
                notificationToken: 'notification-token-secret',
                notifierPassword: 'notifier-password-secret',
            },
        });

        expect(sanitized).toEqual({
            auth: '[REDACTED]',
            authentication: '[REDACTED]',
            authHeader: '[REDACTED]',
            credential: '[REDACTED]',
            credentials: '[REDACTED]',
            privateKey: '[REDACTED]',
            private_key: '[REDACTED]',
            'private-key': '[REDACTED]',
            nested: {
                NotAuthentication: 'visible',
                notionApiKey: '[REDACTED]',
                notificationToken: '[REDACTED]',
                notifierPassword: '[REDACTED]',
            },
        });
        expect(JSON.stringify(sanitized)).not.toContain('-secret');
    });

    it('redacts token-like content inside generic diagnostic strings', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart';
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            message: [
                'request failed with Authorization: Bearer bearer-secret-token-123456789',
                'request failed with Authorization: "Bearer quoted-bearer-secret-token-123456789"',
                '"authorization":"Bearer json-bearer-secret-token-123456789"',
                'request failed with Authorization: Basic dXNlcjpwYXNz',
                'request failed with Cookie: a=one; b=two',
                `provider returned jwt ${jwt}`,
                'upstream echoed sk-proj_abcdefghijklmnopqrstuvwxyz1234567890',
                'debug line accessToken=assignment-secret-token-123456789',
                'oauth refresh_token=snake-refresh-token-123456789 client_secret=snake-client-secret-123456789',
                '"access_token":"json-access-token-123456789"',
            ].join('\n'),
        });

        const serialized = JSON.stringify(sanitized);
        expect(serialized).not.toContain('bearer-secret-token');
        expect(serialized).not.toContain('quoted-bearer-secret-token');
        expect(serialized).not.toContain('json-bearer-secret-token');
        expect(serialized).not.toContain('dXNlcjpwYXNz');
        expect(serialized).not.toContain('b=two');
        expect(serialized).not.toContain(jwt);
        expect(serialized).not.toContain('sk-proj_abcdefghijklmnopqrstuvwxyz');
        expect(serialized).not.toContain('assignment-secret-token');
        expect(serialized).not.toContain('snake-refresh-token');
        expect(serialized).not.toContain('snake-client-secret');
        expect(serialized).not.toContain('json-access-token');
        expect(serialized).toContain('[REDACTED]');
    });

    it('redacts token-like content recursively inside nested generic arrays and objects', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            diagnostics: [
                'Authorization=Bearer nested-bearer-token-123456789',
                {
                    note: 'model error included idToken=nested-id-token-123456789',
                    entries: [
                        'credential copied as sk-test_abcdefghijklmnopqrstuvwxyz123456',
                        {
                            detail: 'jwt eyJraWQiOiIxMjMifQ.eyJpc3MiOiJjb2RleCJ9.signaturepart',
                        },
                    ],
                },
            ],
        });

        const serialized = JSON.stringify(sanitized);
        expect(serialized).not.toContain('nested-bearer-token');
        expect(serialized).not.toContain('nested-id-token');
        expect(serialized).not.toContain('sk-test_abcdefghijklmnopqrstuvwxyz');
        expect(serialized).not.toContain('eyJraWQiOiIxMjMifQ');
        expect(serialized).toContain('[REDACTED]');
    });

    it('redacts provider resume identifiers from structured RPC payload fields', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            method: 'thread/fork',
            params: {
                threadId: '019e5f08-3b44-72f3-8d73-a137dca3a47d',
                CODEX_THREAD_ID: 'structured-codex-thread-raw',
                codexSessionId: 'codex-session-raw',
                remoteSessionId: 'remote-session-raw',
                sessionId: 'plain-session-raw',
                providerResumeId: 'provider-resume-raw',
                resumeId: 'resume-raw',
                nested: {
                    vendorSessionId: 'vendor-session-raw',
                },
            },
        });

        expect(sanitized).toEqual({
            method: 'thread/fork',
            params: {
                threadId: '[REDACTED_PROVIDER_RESUME_ID]',
                CODEX_THREAD_ID: '[REDACTED_PROVIDER_RESUME_ID]',
                codexSessionId: '[REDACTED_PROVIDER_RESUME_ID]',
                remoteSessionId: '[REDACTED_PROVIDER_RESUME_ID]',
                sessionId: '[REDACTED_PROVIDER_RESUME_ID]',
                providerResumeId: '[REDACTED_PROVIDER_RESUME_ID]',
                resumeId: '[REDACTED_PROVIDER_RESUME_ID]',
                nested: {
                    vendorSessionId: '[REDACTED_PROVIDER_RESUME_ID]',
                },
            },
        });
        expect(JSON.stringify(sanitized)).not.toContain('019e5f08');
        expect(JSON.stringify(sanitized)).not.toContain('structured-codex-thread-raw');
        expect(JSON.stringify(sanitized)).not.toContain('remote-session-raw');
        expect(JSON.stringify(sanitized)).not.toContain('plain-session-raw');
        expect(JSON.stringify(sanitized)).not.toContain('provider-resume-raw');
    });

    it('redacts provider thread ids returned under generic id fields', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            id: 'thread-root-raw',
            thread: {
                id: 'thread-nested-raw',
            },
            data: [
                { id: 'thread-list-raw', name: 'visible thread title' },
            ],
        });

        expect(sanitized).toEqual({
            id: '[REDACTED_PROVIDER_RESUME_ID]',
            thread: {
                id: '[REDACTED_PROVIDER_RESUME_ID]',
            },
            data: [
                { id: '[REDACTED_PROVIDER_RESUME_ID]', name: 'visible thread title' },
            ],
        });
        const serialized = JSON.stringify(sanitized);
        expect(serialized).not.toContain('thread-root-raw');
        expect(serialized).not.toContain('thread-nested-raw');
        expect(serialized).not.toContain('thread-list-raw');
    });

    it('redacts object-valued sensitive fields without exposing neutral child keys', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            credentials: {
                value: 'credential-object-secret',
                note: 'neutral child key',
            },
            path: {
                value: '/Users/leeroy/private/project',
                note: 'neutral child key',
            },
            providerResumeId: {
                value: 'resume-object-raw',
                note: 'neutral child key',
            },
        });

        expect(sanitized).toEqual({
            credentials: '[REDACTED]',
            path: '[REDACTED_LOCAL_PATH]',
            providerResumeId: '[REDACTED_PROVIDER_RESUME_ID]',
        });
        const serialized = JSON.stringify(sanitized);
        expect(serialized).not.toContain('credential-object-secret');
        expect(serialized).not.toContain('/Users/leeroy');
        expect(serialized).not.toContain('resume-object-raw');
    });

    it('redacts local path fields while preserving non-sensitive payload shape', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            method: 'skills/list',
            params: {
                cwd: '/Users/leeroy/Documents/Development/happier/remote-dev',
                cwds: [
                    '/Users/leeroy/Documents/Development/happier/remote-dev',
                    '/tmp/other-project',
                ],
                sandboxPolicy: {
                    writableRoots: ['/Users/leeroy/Documents/Development/happier/remote-dev'],
                },
                directory: '/Users/leeroy/Documents/Development/happier/remote-dev',
                nested: {
                    path: '/Users/leeroy/.codex/skills/private/SKILL.md',
                    paths: ['/Users/leeroy/.codex/skills/private/SKILL.md'],
                    savedPath: '/Users/leeroy/.happier/generated/image.png',
                    saved_path: '/Users/leeroy/.happier/generated/image-2.png',
                    localPath: '/Users/leeroy/.happier/uploads/local.png',
                    location: '/Users/leeroy/.codex/plugins/private',
                },
                visible: 'kept',
            },
        });

        expect(sanitized).toEqual({
            method: 'skills/list',
            params: {
                cwd: '[REDACTED_LOCAL_PATH]',
                cwds: ['[REDACTED_LOCAL_PATH]', '[REDACTED_LOCAL_PATH]'],
                sandboxPolicy: {
                    writableRoots: ['[REDACTED_LOCAL_PATH]'],
                },
                directory: '[REDACTED_LOCAL_PATH]',
                nested: {
                    path: '[REDACTED_LOCAL_PATH]',
                    paths: ['[REDACTED_LOCAL_PATH]'],
                    savedPath: '[REDACTED_LOCAL_PATH]',
                    saved_path: '[REDACTED_LOCAL_PATH]',
                    localPath: '[REDACTED_LOCAL_PATH]',
                    location: '[REDACTED_LOCAL_PATH]',
                },
                visible: 'kept',
            },
        });
        expect(JSON.stringify(sanitized)).not.toContain('/Users/leeroy');
        expect(JSON.stringify(sanitized)).not.toContain('/tmp/other-project');
    });

    it('redacts provider resume ids and local paths in generic diagnostic strings', () => {
        const sanitized = sanitizeCodexAppServerRpcLogValue({
            message: [
                'providerResumeId=provider-resume-raw cwd=/Users/leeroy/private/project',
                'thread_id:019e5f08-3b44-72f3-8d73-a137dca3a47d path=/tmp/private-skill',
                'vendorSessionId=vendor-session-raw location=/Users/leeroy/.codex/plugins/private',
                '"threadId":"json-thread-raw" "path":"/Users/leeroy/json-private"',
                'remoteSessionId=remote-session-raw file_path=/Users/leeroy/file-private.ts',
                'providerSessionId=provider-session-raw localPath:"/Users/leeroy/local-private"',
                'session_id=plain-session-raw',
                'bare paths /Users/leeroy/bare-private and C:\\Users\\leeroy\\bare-private',
                'other roots /opt/homebrew/private /mnt/c/Users/leeroy/private /srv/repo/private',
                'unc paths \\\\server\\share\\repo and \\\\?\\C:\\Users\\leeroy\\extended',
            ].join('\n'),
        });

        const serialized = JSON.stringify(sanitized);
        expect(serialized).toContain('[REDACTED_PROVIDER_RESUME_ID]');
        expect(serialized).toContain('[REDACTED_LOCAL_PATH]');
        expect(serialized).not.toContain('provider-resume-raw');
        expect(serialized).not.toContain('019e5f08');
        expect(serialized).not.toContain('vendor-session-raw');
        expect(serialized).not.toContain('json-thread-raw');
        expect(serialized).not.toContain('remote-session-raw');
        expect(serialized).not.toContain('provider-session-raw');
        expect(serialized).not.toContain('plain-session-raw');
        expect(serialized).not.toContain('/Users/leeroy');
        expect(serialized).not.toContain('C:\\\\Users\\\\leeroy');
        expect(serialized).not.toContain('/opt/homebrew');
        expect(serialized).not.toContain('/mnt/c');
        expect(serialized).not.toContain('/srv/repo');
        expect(serialized).not.toContain('server\\\\share');
        expect(serialized).not.toContain('/tmp/private-skill');
    });
});
