import { describe, expect, it } from 'vitest';

import { migrateAccountSettingsServerIdentityKeys } from './serverIdentityKeyMigration';

describe('migrateAccountSettingsServerIdentityKeys', () => {
    it('preserves explicit expanded collapsed-group tombstones when legacy keys collide with identity keys', () => {
        const result = migrateAccountSettingsServerIdentityKeys({
            settings: {
                collapsedGroupKeysV1: {
                    'server:localhost-18829:active:project:shared': true,
                    'server:srv_identity:active:project:shared': false,
                    'server:localhost-18829:active:project:legacy-only': true,
                },
            },
            currentServerId: 'srv_identity',
            legacyServerIds: ['localhost-18829'],
            rewriteUnknownServerIds: false,
        });

        expect(result.settings.collapsedGroupKeysV1).toEqual({
            'server:srv_identity:active:project:shared': false,
            'server:srv_identity:active:project:legacy-only': true,
        });
        expect(result.changedKeys).toEqual(['collapsedGroupKeysV1']);
    });
});
