import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { installSessionAttachmentCommonModuleMocks } from '../sessionAttachmentTestHelpers';

const flashListCompatMockState = vi.hoisted(() => ({
    mappingKeyCalls: [] as Array<Readonly<{ index: number; itemKey: string | number | bigint }>>,
}));

installSessionAttachmentCommonModuleMocks();

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/flashListCompat/FlashListCompat', () => ({
    useMappingHelper: () => ({
        getMappingKey: (itemKey: string | number | bigint, index: number) => {
            flashListCompatMockState.mappingKeyCalls.push({ itemKey, index });
            return index;
        },
    }),
}));

describe('AttachmentsMessageRow recycling keys', () => {
    it('routes attachment chip keys through the FlashList mapping helper', async () => {
        const { AttachmentsMessageRow } = await import('./AttachmentsMessageRow');
        const attachments = [
            {
                name: 'first.txt',
                path: 'uploads/first.txt',
                mimeType: 'text/plain',
                sizeBytes: 12,
            },
            {
                name: 'second.png',
                path: 'uploads/second.png',
                mimeType: 'image/png',
                sizeBytes: 24,
            },
        ];

        await renderScreen(
            <AttachmentsMessageRow
                attachments={attachments}
                onOpenPath={() => {}}
            />,
        );

        expect(flashListCompatMockState.mappingKeyCalls).toEqual([
            { itemKey: `${attachments[0].path}:${attachments[0].name}`, index: 0 },
            { itemKey: `${attachments[1].path}:${attachments[1].name}`, index: 1 },
        ]);
    });
});
