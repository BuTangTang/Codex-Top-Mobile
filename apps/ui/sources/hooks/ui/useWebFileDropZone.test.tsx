import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { useWebFileDropZone } from './useWebFileDropZone';

describe('useWebFileDropZone native fallback', () => {
    it('keeps noop handlers stable across unchanged parent rerenders', async () => {
        const onFilesDropped = vi.fn();
        const onFileDragActiveChange = vi.fn();

        const hook = await renderHook(
            (props: Parameters<typeof useWebFileDropZone>[0]) => useWebFileDropZone(props),
            {
                initialProps: {
                    enabled: true,
                    onFilesDropped,
                    onFileDragActiveChange,
                },
            },
        );

        const initial = hook.getCurrent();

        await hook.rerender({
            enabled: true,
            onFilesDropped,
            onFileDragActiveChange,
        });

        expect(hook.getCurrent()).toBe(initial);
    });
});
