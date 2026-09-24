/**
 * Tests the FR3-12 canonicalization-parallelism contract for the enrichment
 * RPC's per-request path validation step.
 *
 * The audit observed that `getGitWorktreesEnrichment` awaited `realpath` for
 * each requested path SERIALLY, so a malformed/abusive client could trigger
 * O(N) sequential filesystem work before the intersection drop ever ran.
 *
 * Strategy: mock `realpath` (and `runScmCommand`) so we can observe call
 * timing. Pass N requested paths and assert the realpath invocations overlap
 * in flight (i.e. they ran in parallel, not strictly sequentially).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const runScmCommandMock = vi.hoisted(() => vi.fn());
const realpathMock = vi.hoisted(() => vi.fn());

vi.mock('../../runtime', () => ({
    runScmCommand: (...args: unknown[]) => runScmCommandMock(...args),
    normalizeRepoRootRelativePath: (raw: string) => ({ ok: true, relativePath: raw }),
}));

vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    return {
        ...actual,
        realpath: (...args: unknown[]) => realpathMock(...args),
    };
});

describe('getGitWorktreesEnrichment — canonicalization concurrency (FR3-12)', () => {
    afterEach(() => {
        runScmCommandMock.mockReset();
        realpathMock.mockReset();
    });

    it('canonicalizes the REQUESTED worktree paths in parallel, not serially', async () => {
        // The canonical worktree set is small (single main worktree). We need the
        // PARALLEL claim to apply specifically to the requested-paths loop, which
        // was the audit finding (serial `for…await realpath` for each requested
        // path). Multiple foreign requested paths exercise that loop without the
        // known-set realpath calls dominating.
        runScmCommandMock.mockImplementation(async (input: { args: readonly string[] }) => {
            const args = input.args ?? [];
            if (args[0] === 'worktree' && args[1] === 'list') {
                return {
                    success: true,
                    exitCode: 0,
                    stdout: [
                        'worktree /canon/repo',
                        'branch refs/heads/main',
                        '',
                    ].join('\n'),
                    stderr: '',
                    timedOut: false,
                };
            }
            // Per-worktree enrichment probes (porcelain + log). We don't care about
            // their return values for this test; the realpath-concurrency
            // assertion runs strictly before the enrichment phase.
            return { success: true, exitCode: 0, stdout: '', stderr: '', timedOut: false };
        });

        // realpath: track concurrent in-flight invocations. Each call sleeps a small
        // amount so that if requested-path canonicalization is serial,
        // observedMaxInFlight stays at 1 even with many requested paths.
        let inFlight = 0;
        let observedMaxInFlight = 0;
        // Only requested-path realpath calls count toward the in-flight tally; the
        // known-worktree-set canonicalization is unrelated to this assertion (it
        // was already parallel before the fix).
        const knownWorktreeCanonicals = new Set<string>(['/canon/repo']);
        realpathMock.mockImplementation(async (path: string) => {
            const isRequestedPath = !knownWorktreeCanonicals.has(path);
            if (isRequestedPath) {
                inFlight += 1;
                if (inFlight > observedMaxInFlight) observedMaxInFlight = inFlight;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (isRequestedPath) {
                inFlight -= 1;
            }
            return path;
        });

        const { getGitWorktreesEnrichment } = await import('./repository');

        // 1 known canonical worktree + 6 requested paths. The serial impl would
        // canonicalize each requested path one at a time (max in-flight = 1).
        // The parallel fix overlaps them up to the concurrency cap.
        const response = await getGitWorktreesEnrichment({
            context: {
                cwd: '/canon/repo',
                projectKey: 'fr3-12-parallel',
                detection: { isRepo: true, rootPath: '/canon/repo', mode: '.git' },
            },
            request: {
                worktreePaths: [
                    '/req/a',
                    '/req/b',
                    '/req/c',
                    '/req/d',
                    '/req/e',
                    '/req/f',
                ],
            },
        });

        expect(response.success).toBe(true);
        // Parallel canonicalization should overlap at least 2 realpath calls
        // simultaneously. Serial implementation gives observedMaxInFlight === 1.
        expect(observedMaxInFlight).toBeGreaterThanOrEqual(2);
    });
});
