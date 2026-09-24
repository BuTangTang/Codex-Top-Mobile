import { describe, expect, it } from 'vitest';

import {
  doesPiSessionFileNameMatchSessionId,
  encodePiSessionDirectoryCwd,
  formatPiSessionDirectoryForCwd,
  resolvePiSessionIdFromResumeReference,
} from './piSessionFiles';

/**
 * The encoder MUST be byte-identical to pi-coding-agent's `getDefaultSessionDir` so that
 * session files Happier imports/links land in the exact directory Pi will scan on resume.
 *
 * Vendor algorithm (verified against @earendil-works/pi-coding-agent 0.75.5
 * dist/core/session-manager.js `getDefaultSessionDir`):
 *
 *   const resolvedCwd = resolvePath(cwd);                 // path.resolve
 *   const dirName = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
 *
 * i.e. strip ONE leading separator, then map only `/`, `\`, `:` to `-`. It does NOT map
 * spaces/unicode, does NOT collapse repeated dashes, and does NOT trim dashes.
 *
 * Expected strings below are hand-computed from the vendor algorithm (not from our impl) so
 * this test pins the vendor contract rather than the implementation.
 */
describe('encodePiSessionDirectoryCwd — vendor-exact (pi getDefaultSessionDir)', () => {
  it('matches the vendor for a plain absolute POSIX path (regression baseline)', () => {
    const cwd = '/Users/leeroy/Documents/Development/happier/remote-dev';
    expect(encodePiSessionDirectoryCwd(cwd)).toBe(
      'Users-leeroy-Documents-Development-happier-remote-dev',
    );
    expect(formatPiSessionDirectoryForCwd(cwd)).toBe(
      '--Users-leeroy-Documents-Development-happier-remote-dev--',
    );
  });

  it('PRESERVES spaces in a path segment (vendor does not map spaces to dashes)', () => {
    // Vendor: '/Users/a b/proj' -> 'Users/a b/proj' -> 'Users-a b-proj'
    const cwd = '/Users/a b/proj';
    expect(encodePiSessionDirectoryCwd(cwd)).toBe('Users-a b-proj');
    expect(formatPiSessionDirectoryForCwd(cwd)).toBe('--Users-a b-proj--');
  });

  it('PRESERVES literal repeated dashes in a path segment (vendor does not collapse dashes)', () => {
    // Vendor: '/srv/a--b/proj' -> 'srv/a--b/proj' -> 'srv-a--b-proj'
    const cwd = '/srv/a--b/proj';
    expect(encodePiSessionDirectoryCwd(cwd)).toBe('srv-a--b-proj');
  });

  it('PRESERVES unicode in a path segment (vendor only maps / \\ :)', () => {
    // Vendor: '/Users/José/proj' -> 'Users/José/proj' -> 'Users-José-proj'
    const cwd = '/Users/José/proj';
    expect(encodePiSessionDirectoryCwd(cwd)).toBe('Users-José-proj');
  });

  it('resolves . and .. like the vendor (path.resolve) for absolute inputs', () => {
    // Vendor uses path.resolve, which collapses '.'/'..' and duplicate slashes.
    expect(encodePiSessionDirectoryCwd('/Users/x/../y/proj')).toBe('Users-y-proj');
    expect(encodePiSessionDirectoryCwd('/Users//a/b')).toBe('Users-a-b');
  });
});

/**
 * Guard the matcher + id-resolution helpers that the unified PI session discovery relies on,
 * so the K1 helper unification cannot silently regress them.
 */
describe('pi session-file name matching', () => {
  it('matches `<timestamp>_<id>.jsonl`, `<id>.jsonl`, and `session-<id>.jsonl`', () => {
    const id = '019e461b-24e2-73a9-acf4-19bc50210729';
    expect(doesPiSessionFileNameMatchSessionId(`2026-05-20T15-57-24-578Z_${id}.jsonl`, id)).toBe(true);
    expect(doesPiSessionFileNameMatchSessionId(`${id}.jsonl`, id)).toBe(true);
    expect(doesPiSessionFileNameMatchSessionId(`session-${id}.jsonl`, id)).toBe(true);
    expect(doesPiSessionFileNameMatchSessionId(`2026-05-20T15-57-24-578Z_other.jsonl`, id)).toBe(false);
    expect(doesPiSessionFileNameMatchSessionId(`${id}.txt`, id)).toBe(false);
  });

  it('resolves a vendor session id from a bare id or an absolute file path', () => {
    const id = '019e461b-24e2-73a9-acf4-19bc50210729';
    expect(resolvePiSessionIdFromResumeReference(id)).toBe(id);
    expect(
      resolvePiSessionIdFromResumeReference(`/p/--cwd--/2026-05-20T15-57-24-578Z_${id}.jsonl`),
    ).toBe(id);
    expect(resolvePiSessionIdFromResumeReference('')).toBeNull();
  });
});
