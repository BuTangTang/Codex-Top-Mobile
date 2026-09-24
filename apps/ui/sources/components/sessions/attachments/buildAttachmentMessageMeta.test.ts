import { describe, expect, it } from 'vitest';

import { buildAttachmentMessageMeta } from './buildAttachmentMessageMeta';

describe('buildAttachmentMessageMeta', () => {
    it('preserves transcript attachment metadata while adding structured image metadata', () => {
        const meta = buildAttachmentMessageMeta([
            {
                name: 'screen.png',
                path: '.happier/uploads/messages/m1/screen.png',
                mimeType: 'image/png',
                sizeBytes: 42,
                sha256: 'h1',
                structuredInput: {
                    type: 'localImage',
                    kind: 'image',
                    localPath: '.happier/uploads/messages/m1/screen.png',
                    path: '.happier/uploads/messages/m1/screen.png',
                    mimeType: 'image/png',
                    name: 'screen.png',
                    sizeBytes: 42,
                    sha256: 'h1',
                },
            },
        ]);

        expect(meta).toMatchObject({
            happier: {
                kind: 'attachments.v1',
                payload: {
                    attachments: [
                        {
                            name: 'screen.png',
                            path: '.happier/uploads/messages/m1/screen.png',
                            mimeType: 'image/png',
                            sizeBytes: 42,
                            sha256: 'h1',
                        },
                    ],
                },
            },
            happierStructuredInputV1: {
                v: 1,
                attachments: [
                    {
                        type: 'localImage',
                        kind: 'image',
                        localPath: '.happier/uploads/messages/m1/screen.png',
                        path: '.happier/uploads/messages/m1/screen.png',
                        provenance: { kind: 'sessionAttachmentUpload' },
                    },
                ],
            },
        });
        expect(JSON.stringify(meta)).not.toContain('imageInputs');
    });
});
