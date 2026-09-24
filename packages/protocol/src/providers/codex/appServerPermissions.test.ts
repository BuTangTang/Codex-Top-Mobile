import { describe, expect, it } from 'vitest';

import { CodexAppServerTurnPermissionFieldsSchema } from './appServerPermissions.js';

describe('Codex app-server permission fields schema', () => {
    it('rejects turn payloads that combine permissions with sandboxPolicy', () => {
        expect(() =>
            CodexAppServerTurnPermissionFieldsSchema.parse({
                permissions: { profile: 'read-only' },
                sandboxPolicy: { mode: 'workspace-write' },
            }),
        ).toThrow();
    });

    it('accepts evolving permission profile fields', () => {
        const parsed = CodexAppServerTurnPermissionFieldsSchema.parse({
            permissions: { profile: 'read-only', futureField: true },
        });

        expect((parsed.permissions as Record<string, unknown>).futureField).toBe(true);
    });
});
