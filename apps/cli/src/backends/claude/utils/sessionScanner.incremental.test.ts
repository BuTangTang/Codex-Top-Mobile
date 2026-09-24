import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scannerMockState = vi.hoisted(() => ({
    readCalls: 0,
    watcherCallbacks: new Map<string, (file: string) => void>(),
}));

vi.mock('./readClaudeSessionJsonlMessages', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./readClaudeSessionJsonlMessages')>();
    return {
        ...actual,
        readClaudeSessionJsonlMessages: async (...args: Parameters<typeof actual.readClaudeSessionJsonlMessages>) => {
            scannerMockState.readCalls += 1;
            return actual.readClaudeSessionJsonlMessages(...args);
        },
    };
});

vi.mock('@/integrations/watcher/startFileWatcher', () => ({
    startFileWatcher: (file: string, onFileChange: (file: string) => void) => {
        scannerMockState.watcherCallbacks.set(file, onFileChange);
        return () => {
            scannerMockState.watcherCallbacks.delete(file);
        };
    },
}));

import type { RawJSONLines } from '../types';
import { createSessionScanner } from './sessionScanner';

async function waitFor(predicate: () => boolean, timeoutMs = 2_000, intervalMs = 10): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Timed out waiting for condition');
}

function assistantLine(uuid: string, text: string, sessionId: string): string {
    return `${JSON.stringify({
        type: 'assistant',
        uuid,
        sessionId,
        message: {
            role: 'assistant',
            content: [{ type: 'text', text }],
        },
    } satisfies RawJSONLines)}\n`;
}

describe('sessionScanner incremental following', () => {
    let testDir: string;
    let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;

    beforeEach(async () => {
        scannerMockState.readCalls = 0;
        scannerMockState.watcherCallbacks.clear();
        testDir = await mkdtemp(join(tmpdir(), 'scanner-incremental-'));
        await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        if (scanner) {
            await scanner.cleanup();
            scanner = null;
        }
        if (existsSync(testDir)) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    it('uses the watcher-backed follower for appends after the initial tail snapshot', async () => {
        const sessionId = '11111111-1111-4111-8111-222222222222';
        const transcriptPath = join(testDir, `${sessionId}.jsonl`);
        await writeFile(transcriptPath, assistantLine('assistant-1', 'first', sessionId), 'utf8');

        const messages: RawJSONLines[] = [];
        scanner = await createSessionScanner({
            sessionId: null,
            workingDirectory: testDir,
            onMessage: (message) => messages.push(message),
        });

        scanner.onNewSession({ sessionId, transcriptPath });
        await waitFor(() => messages.length === 1);
        const readCallsAfterSnapshot = scannerMockState.readCalls;
        expect(readCallsAfterSnapshot).toBeGreaterThan(0);

        await appendFile(transcriptPath, assistantLine('assistant-2', 'second', sessionId), 'utf8');
        scannerMockState.watcherCallbacks.get(transcriptPath)?.(transcriptPath);

        await waitFor(() => messages.length === 2);
        expect(scannerMockState.readCalls).toBe(readCallsAfterSnapshot);
        expect(messages.map((message) => (message as { uuid?: string }).uuid)).toEqual(['assistant-1', 'assistant-2']);
    });
});
