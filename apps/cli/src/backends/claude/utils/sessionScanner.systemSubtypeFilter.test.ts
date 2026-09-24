import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSessionScanner } from './sessionScanner';
import { getProjectPath } from './path';
import type { RawJSONLines } from '../types';

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Timed out waiting for condition');
}

describe('sessionScanner — informational system subtypes', () => {
    let testDir: string;
    let projectDir: string;
    let collected: RawJSONLines[];
    let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;
    let originalClaudeConfigDir: string | undefined;

    beforeEach(async () => {
        testDir = join(tmpdir(), `scanner-system-filter-${Date.now()}`);
        await mkdir(testDir, { recursive: true });
        originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
        process.env.CLAUDE_CONFIG_DIR = join(testDir, 'claude-config');
        projectDir = getProjectPath(testDir);
        await mkdir(projectDir, { recursive: true });
        collected = [];
    });

    afterEach(async () => {
        if (scanner) {
            await scanner.cleanup();
            scanner = null;
        }
        if (originalClaudeConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
        }
        if (existsSync(testDir)) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    it('drops stop_hook_summary and away_summary system messages but forwards user/assistant messages', async () => {
        scanner = await createSessionScanner({
            sessionId: null,
            workingDirectory: testDir,
            onMessage: (msg) => collected.push(msg),
        });

        const sessionId = 'session-informational-system-1';
        const sessionFile = join(projectDir, `${sessionId}.jsonl`);

        const lines = [
            { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
            { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
            {
                type: 'system',
                subtype: 'stop_hook_summary',
                uuid: 'sys-stop-1',
                hookCount: 1,
                hookInfos: [],
                hookErrors: [],
                preventedContinuation: false,
                stopReason: '',
            },
            {
                type: 'system',
                subtype: 'away_summary',
                uuid: 'sys-away-1',
                content: 'session recap',
            },
            { type: 'user', uuid: 'u2', message: { role: 'user', content: 'follow up' } },
        ];

        // Write file in one go so all lines are detected together.
        await writeFile(sessionFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        scanner.onNewSession(sessionId);

        // Expect exactly the 3 non-system messages — scanner should skip both system summaries.
        await waitFor(() => collected.length >= 3);
        // Give any late messages a chance to arrive before asserting count.
        await new Promise((resolve) => setTimeout(resolve, 100));

        const types = collected.map((m) => m.type);
        expect(types).toEqual(['user', 'assistant', 'user']);
        expect(collected.some((m) => m.type === 'system')).toBe(false);
    });

    it('drops informational system messages but forwards compact boundaries for lifecycle consumers', async () => {
        scanner = await createSessionScanner({
            sessionId: null,
            workingDirectory: testDir,
            onMessage: (msg) => collected.push(msg),
        });

        const sessionId = 'session-informational-system-2';
        const sessionFile = join(projectDir, `${sessionId}.jsonl`);

        const lines = [
            { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
            {
                type: 'system',
                subtype: 'init',
                uuid: 'sys-init-1',
                session_id: sessionId,
                tools: [],
            },
            {
                type: 'system',
                subtype: 'some_future_subtype',
                uuid: 'sys-future-1',
            },
            {
                type: 'system',
                subtype: 'compact_boundary',
                uuid: 'sys-compact-1',
                session_id: sessionId,
            },
        ];

        await writeFile(sessionFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        scanner.onNewSession(sessionId);

        await waitFor(() => collected.length >= 2);
        await new Promise((resolve) => setTimeout(resolve, 100));

        // `compact_boundary` is a lifecycle signal consumed by the Claude projector/turn tracker.
        // It is not transcript content; downstream raw-message bridges must still suppress it from UI rows.
        expect(collected.map((m) => m.type)).toEqual(['user', 'system']);
        expect(collected.filter((m) => m.type === 'system')).toEqual([
            expect.objectContaining({ subtype: 'compact_boundary' }),
        ]);
    });

    it('drops Claude compact summary and local-command artifacts while forwarding compact boundaries', async () => {
        scanner = await createSessionScanner({
            sessionId: null,
            workingDirectory: testDir,
            onMessage: (msg) => collected.push(msg),
        });

        const sessionId = 'session-compact-artifacts-1';
        const sessionFile = join(projectDir, `${sessionId}.jsonl`);

        const lines = [
            {
                type: 'system',
                subtype: 'compact_boundary',
                uuid: 'compact-boundary-1',
                session_id: sessionId,
                content: 'Conversation compacted',
            },
            {
                type: 'user',
                uuid: 'compact-summary-1',
                isCompactSummary: true,
                isVisibleInTranscriptOnly: true,
                message: {
                    role: 'user',
                    content: 'This session is being continued from a previous conversation that ran out of context.',
                },
            },
            {
                type: 'user',
                uuid: 'local-command-caveat-1',
                isMeta: true,
                message: {
                    role: 'user',
                    content: '<local-command-caveat>Caveat: local command messages follow.</local-command-caveat>',
                },
            },
            {
                type: 'user',
                uuid: 'compact-command-1',
                message: {
                    role: 'user',
                    content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>',
                },
            },
            {
                type: 'user',
                uuid: 'compact-stdout-1',
                message: {
                    role: 'user',
                    content:
                        '<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m\n' +
                        "\u001b[2mPreCompact [python3 '/Users/leeroy/.claude/hooks/claude-island-state.py'] completed successfully\u001b[22m\n" +
                        "\u001b[2mPostCompact [python3 '/Users/leeroy/.claude/hooks/claude-island-state.py'] completed successfully\u001b[22m</local-command-stdout>",
                },
            },
        ];

        await writeFile(sessionFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        scanner.onNewSession(sessionId);

        await waitFor(() => collected.some((m) => m.type === 'system' && (m as Record<string, unknown>).subtype === 'compact_boundary'));
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(collected).toEqual([
            expect.objectContaining({
                type: 'system',
                subtype: 'compact_boundary',
                uuid: 'compact-boundary-1',
            }),
        ]);
    });
});
