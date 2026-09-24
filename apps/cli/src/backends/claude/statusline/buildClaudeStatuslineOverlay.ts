import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveClaudeConfigRootFromEnv } from '../unifiedTerminal/tuiControls';

/**
 * Statusline forwarder overlay for the Claude Unified terminal spawn.
 *
 * The spawn builder merges `statusLine: { type: 'command', command: <forwarder> }` into the
 * single `--settings` overlay. The forwarder wrapper POSTs Claude's statusline payload to the
 * session hook server and exec-chains the user's ORIGINAL statusline command, which is resolved
 * here from the EFFECTIVE settings of the spawned config root (the materialized/source
 * `settings.json` the session uses — same root resolution as the TUI settings guard) and carried
 * base64-encoded so quoting survives the settings JSON → shell round trip.
 */

export type ClaudeStatuslineOriginalCommand = Readonly<{
    command: string;
    padding?: number | undefined;
}>;

export function resolveClaudeStatuslineOriginalCommand(params: Readonly<{
    env: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform | undefined;
}>): ClaudeStatuslineOriginalCommand | null {
    try {
        const configRoot = resolveClaudeConfigRootFromEnv(params.env, params.platform ?? process.platform);
        const parsed = JSON.parse(readFileSync(join(configRoot, 'settings.json'), 'utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const statusLine = (parsed as Record<string, unknown>).statusLine;
        if (!statusLine || typeof statusLine !== 'object' || Array.isArray(statusLine)) return null;
        const record = statusLine as Record<string, unknown>;
        if (record.type !== 'command') return null;
        const command = typeof record.command === 'string' ? record.command.trim() : '';
        if (!command) return null;
        const padding = typeof record.padding === 'number' && Number.isFinite(record.padding)
            ? record.padding
            : undefined;
        return { command, ...(padding !== undefined ? { padding } : {}) };
    } catch {
        // Missing/unreadable settings: behave as if no statusline is configured (fail-open).
        return null;
    }
}

export type ClaudeStatuslineOverlaySettings = Readonly<{
    type: 'command';
    command: string;
    padding?: number | undefined;
}>;

export function buildClaudeStatuslineOverlaySettings(params: Readonly<{
    nodeExecutable: string;
    forwarderScriptPath: string;
    port: number;
    secretFilePath: string;
    original: ClaudeStatuslineOriginalCommand | null;
}>): ClaudeStatuslineOverlaySettings {
    const parts = [
        JSON.stringify(params.nodeExecutable),
        JSON.stringify(params.forwarderScriptPath),
        String(params.port),
        '--secret-file',
        JSON.stringify(params.secretFilePath),
    ];
    if (params.original) {
        parts.push(Buffer.from(params.original.command, 'utf8').toString('base64'));
    }
    return {
        type: 'command',
        command: parts.join(' '),
        ...(params.original?.padding !== undefined ? { padding: params.original.padding } : {}),
    };
}
