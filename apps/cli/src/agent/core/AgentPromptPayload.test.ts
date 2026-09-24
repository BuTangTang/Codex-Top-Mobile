import { describe, expect, it, vi } from 'vitest';

import type { AgentBackend } from './AgentBackend';

describe('AgentPromptPayload', () => {
  it('uses payload-aware sending when the backend supports it', async () => {
    const mod = await import('./AgentPromptPayload').catch(() => null);
    expect(mod?.sendAgentPromptPayload).toEqual(expect.any(Function));

    const backend = {
      sendPrompt: vi.fn(async () => {}),
      sendPromptPayload: vi.fn(async () => {}),
    } as unknown as AgentBackend;

    await mod!.sendAgentPromptPayload(backend, 'sess_1', {
      text: 'plain text fallback',
      meta: {
        happierStructuredInputV1: {
          v: 1,
          vendorPluginMentions: [{ vendorPluginRef: 'plugin://gmail@openai-curated' }],
        },
      },
    });

    expect((backend as any).sendPromptPayload).toHaveBeenCalledWith('sess_1', expect.objectContaining({
      text: 'plain text fallback',
      meta: expect.objectContaining({
        happierStructuredInputV1: expect.any(Object),
      }),
    }));
    expect(backend.sendPrompt).not.toHaveBeenCalled();
  });

  it('falls back to text-only sendPrompt for older backends', async () => {
    const mod = await import('./AgentPromptPayload').catch(() => null);
    expect(mod?.sendAgentPromptPayload).toEqual(expect.any(Function));

    const backend = {
      sendPrompt: vi.fn(async () => {}),
    } as unknown as AgentBackend;

    await mod!.sendAgentPromptPayload(backend, 'sess_1', {
      text: 'text only',
      meta: { happierSkillMentions: [{ name: 'frontend-design' }] },
    });

    expect(backend.sendPrompt).toHaveBeenCalledWith('sess_1', 'text only');
  });

  it('mirrors structured imageInputs to attachments for payload-aware backends', async () => {
    const mod = await import('./AgentPromptPayload').catch(() => null);
    expect(mod?.sendAgentPromptPayload).toEqual(expect.any(Function));

    const backend = {
      sendPrompt: vi.fn(async () => {}),
      sendPromptPayload: vi.fn(async () => {}),
    } as unknown as AgentBackend;

    await mod!.sendAgentPromptPayload(backend, 'sess_1', {
      text: 'inspect image',
      meta: {
        happierStructuredInputV1: {
          v: 1,
          imageInputs: [{ type: 'localImage', path: '/tmp/image.png', mimeType: 'image/png' }],
        },
      },
    });

    expect((backend as any).sendPromptPayload).toHaveBeenCalledWith('sess_1', expect.objectContaining({
      meta: {
        happierStructuredInputV1: expect.objectContaining({
          imageInputs: [{ type: 'localImage', path: '/tmp/image.png', mimeType: 'image/png' }],
          attachments: [{ type: 'localImage', path: '/tmp/image.png', mimeType: 'image/png' }],
        }),
      },
    }));
  });
});
