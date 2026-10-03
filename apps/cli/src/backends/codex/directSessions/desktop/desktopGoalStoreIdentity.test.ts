import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDesktopGoalStoreIdentity } from './desktopGoalStoreIdentity';
import { readDesktopGoalStoreIdentityCommandFixture, SYNTHETIC_DESKTOP_MAIN, SYNTHETIC_DESKTOP_SERVER,
    SYNTHETIC_DESKTOP_START } from './desktopGoalStoreIdentity.testFixtures';

vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn(),
}));

describe('Desktop goal store OS identity', () => {
    let home: string;
    let databasePath: string;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    type Transform = (command: string, args: readonly string[], stdout: string) => string;
    function boundary(transform: Transform = (_command, _args, stdout) => stdout) {
        vi.mocked(execFile).mockImplementation(((command: string, args: readonly string[], ...rest: unknown[]) => {
            const callback = rest.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
            void readDesktopGoalStoreIdentityCommandFixture(command, args, { resolvedHome: home }).then(
                (stdout) => callback(null, transform(command, args, stdout ?? ''), ''),
                () => callback(new Error('Synthetic OS failure'), '', ''),
            ).catch(() => callback(new Error('Synthetic OS failure'), '', ''));
            return {} as ReturnType<typeof execFile>;
        }) as typeof execFile);
    }
    const verify = () => verifyDesktopGoalStoreIdentity(home, databasePath);
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'desktop-goal-identity-'));
        databasePath = join(home, 'goals_1.sqlite');
        // File identity is real; the verifier never opens the SQLite contents.
        await writeFile(databasePath, 'synthetic database identity only');
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        vi.mocked(execFile).mockReset(); boundary();
    });
    afterEach(async () => {
        vi.useRealTimers(); Object.defineProperty(process, 'platform', originalPlatform);
        await rm(home, { recursive: true, force: true });
    });
    it('accepts one official family, its exact router and duplicate descriptors for the same real file', async () => {
        expect(await verify()).toBe(true);
        expect(vi.mocked(execFile).mock.calls.every((call) => {
            const options = call[2] as { timeout: number; killSignal: string };
            return options.timeout > 0 && options.timeout <= 1_000 && options.killSignal === 'SIGKILL';
        })).toBe(true);
    });
    it('accepts the separately supported Codex.app installation', async () => {
        boundary((command, args, stdout) => command === '/usr/bin/plutil'
            ? args.at(-1) === '/Applications/Codex.app/Contents/Info.plist'
                ? JSON.stringify({ CFBundleIdentifier: 'com.openai.codex', CFBundleExecutable: 'Codex' }) : '{}'
            : stdout.replaceAll('/Applications/ChatGPT.app/', '/Applications/Codex.app/'));
        expect(await verify()).toBe(true);
    });
    it.each(['linux', 'win32'])('does not probe unsupported platform %s', async (platform) => {
        Object.defineProperty(process, 'platform', { value: platform });
        expect(await verify()).toBe(false); expect(execFile).not.toHaveBeenCalled();
    });
    it('rejects a database outside the exact resolved source and symlinks', async () => {
        expect(await verifyDesktopGoalStoreIdentity(home, join(home, 'other.sqlite'))).toBe(false);
        await rm(databasePath); await symlink(join(home, 'missing'), databasePath);
        expect(await verify()).toBe(false);
    });
    it.each(['{}', '{"CFBundleIdentifier":"other","CFBundleExecutable":"Codex"}',
        '{"CFBundleIdentifier":"com.openai.codex","CFBundleExecutable":"../Codex"}', 'invalid'])('rejects unverified app metadata: %s', async (value) => {
        boundary((command, _args, stdout) => command === '/usr/bin/plutil' ? value : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects two official main processes', async () => {
        boundary((command, args, stdout) => command === '/bin/ps' && args.includes('-axo')
            ? stdout + `4200 1 ${process.getuid!()} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_MAIN}\n` : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects two direct app-server children', async () => {
        boundary((command, args, stdout) => command !== '/bin/ps' ? stdout : args.includes('-axo')
            ? stdout + `4102 4100 ${process.getuid!()} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_SERVER}\n`
            : stdout + `4102 ${SYNTHETIC_DESKTOP_SERVER} app-server\n`);
        expect(await verify()).toBe(false);
    });
    it('excludes a non-app-server direct child and a nested tool app-server', async () => {
        boundary((command, args, stdout) => command !== '/bin/ps' ? stdout : args.includes('-axo')
            ? stdout + `4102 4100 ${process.getuid!()} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_SERVER}\n`
                + `4103 4101 ${process.getuid!()} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_SERVER}\n`
            : stdout + `4102 ${SYNTHETIC_DESKTOP_SERVER} exec app-server\n`);
        expect(await verify()).toBe(true);
    });
    it('does not mistake a global option value for the app-server subcommand', async () => {
        boundary((command, args, stdout) => command === '/bin/ps' && args.includes('-p')
            ? `4101 ${SYNTHETIC_DESKTOP_SERVER} -c app-server exec\n` : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects another user owning the process family', async () => {
        boundary((command, args, stdout) => command === '/bin/ps' && args.includes('-axo')
            ? stdout.replaceAll(` ${process.getuid!()} ${SYNTHETIC_DESKTOP_START}`, ` ${process.getuid!() + 1} ${SYNTHETIC_DESKTOP_START}`) : stdout);
        expect(await verify()).toBe(false);
    });
    it.each(['main executable', 'server executable', 'router', 'device', 'inode', 'database path', 'deleted database'])('rejects mismatching %s evidence', async (failure) => {
        boundary((command, _args, stdout) => {
            if (command !== '/usr/sbin/lsof') return stdout;
            if (failure === 'main executable') return stdout.replace(`n${SYNTHETIC_DESKTOP_MAIN}\0`, 'n/other-main\0');
            if (failure === 'server executable') return stdout.replace(`n${SYNTHETIC_DESKTOP_SERVER}\0`, 'n/other-server\0');
            if (failure === 'router') return stdout.replace(`n${join(home, 'ipc', 'ipc.sock')}\0`, 'n/other/ipc.sock\0');
            if (failure === 'device') return stdout.replaceAll(/D0x[0-9a-f]+\0/g, 'D0x0\0');
            if (failure === 'inode') return stdout.replaceAll(/i[0-9]+\0/g, 'i0\0');
            if (failure === 'database path') return stdout.replaceAll(`n${databasePath}\0`, 'n/other/goals_1.sqlite\0');
            return stdout.replaceAll(`n${databasePath}\0`, `n${databasePath} (deleted)\0`);
        });
        expect(await verify()).toBe(false);
    });
    it('rejects multiple opened goal stores even when one matches', async () => {
        boundary((command, _args, stdout) => command === '/usr/sbin/lsof'
            ? stdout + 'f13u\0tREG\0D0x1\0i123\0n/other/goals_2.sqlite\0' : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects a changed process start time after the file proof', async () => {
        let snapshots = 0;
        boundary((command, args, stdout) => command === '/bin/ps' && args.includes('-axo') && ++snapshots > 1
            ? stdout.replaceAll(SYNTHETIC_DESKTOP_START, 'Sat Oct  3 10:00:01 2026') : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects changed command roles after the file proof', async () => {
        let commands = 0;
        boundary((command, args, stdout) => command === '/bin/ps' && args.includes('-p') && ++commands > 1
            ? stdout.replace(' app-server ', ' exec-server ') : stdout);
        expect(await verify()).toBe(false);
    });
    it('rejects a replaced database inode after the file proof', async () => {
        let lsofSeen = false;
        vi.mocked(execFile).mockImplementation(((command: string, args: readonly string[], ...rest: unknown[]) => {
            const callback = rest.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
            void (async () => {
                const stdout = await readDesktopGoalStoreIdentityCommandFixture(command, args, { resolvedHome: home });
                if (command === '/usr/sbin/lsof') lsofSeen = true;
                else if (lsofSeen && command === '/bin/ps') {
                    await rm(databasePath); await writeFile(databasePath, 'replacement'); lsofSeen = false;
                }
                callback(null, stdout ?? '', '');
            })().catch(() => callback(new Error('Synthetic failure'), '', ''));
            return {} as ReturnType<typeof execFile>;
        }) as typeof execFile);
        expect(await verify()).toBe(false);
    });
    it('returns false within the total budget when an OS callback never returns', async () => {
        vi.useFakeTimers(); vi.mocked(execFile).mockImplementation(() => ({} as ReturnType<typeof execFile>));
        const pending = verify();
        await vi.advanceTimersByTimeAsync(1_001);
        expect(await pending).toBe(false);
        expect(vi.mocked(execFile).mock.calls.length).toBeLessThanOrEqual(2);
    });
    it('returns false on an OS command error without retrying', async () => {
        boundary((command, _args, stdout) => { if (command === '/usr/sbin/lsof') throw new Error('Synthetic lsof error'); return stdout; });
        expect(await verify()).toBe(false);
        expect(vi.mocked(execFile).mock.calls.filter((call) => call[0] === '/usr/sbin/lsof')).toHaveLength(1);
    });
});
