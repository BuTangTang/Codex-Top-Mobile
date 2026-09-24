import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { extractCodexGeneratedMedia, sanitizeCodexRevisedPrompt } from './extractCodexGeneratedMedia';

describe('extractCodexGeneratedMedia', () => {
  it('emits saved paths without reading provider-controlled files before daemon authorization', async () => {
    const dir = join(tmpdir(), `happier-codex-media-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const imagePath = join(dir, 'misleading.png');
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    await writeFile(imagePath, jpegBytes);

    const media = extractCodexGeneratedMedia({
      id: 'img_1',
      type: 'image_generation_call',
      status: 'completed',
      saved_path: imagePath,
    });

    expect(media).toEqual([
        {
          kind: 'local-file',
          path: imagePath,
          origin: {
            source: 'provider-generated',
            generationId: 'img_1',
            providerEventId: 'img_1',
        },
        dedupeKey: 'codex:image-generation:img_1:saved_path',
      },
    ]);
    await expect(readFile(imagePath)).resolves.toEqual(jpegBytes);
  });

  it('prefers a saved path over duplicating or falling back to the base64 result', async () => {
    const dir = join(tmpdir(), `happier-codex-media-prefer-path-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const imagePath = join(dir, 'missing-provider-file.png');

    const media = extractCodexGeneratedMedia({
      id: 'img_with_path',
      type: 'imageGeneration',
      status: 'generating',
      result: 'iVBORw0KGgo=',
      savedPath: imagePath,
    });

    expect(media).toEqual([
        {
          kind: 'local-file',
          path: imagePath,
          origin: {
            source: 'provider-generated',
            generationId: 'img_with_path',
            providerEventId: 'img_with_path',
        },
        dedupeKey: 'codex:image-generation:img_with_path:saved_path',
      },
    ]);
  });

  it('does not emit base64 image media when the bytes do not sniff as an image', () => {
    const media = extractCodexGeneratedMedia({
      id: 'img_invalid',
      type: 'image_generation_call',
      status: 'completed',
      result: Buffer.from('not an image', 'utf8').toString('base64'),
    });

    expect(media).toEqual([]);
  });

  it('emits final media when Codex marks a result-bearing image item as generating', () => {
    const media = extractCodexGeneratedMedia({
      id: 'img_generating_final',
      type: 'imageGeneration',
      status: 'generating',
      result: 'iVBORw0KGgo=',
    });

    expect(media).toEqual([
      {
        kind: 'base64',
        data: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        origin: {
          source: 'provider-generated',
          generationId: 'img_generating_final',
          providerEventId: 'img_generating_final',
        },
        dedupeKey: 'codex:image-generation:img_generating_final:result',
      },
    ]);
  });

  it('sanitizes revised prompts before attaching provenance', () => {
    expect(sanitizeCodexRevisedPrompt('  a\0\n\tprompt  ', { maxRevisedPromptChars: 20 })).toBe('a prompt');
  });
});
