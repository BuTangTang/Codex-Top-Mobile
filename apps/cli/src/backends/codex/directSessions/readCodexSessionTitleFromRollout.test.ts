import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCodexSessionTitleFromRollout } from './readCodexSessionTitleFromRollout';
import { withTempDir } from '@/testkit/fs/tempDir';

function sessionMetaLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ type: 'session_meta', payload })}\n`;
}

function responseItemLine(params: { timestamp: string; payload: Record<string, unknown> }): string {
  return `${JSON.stringify({ type: 'response_item', timestamp: params.timestamp, payload: params.payload })}\n`;
}

describe('readCodexSessionTitleFromRollout', () => {
  it.each([
    '<codex_internal_context>Injected only</codex_internal_context>\n<in-app-browser-context>Browser data</in-app-browser-context>\nRepair the title list',
    '<codex_internal_context><environment_context>nested</environment_context>Injected</codex_internal_context>\nRepair the title list',
    '<INSTRUCTIONS>Harness rules</INSTRUCTIONS>\n<environment_context>Workspace</environment_context>\nRepair the title list',
    '<codex_internal_context>outer<codex_internal_context>inner</codex_internal_context>outer</codex_internal_context>Repair the title list',
    '<app-context origin="desktop">Injected</app-context><instructions/>Repair the title list',
  ])('removes injected blocks before deriving the user title: %s', async (text) => {
    await withTempDir('codex-title-injection-', async (root) => {
      const file = join(root, 'rollout.jsonl');
      await writeFile(file, responseItemLine({ timestamp: '2026-09-24T00:00:00Z', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text }],
      } }));
      await expect(readCodexSessionTitleFromRollout(file)).resolves.toBe('Repair the title list');
    });
  });

  it.each(['app-context-menu', 'instructions-editor', 'instructions:editor'])('preserves ordinary component tags with the suffix %s', async (tag) => {
    await withTempDir('codex-title-component-', async (root) => {
      const file = join(root, 'rollout.jsonl');
      const text = `修复 <${tag}> 的点击处理`;
      await writeFile(file, responseItemLine({ timestamp: '2026-09-24T00:00:00Z', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text }],
      } }));
      await expect(readCodexSessionTitleFromRollout(file)).resolves.toBe(text);
    });
  });

  it('does not turn an injection-only conversation into a title', async () => {
    await withTempDir('codex-title-empty-', async (root) => {
      const file = join(root, 'rollout.jsonl');
      await writeFile(file, responseItemLine({ timestamp: '2026-09-24T00:00:00Z', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text: '<codex_internal_context>Only hidden text</codex_internal_context>' }],
      } }));
      await expect(readCodexSessionTitleFromRollout(file)).resolves.toBeNull();
    });
  });

  it('skips injection-only and truncated injected messages before taking a later user task', async () => {
    await withTempDir('codex-title-priority-', async (root) => {
      const file = join(root, 'rollout.jsonl');
      const messages = ['<codex_internal_context>hidden</codex_internal_context>', '<in-app-browser-context>unfinished secret', 'User task'];
      const lines = messages.map((text) => responseItemLine({ timestamp: '2026-09-24T00:00:00Z', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text }],
      } }));
      await writeFile(file, lines.join(''));
      await expect(readCodexSessionTitleFromRollout(file)).resolves.toBe('User task');
    });
  });

  it('skips title boilerplate and scans later pages for the first meaningful user task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-title-'));
    const sessionsDir = join(root, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '11111111-1111-1111-1111-111111111111';
    const filePath = join(sessionsDir, `rollout-2026-03-06T00-00-00-${sessionId}.jsonl`);
    const boilerplate = [
      '# Session title',
      "At the start of the session (before you respond to the first user message), you MUST call the change_title tool once to set a short, descriptive session title based on the user's message.",
    ].join('\n');
    const meaningfulTask = 'Investigate direct transcript paging parity in the direct session browser';

    const lines = [
      sessionMetaLine({ id: sessionId, timestamp: '2026-03-06T00:00:00.000Z', cwd: '/repo/one' }),
      ...Array.from({ length: 80 }, (_, index) =>
        responseItemLine({
          timestamp: `2026-03-06T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: boilerplate }],
          },
        }),
      ),
      responseItemLine({
        timestamp: '2026-03-06T00:02:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: meaningfulTask }],
        },
      }),
    ];

    await writeFile(filePath, lines.join(''), 'utf8');

    await expect(readCodexSessionTitleFromRollout(filePath)).resolves.toBe(meaningfulTask);
  });
});
