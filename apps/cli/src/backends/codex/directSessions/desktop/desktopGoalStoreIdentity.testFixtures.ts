import { type execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const SYNTHETIC_DESKTOP_MAIN = '/Applications/ChatGPT.app/Contents/MacOS/Codex';
export const SYNTHETIC_DESKTOP_SERVER = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export const SYNTHETIC_DESKTOP_START = 'Sat Oct  3 10:00:00 2026';

type FixtureOptions = Readonly<{ resolvedHome: string; databasePath?: string }>;

/** External OS response fixture only: database identity always comes from the real synthetic file. */
export async function readDesktopGoalStoreIdentityCommandFixture(command: string, args: readonly string[],
    options: FixtureOptions): Promise<string | null> {
    const uid = process.getuid?.() ?? 0;
    if (command === '/usr/bin/plutil') {
        return args.at(-1) === '/Applications/ChatGPT.app/Contents/Info.plist'
            ? JSON.stringify({ CFBundleIdentifier: 'com.openai.codex', CFBundleExecutable: 'Codex' })
            : '{}';
    }
    if (command === '/bin/ps' && args.includes('-axo')) {
        return `4100 1 ${uid} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_MAIN}\n`
            + `4101 4100 ${uid} ${SYNTHETIC_DESKTOP_START} ${SYNTHETIC_DESKTOP_SERVER}\n`;
    }
    if (command === '/bin/ps' && args.includes('-p')) {
        return `4101 ${SYNTHETIC_DESKTOP_SERVER} -c synthetic=true app-server --analytics-default-enabled\n`;
    }
    if (command === '/usr/sbin/lsof') {
        const path = options.databasePath ?? join(options.resolvedHome, 'goals_1.sqlite');
        const info = await lstat(path, { bigint: true });
        const fields = [
            'p4100', 'ftxt', 'tREG', `n${SYNTHETIC_DESKTOP_MAIN}`,
            'f10u', 'tunix', `n${join(options.resolvedHome, 'ipc', 'ipc.sock')}`,
            'p4101', 'ftxt', 'tREG', `n${SYNTHETIC_DESKTOP_SERVER}`,
            'f11u', 'tREG', `D0x${info.dev.toString(16)}`, `i${info.ino}`, `n${path}`,
            'f12u', 'tREG', `D0x${info.dev.toString(16)}`, `i${info.ino}`, `n${path}`,
        ];
        return fields.join('\0') + '\0';
    }
    return null;
}

/** Callback-shaped replacement for node:child_process.execFile; does not replace verifier internals. */
export function createDesktopGoalStoreIdentityExecFileMock(options: FixtureOptions): typeof execFile {
    return ((command: string, args: readonly string[], ...rest: unknown[]) => {
        const callback = rest.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
        void readDesktopGoalStoreIdentityCommandFixture(command, args, options).then(
            (stdout) => stdout === null ? callback(new Error('Unrecognized synthetic OS command'), '', '') : callback(null, stdout, ''),
            (error: unknown) => callback(error instanceof Error ? error : new Error('Synthetic OS boundary failed'), '', ''),
        );
        return {} as ReturnType<typeof execFile>;
    }) as typeof execFile;
}
