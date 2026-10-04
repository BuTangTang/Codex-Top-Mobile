import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as errors from './machineRegistrationErrors';

describe('machine registration error owner compatibility', () => {
    let isolatedHome: string;
    beforeAll(() => {
        isolatedHome = mkdtempSync(join(tmpdir(), 'happier-machine-error-owner-'));
        vi.stubEnv('HOME', isolatedHome);
        vi.stubEnv('HAPPIER_HOME_DIR', isolatedHome);
        vi.stubEnv('CODEX_HOME', join(isolatedHome, 'codex'));
        vi.stubEnv('HAPPIER_SERVER_URL', 'https://relay.example.test');
    });
    afterAll(() => {
        vi.unstubAllEnvs();
        rmSync(isolatedHome, { recursive: true, force: true });
    });

    it('re-exports the exact same constructors and predicates through the public API', async () => {
        const publicApi = await import('../api');
        for (const name of Object.keys(errors) as Array<keyof typeof errors>) {
            expect(publicApi[name]).toBe(errors[name]);
        }
        expect(new publicApi.MachineReplacedError('synthetic-machine', 'replacement'))
            .toBeInstanceOf(errors.MachineReplacedError);
        expect(new errors.MachineRevokedError('synthetic-machine'))
            .toBeInstanceOf(publicApi.MachineRevokedError);
    });

    it('keeps native Error identity and the fields used by existing registration recovery', () => {
        const cases = [
            { value: new errors.MachineIdConflictError('synthetic-machine'), name: 'MachineIdConflictError' },
            { value: new errors.MachineRevokedError('synthetic-machine'), name: 'MachineRevokedError' },
            { value: new errors.MachineReplacedError('synthetic-machine', 'replacement'), name: 'MachineReplacedError' },
            { value: new errors.MachineContentPublicKeyMismatchError('synthetic-machine', 'content_public_key_mismatch'), name: 'MachineContentPublicKeyMismatchError' },
        ];
        for (const { value, name } of cases) {
            expect(value).toBeInstanceOf(Error);
            expect(value).toMatchObject({ name, machineId: 'synthetic-machine' });
            expect(value.message.length).toBeGreaterThan(0);
        }
        expect(cases[3].value).toMatchObject({ reason: 'content_public_key_mismatch' });
    });

    it.each([
        [undefined, null],
        [null, null],
        ['', null],
        ['  ', null],
        [' replacement ', 'replacement'],
    ])('keeps replacement normalization for %j', (replacement, expected) => {
        expect(new errors.MachineReplacedError('synthetic-machine', replacement).replacementMachineId).toBe(expected);
    });

    it('accepts structural errors from another module instance with the original field rules', () => {
        expect(errors.isMachineIdConflictError({ name: 'MachineIdConflictError', machineId: 'synthetic-machine' })).toBe(true);
        expect(errors.isMachineRevokedError({ name: 'MachineRevokedError', machineId: ' ' })).toBe(true);
        for (const replacementMachineId of [undefined, null, '', 'replacement']) {
            expect(errors.isMachineReplacedError({ name: 'MachineReplacedError', machineId: 'synthetic-machine', replacementMachineId })).toBe(true);
        }
        expect(errors.isMachineContentPublicKeyMismatchError({ name: 'MachineContentPublicKeyMismatchError', machineId: 'synthetic-machine', reason: ' ' })).toBe(true);
    });

    it('rejects incomplete structural evidence without converting unrelated failures into recovery', () => {
        const predicates = [errors.isMachineIdConflictError, errors.isMachineRevokedError,
            errors.isMachineReplacedError, errors.isMachineContentPublicKeyMismatchError];
        for (const predicate of predicates) {
            for (const value of [null, undefined, 0, '', {}, new Error('unrelated')]) expect(predicate(value)).toBe(false);
        }
        expect(errors.isMachineIdConflictError({ name: 'MachineIdConflictError', machineId: '' })).toBe(false);
        expect(errors.isMachineRevokedError({ name: 'MachineRevokedError', machineId: 1 })).toBe(false);
        expect(errors.isMachineReplacedError({ name: 'MachineReplacedError', machineId: 'synthetic-machine', replacementMachineId: 1 })).toBe(false);
        expect(errors.isMachineContentPublicKeyMismatchError({ name: 'MachineContentPublicKeyMismatchError', machineId: 'synthetic-machine', reason: '' })).toBe(false);
    });
});
