import { describe, expect, it } from 'vitest';

import { AttachSurfaceStaticMetadataV1Schema } from './declarationV1';

describe('backend surface declarations v1', () => {
  it('keeps attach surface metadata display-only', () => {
    expect(AttachSurfaceStaticMetadataV1Schema.safeParse({
      attachStrategy: 'terminal_host',
      topology: 'shared',
      locality: 'same_machine',
      maxClients: 1,
      requiresLocalAttachmentInfo: true,
      liveProbe: 'required',
    }).success).toBe(true);
    expect(AttachSurfaceStaticMetadataV1Schema.safeParse({
      attachStrategy: 'provider_attach',
      topology: 'shared',
      remoteWritable: true,
    }).success).toBe(false);
    expect(AttachSurfaceStaticMetadataV1Schema.safeParse({
      attachStrategy: 'terminal_host',
      topology: 'shared',
      injectUserPrompt: true,
    }).success).toBe(false);
  });
});
