import { describe, expect, it } from 'vitest';

// FR4-7: home-relative favorite paths must be removable when toggled with
// their resolved absolute equivalent. The shared helper is colocated next to
// the new-session screen model so both the in-popover toggle and the
// standalone /new/pick/path route share the same comparison contract.
import { toggleHomeAwareDirectoryFavorite } from './favoriteDirectoriesToggle';

describe('toggleHomeAwareDirectoryFavorite (FR4-7)', () => {
    it('removes a stored home-relative favorite when toggled with its absolute equivalent', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~/src/app'],
            '/Users/alice/src/app',
            '/Users/alice',
        );
        expect(next).toEqual([]);
    });

    it('removes a stored absolute favorite when toggled with its home-relative equivalent', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['/Users/alice/src/app'],
            '~/src/app',
            '/Users/alice',
        );
        expect(next).toEqual([]);
    });

    it('preserves portable shorthand when storing a freshly added favorite', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            [],
            '~/src/app',
            '/Users/alice',
        );
        expect(next).toEqual(['~/src/app']);
    });

    it('appends the absolute path verbatim when the target is already absolute', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~/notes'],
            '/Users/alice/projects/x',
            '/Users/alice',
        );
        expect(next).toEqual(['~/notes', '/Users/alice/projects/x']);
    });

    it('removes ALL entries that resolve to the same absolute path (dedupes home-relative + absolute)', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~/src/app', '/Users/alice/src/app', '~/other'],
            '/Users/alice/src/app',
            '/Users/alice',
        );
        expect(next).toEqual(['~/other']);
    });

    it('removes a stored Windows home-relative favorite when toggled with a mixed-separator absolute equivalent', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~\\src\\app'],
            'C:/Users/Alice/src/app',
            'C:\\Users\\Alice',
        );
        expect(next).toEqual([]);
    });

    it('removes all Windows separator and case variants for the same favorite', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            [
                '~\\src\\app',
                'C:\\Users\\Alice\\src\\app',
                'c:/users/alice/src/app',
                'C:/Users/Alice/src/other',
            ],
            'C:/Users/Alice/src/app',
            'C:\\Users\\Alice',
        );
        expect(next).toEqual(['C:/Users/Alice/src/other']);
    });

    it('does not treat a Windows home sibling prefix as the same favorite', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~\\src\\app'],
            'C:/Users/Alice2/src/app',
            'C:\\Users\\Alice',
        );
        expect(next).toEqual(['~\\src\\app', 'C:/Users/Alice2/src/app']);
    });

    it('handles null / non-array input as empty', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            null,
            '/Users/alice/src/app',
            '/Users/alice',
        );
        expect(next).toEqual(['/Users/alice/src/app']);
    });

    it('falls back to raw equality when no home directory is available', () => {
        const next = toggleHomeAwareDirectoryFavorite(
            ['~/src/app'],
            '/Users/alice/src/app',
            null,
        );
        // Without a homeDir, the ~ cannot be resolved → entries do not match
        // → the target is appended.
        expect(next).toEqual(['~/src/app', '/Users/alice/src/app']);
    });

    it('handles a non-string entry defensively (drops it rather than crashing)', () => {
        // The helper accepts `ReadonlyArray<unknown>` so the runtime guard
        // is exercised by passing a mixed array directly.
        const stored: ReadonlyArray<unknown> = ['~/src/app', 42, null];
        const next = toggleHomeAwareDirectoryFavorite(
            stored,
            '/Users/alice/src/app',
            '/Users/alice',
        );
        expect(next).toEqual([]);
    });
});
