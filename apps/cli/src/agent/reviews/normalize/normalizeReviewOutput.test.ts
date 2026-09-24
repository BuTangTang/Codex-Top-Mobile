import { describe, expect, it } from 'vitest';

import { ReviewFindingsV2Schema } from '@happier-dev/protocol';

import { normalizeReviewOutput } from './normalizeReviewOutput';
import { normalizeStrictJsonReviewOutput } from './normalizeStrictJsonReviewOutput';

const codexBackendTarget = { kind: 'builtInAgent', agentId: 'codex' } as const;

function normalizeCodex(rawText: string) {
  return normalizeReviewOutput({
    runId: 'run_1',
    callId: 'call_1',
    sidechainId: 'call_1',
    backendId: 'codex',
    backendTarget: codexBackendTarget,
    startedAtMs: 10,
    finishedAtMs: 20,
    rawText,
    retentionPolicy: 'resumable',
  });
}

function parseFindingsPayload(result: ReturnType<typeof normalizeCodex>) {
  expect(result.status).toBe('succeeded');
  expect(result.structuredMeta?.kind).toBe('review_findings.v2');
  return ReviewFindingsV2Schema.parse(result.structuredMeta?.payload);
}

describe('normalizeReviewOutput codex reviews', () => {
  it('preserves strict JSON output for prompt-based Codex reviews', () => {
    const rawText = JSON.stringify({
      summary: 'Strict review completed.',
      overviewMarkdown: 'Strict overview.',
      findings: [
        {
          id: 'strict_1',
          title: 'Strict finding',
          severity: 'medium',
          category: 'correctness',
          summary: 'Strict finding body.',
          filePath: 'src/strict.ts',
          startLine: 4,
          endLine: 5,
        },
      ],
      questions: [],
      assumptions: [],
    });

    const codexResult = normalizeCodex(rawText);
    const strictResult = normalizeStrictJsonReviewOutput({
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'call_1',
      backendId: 'codex',
      backendTarget: codexBackendTarget,
      startedAtMs: 10,
      finishedAtMs: 20,
      rawText,
      retentionPolicy: 'resumable',
    });

    expect(codexResult).toEqual(strictResult);
  });

  it('parses Codex full review comments into findings', () => {
    const result = normalizeCodex([
      'The review found two issues that should be fixed before merge.',
      '',
      'Full review comments:',
      '',
      '- Missing cancellation guard - /repo/src/session.ts:10-20',
      '  The async callback still commits state after cancellation.',
      '  Check the cancelled flag before writing the result.',
      '',
      '- Handle empty paths - /repo/src/path.ts:7',
      '  Empty path input currently falls through to the filesystem call.',
    ].join('\n'));

    const payload = parseFindingsPayload(result);
    expect(payload.summary).toBe('The review found two issues that should be fixed before merge.');
    expect(payload.overviewMarkdown).toContain('Full review comments:');
    expect(payload.findings).toHaveLength(2);
    expect(payload.findings[0]).toMatchObject({
      title: 'Missing cancellation guard',
      severity: 'medium',
      category: 'correctness',
      filePath: '/repo/src/session.ts',
      startLine: 10,
      endLine: 20,
      summary: 'The async callback still commits state after cancellation.\nCheck the cancelled flag before writing the result.',
    });
    expect(payload.findings[1]).toMatchObject({
      title: 'Handle empty paths',
      filePath: '/repo/src/path.ts',
      startLine: 7,
      endLine: 7,
    });
  });

  it('parses a single Codex review comment block', () => {
    const result = normalizeCodex([
      'One correctness issue is present.',
      '',
      'Review comment:',
      '',
      '- Reject stale cache entries -- src/cache.ts:42',
      '  Cache entries are read without checking the recorded generation.',
    ].join('\n'));

    const payload = parseFindingsPayload(result);
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]).toMatchObject({
      title: 'Reject stale cache entries',
      filePath: 'src/cache.ts',
      startLine: 42,
      endLine: 42,
      summary: 'Cache entries are read without checking the recorded generation.',
    });
  });

  it('returns overview-only success for Codex prose without findings', () => {
    const result = normalizeCodex([
      'No issues found.',
      '',
      'I reviewed the requested changes and did not find any correctness issues.',
    ].join('\n'));

    const payload = parseFindingsPayload(result);
    expect(payload.summary).toBe('No issues found.');
    expect(payload.overviewMarkdown).toContain('did not find any correctness issues');
    expect(payload.findings).toEqual([]);
  });

  it('fails clearly for empty Codex native review output', () => {
    const result = normalizeCodex('   \n  ');

    expect(result.status).toBe('failed');
    expect(result.summary).toBe('Invalid review output (empty Codex native review).');
    expect(result.toolResultOutput).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_output' },
    });
  });
});
