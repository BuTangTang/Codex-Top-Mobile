import { describe, expect, it, vi } from 'vitest';

import type { OpenCodeServerRuntimeClient } from '../client';

type OpenCodeCatalogControlParams = Readonly<{
  cwd: string | null;
  metadata?: Record<string, unknown> | null;
}>;

async function importCatalogControlModule(): Promise<{
  createOpenCodeServerCatalogControlAdapter?: unknown;
}> {
  return await import('./openCodeServerCatalogControlAdapter');
}

type OpenCodeCatalogClient = Pick<OpenCodeServerRuntimeClient, 'appSkills' | 'dispose'>;

async function createAdapter(params: Readonly<{
  createClient: (args: Readonly<{ directory: string }>) => Promise<OpenCodeCatalogClient>;
}>): Promise<{
  listVendorPlugins: (params: OpenCodeCatalogControlParams) => Promise<unknown>;
  listSkills: (params: OpenCodeCatalogControlParams) => Promise<unknown>;
}> {
  const module = await importCatalogControlModule();
  expect(module.createOpenCodeServerCatalogControlAdapter).toBeTypeOf('function');
  return (module.createOpenCodeServerCatalogControlAdapter as (deps: {
    createClient: typeof params.createClient;
  }) => {
    listVendorPlugins: (params: OpenCodeCatalogControlParams) => Promise<unknown>;
    listSkills: (params: OpenCodeCatalogControlParams) => Promise<unknown>;
  })({
    createClient: params.createClient,
  });
}

describe('openCodeServerCatalogControlAdapter', () => {
  it('routes inactive OpenCode skill listing through the stored server runtime handle', async () => {
    const client = {
      appSkills: vi.fn(async () => [
        {
          name: 'reviewer',
          description: 'Review code',
          location: '/repo/.agents/skills/reviewer/SKILL.md',
          content: 'private prompt text',
        },
      ]),
      dispose: vi.fn(async () => {}),
    } satisfies OpenCodeCatalogClient;
    const createClient = vi.fn(async () => client);
    const adapter = await createAdapter({ createClient });

    await expect(adapter.listSkills({
      cwd: '/repo',
      metadata: {
        agentRuntimeDescriptorV1: {
          v: 1,
          providerId: 'opencode',
          provider: {
            backendMode: 'server',
            serverBaseUrl: 'http://127.0.0.1:4096/',
            serverBaseUrlExplicit: true,
            vendorSessionId: 'oc_1',
          },
        },
      },
    })).resolves.toEqual({
      supported: true,
      skills: [
        {
          name: 'reviewer',
          displayName: 'reviewer',
          description: 'Review code',
          path: '/repo/.agents/skills/reviewer/SKILL.md',
          origin: 'opencode_native',
          enabled: true,
        },
      ],
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith({
      directory: '/repo',
      baseUrlOverride: 'http://127.0.0.1:4096/',
    });
    expect(client.appSkills).toHaveBeenCalledTimes(1);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not start a shared managed OpenCode server for passive skill listing when the session runtime handle has no server url', async () => {
    const createClient = vi.fn(async () => ({
      appSkills: vi.fn(async () => []),
      dispose: vi.fn(async () => {}),
    }));
    const adapter = await createAdapter({ createClient });

    await expect(adapter.listSkills({
      cwd: '/repo',
      metadata: {
        agentRuntimeDescriptorV1: {
          v: 1,
          providerId: 'opencode',
          provider: {
            backendMode: 'server',
            vendorSessionId: 'oc_1',
          },
        },
      },
    })).resolves.toEqual({
      unsupported: true,
      skills: [],
      diagnostic: 'session_catalog_control_unavailable',
    });

    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports vendor plugins unsupported for OpenCode server sessions', async () => {
    const adapter = await createAdapter({
      createClient: async () => ({
        appSkills: vi.fn(async () => []),
        dispose: vi.fn(async () => {}),
      }),
    });

    await expect(adapter.listVendorPlugins({ cwd: '/repo' })).resolves.toEqual({
      unsupported: true,
      vendorPlugins: [],
      diagnostic: 'session_catalog_control_unsupported',
    });
  });
});
