import { describe, expect, it } from 'vitest';

import {
    MACHINE_OWNER_CONFLICT_ERROR,
    buildMachineOwnerConflictSocketPayload,
    buildMachineScopedSocketAuth,
    readMachineDaemonOwnershipMetadataFromSocketAuth,
    readMachineOwnerConflictSocketPayload,
} from './daemonOwnership.js';

describe('machine daemon ownership protocol', () => {
    it('builds machine-scoped socket auth with ownership metadata', () => {
        expect(buildMachineScopedSocketAuth({
            token: 'token',
            machineId: 'machine-1',
            runtimeId: 'runtime-1',
            cliVersion: '0.2.4',
            publicReleaseChannel: 'dev',
            startupSource: 'manual',
            serviceManaged: false,
            serviceLabel: 'com.happier.cli.daemon.default',
            installationId: 'installation-1',
            installationPublicKey: 'installation-public-key',
            installationProof: {
                version: 1,
                algorithm: 'ed25519',
                signature: 'installation-signature',
            },
            takeover: true,
        })).toEqual({
            token: 'token',
            clientType: 'machine-scoped',
            machineId: 'machine-1',
            runtimeId: 'runtime-1',
            cliVersion: '0.2.4',
            publicReleaseChannel: 'dev',
            startupSource: 'manual',
            serviceManaged: false,
            serviceLabel: 'com.happier.cli.daemon.default',
            installationId: 'installation-1',
            installationPublicKey: 'installation-public-key',
            installationProof: {
                version: 1,
                algorithm: 'ed25519',
                signature: 'installation-signature',
            },
            takeover: true,
        });
    });

    it('keeps valid ownership metadata fields while ignoring invalid or unknown input', () => {
        expect(readMachineDaemonOwnershipMetadataFromSocketAuth({
            runtimeId: 'runtime-1',
            cliVersion: '',
            publicReleaseChannel: 'preview',
            startupSource: 'invalid',
            serviceManaged: 'true',
            serviceLabel: '  ',
            ignoredField: 'ignored',
        })).toEqual({
            runtimeId: 'runtime-1',
            publicReleaseChannel: 'preview',
        });
    });

    it('round-trips shared conflict payloads and salvages valid owner fields', () => {
        const payload = buildMachineOwnerConflictSocketPayload({
            cliVersion: '0.2.0',
            publicReleaseChannel: 'stable',
            startupSource: 'background-service',
            serviceManaged: true,
            serviceLabel: 'com.happier.cli.daemon.default',
        });
        expect(readMachineOwnerConflictSocketPayload(payload)).toEqual({
            error: MACHINE_OWNER_CONFLICT_ERROR,
            statusCode: 409,
            owner: {
                cliVersion: '0.2.0',
                publicReleaseChannel: 'stable',
                startupSource: 'background-service',
                serviceManaged: true,
                serviceLabel: 'com.happier.cli.daemon.default',
            },
        });
        expect(readMachineOwnerConflictSocketPayload({
            error: MACHINE_OWNER_CONFLICT_ERROR,
            statusCode: 409,
            owner: {
                cliVersion: '0.2.0',
                startupSource: 'invalid',
                extraFutureField: 'future',
            },
        })).toEqual({
            error: MACHINE_OWNER_CONFLICT_ERROR,
            statusCode: 409,
            owner: {
                cliVersion: '0.2.0',
            },
        });
    });
});
