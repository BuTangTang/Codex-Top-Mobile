import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const PROBE_BUDGET_MS = 1_000;
const APP_PATHS = ['/Applications/ChatGPT.app', '/Applications/Codex.app'];
type Bundle = Readonly<{ executable: string; server: string }>;
type ProcessInfo = Readonly<{ pid: number; parent: number; uid: number; started: string; executable: string }>;
type OpenFile = { pid: number; descriptor: string; type?: string; device?: string; inode?: string; name?: string };

/** No shell, retries or long-lived child: each command receives only the remaining total budget. */
async function commandOutput(command: string, args: string[], deadline: number): Promise<string> {
    const timeout = Math.floor(deadline - performance.now());
    if (timeout <= 0) throw new Error('Desktop identity probe expired');
    return new Promise<string>((resolve, reject) => {
        execFile(command, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 1_048_576,
            env: { ...process.env, LC_ALL: 'C' } },
        (error, stdout) => { if (error) reject(error); else resolve(stdout); });
    });
}

async function installedBundles(deadline: number): Promise<Bundle[]> {
    const bundles = await Promise.all(APP_PATHS.map(async (path): Promise<Bundle | null> => {
        try {
            const value: unknown = JSON.parse(await commandOutput('/usr/bin/plutil',
                ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')], deadline));
            if (!value || typeof value !== 'object' || !('CFBundleIdentifier' in value)
                || value.CFBundleIdentifier !== 'com.openai.codex' || !('CFBundleExecutable' in value)) return null;
            const name = value.CFBundleExecutable;
            if (typeof name !== 'string' || !name || name === '.' || name === '..'
                || basename(name) !== name || /[\r\n\0]/.test(name)) return null;
            return { executable: join(path, 'Contents', 'MacOS', name),
                server: join(path, 'Contents', 'Resources', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex') };
        } catch { return null; }
    }));
    return bundles.filter((value): value is Bundle => value !== null);
}

async function processes(deadline: number): Promise<Map<number, ProcessInfo>> {
    const stdout = await commandOutput('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm='], deadline);
    const result = new Map<number, ProcessInfo>();
    for (const line of stdout.split('\n').filter((line) => line.trim())) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
        if (!match) throw new Error('Unrecognized process snapshot');
        const info = { pid: Number(match[1]), parent: Number(match[2]), uid: Number(match[3]),
            started: match[4]!.replace(/\s+/g, ' '), executable: match[5]! };
        if (!Number.isSafeInteger(info.pid) || result.has(info.pid)) throw new Error('Ambiguous process snapshot');
        result.set(info.pid, info);
    }
    return result;
}

async function processCommands(pids: number[], deadline: number): Promise<Map<number, string>> {
    const stdout = await commandOutput('/bin/ps', ['-ww', '-p', pids.join(','), '-o', 'pid=,args='], deadline);
    const result = new Map<number, string>();
    for (const line of stdout.split('\n').filter((line) => line.trim())) {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (!match || !pids.includes(Number(match[1])) || result.has(Number(match[1]))) throw new Error('Ambiguous process command');
        result.set(Number(match[1]), match[2]!);
    }
    if (result.size !== pids.length) throw new Error('Process disappeared');
    return result;
}

/** Recognize the actual subcommand, excluding option values and nested command arguments. */
function commandRole(command: string, executable: string): 'app-server' | 'other' | 'unknown' {
    if (!command.startsWith(`${executable} `)) return 'unknown';
    const tokens = command.slice(executable.length).trim().split(/\s+/);
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (['-c', '--config', '--enable', '--disable', '-p', '--profile'].includes(token)) {
            if (!tokens[++index]) return 'unknown';
        } else if (/^--(?:config|enable|disable|profile)=.+$/.test(token)) {
            continue;
        } else if (token.startsWith('-')) return 'unknown';
        else return token === 'app-server' ? 'app-server' : 'other';
    }
    return 'unknown';
}

function openFiles(stdout: string): OpenFile[] {
    const result: OpenFile[] = [];
    let pid: number | undefined;
    let current: OpenFile | undefined;
    const flush = () => { if (current) result.push(current); current = undefined; };
    for (const raw of stdout.split('\0')) {
        const field = raw.replace(/^\n/, '');
        if (!field) continue;
        const value = field.slice(1);
        if (field[0] === 'p') {
            flush(); if (!/^\d+$/.test(value)) throw new Error('Invalid process identity'); pid = Number(value);
        } else if (field[0] === 'f') {
            flush(); if (pid === undefined) throw new Error('Missing process identity'); current = { pid, descriptor: value };
        } else if (current) {
            if (field[0] === 't') current.type = value;
            else if (field[0] === 'D') current.device = value;
            else if (field[0] === 'i') current.inode = value;
            else if (field[0] === 'n') current.name = value;
        }
    }
    flush(); return result;
}

function signature(process: ProcessInfo): string { return JSON.stringify(process); }

async function verifyIdentity(home: string, databasePath: string, uid: number, deadline: number): Promise<boolean> {
    const beforeFile = await lstat(databasePath, { bigint: true });
    if (!beforeFile.isFile() || beforeFile.isSymbolicLink() || beforeFile.uid !== BigInt(uid)) return false;
    const bundles = await installedBundles(deadline);
    if (bundles.length === 0) return false;
    const before = await processes(deadline);
    const mains = [...before.values()].filter((process) => bundles.some((bundle) => bundle.executable === process.executable));
    if (mains.length !== 1 || mains[0]!.uid !== uid) return false;
    const main = mains[0]!;
    const bundle = bundles.find((bundle) => bundle.executable === main.executable)!;
    const direct = [...before.values()].filter((process) => process.parent === main.pid && process.executable === bundle.server);
    if (direct.length === 0) return false;
    const pids = direct.map((process) => process.pid).sort((left, right) => left - right);
    const commands = await processCommands(pids, deadline);
    const roles = direct.map((process) => ({ process, role: commandRole(commands.get(process.pid)!, bundle.server) }));
    if (roles.some(({ role }) => role === 'unknown')) return false;
    const servers = roles.filter(({ role }) => role === 'app-server').map(({ process }) => process);
    if (servers.length !== 1 || servers[0]!.uid !== uid) return false;
    const server = servers[0]!;
    const files = openFiles(await commandOutput('/usr/sbin/lsof',
        ['-nP', '-a', '-p', `${main.pid},${server.pid}`, '-F', '0pftDin'], deadline));
    const executableMatches = (process: ProcessInfo) => files.some((file) => file.pid === process.pid
        && file.descriptor === 'txt' && file.type === 'REG' && file.name === process.executable);
    if (!executableMatches(main) || !executableMatches(server)
        || !files.some((file) => file.pid === main.pid && file.type === 'unix' && file.name === join(home, 'ipc', 'ipc.sock'))) return false;
    const goals = files.filter((file) => file.pid === server.pid && file.name !== undefined
        && /(?:^|\/)goals_[^/]*\.sqlite(?: \(deleted\))?$/.test(file.name));
    if (goals.length === 0 || new Set(goals.map((file) => file.name)).size !== 1
        || goals.some((file) => file.name !== databasePath || file.type !== 'REG'
            || !/^0x[\da-f]+$/i.test(file.device ?? '') || !/^\d+$/.test(file.inode ?? '')
            || BigInt(file.device!) !== beforeFile.dev || BigInt(file.inode!) !== beforeFile.ino)) return false;
    const after = await processes(deadline);
    const afterMains = [...after.values()].filter((process) => bundles.some((bundle) => bundle.executable === process.executable));
    const afterDirect = [...after.values()].filter((process) => process.parent === main.pid && process.executable === bundle.server);
    if (afterMains.length !== 1 || signature(afterMains[0]!) !== signature(main)
        || afterDirect.length !== direct.length || direct.some((process) => !after.has(process.pid)
            || signature(after.get(process.pid)!) !== signature(process))) return false;
    const afterCommands = await processCommands(pids, deadline);
    if (pids.some((pid) => afterCommands.get(pid) !== commands.get(pid))) return false;
    const afterFile = await lstat(databasePath, { bigint: true });
    return performance.now() < deadline && afterFile.isFile() && !afterFile.isSymbolicLink()
        && afterFile.uid === beforeFile.uid && afterFile.dev === beforeFile.dev && afterFile.ino === beforeFile.ino;
}

/** Verify the current official local host's open file; never infer a database from configuration. */
export async function verifyDesktopGoalStoreIdentity(resolvedHome: string, databasePath: string): Promise<boolean> {
    const uid = process.getuid?.();
    if (process.platform !== 'darwin' || uid === undefined || !isAbsolute(resolvedHome)
        || resolve(resolvedHome) !== resolvedHome || /[\r\n\0]/.test(resolvedHome)
        || databasePath !== join(resolvedHome, 'goals_1.sqlite')) return false;
    const deadline = performance.now() + PROBE_BUDGET_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            verifyIdentity(resolvedHome, databasePath, uid, deadline).catch(() => false),
            new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PROBE_BUDGET_MS); }),
        ]);
    } finally { if (timer) clearTimeout(timer); }
}
