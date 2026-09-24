import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const watcherMockState = vi.hoisted(() => ({
    started: [] as string[],
    stopped: [] as string[],
}));

vi.mock('@/integrations/watcher/startFileWatcher', () => ({
    startFileWatcher: (file: string, onFileChange: (file: string) => void) => {
        watcherMockState.started.push(file);
        onFileChange(file);
        return () => {
            watcherMockState.stopped.push(file);
        };
    },
}));

import type { RawJSONLines } from '../types';
import { getProjectPath } from './path';
import { createSessionScanner } from './sessionScanner';

async function waitFor(predicate: () => boolean, timeoutMs = 2_000, intervalMs = 25): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Timed out waiting for condition');
}

describe('sessionScanner cleanup', () => {
    let testDir: string;
    let projectDir: string;
    let claudeConfigDir: string;

    beforeEach(async () => {
        watcherMockState.started = [];
        watcherMockState.stopped = [];
        testDir = await mkdtemp(join(tmpdir(), 'scanner-cleanup-'));
        claudeConfigDir = join(testDir, 'claude-config');
        projectDir = getProjectPath(testDir, claudeConfigDir);
        await mkdir(projectDir, { recursive: true });
    });

    afterEach(async () => {
        if (existsSync(testDir)) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    it('does not recreate active transcript watchers during cleanup', async () => {
        const sessionId = '11111111-1111-4111-8111-111111111111';
        const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
        await writeFile(transcriptPath, `${JSON.stringify({
            type: 'assistant',
            uuid: 'assistant-before-cleanup',
            sessionId,
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ready' }],
            },
        } as RawJSONLines)}\n`);

        const messages: RawJSONLines[] = [];
        const scanner = await createSessionScanner({
            sessionId: null,
            claudeConfigDir,
            workingDirectory: testDir,
            onMessage: (message) => messages.push(message),
        });

        scanner.onNewSession({ sessionId, transcriptPath });
        await waitFor(() => messages.length === 1);

        const startedBeforeCleanup = watcherMockState.started.length;
        expect(startedBeforeCleanup).toBeGreaterThan(0);

        await scanner.cleanup();

        expect(watcherMockState.stopped).toHaveLength(startedBeforeCleanup);
        expect(watcherMockState.started).toHaveLength(startedBeforeCleanup);
    });
});
