import { beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedGeminiCliCapabilityParams = Readonly<{
  resolveAcpProbeArgs?: (params: Readonly<{
    resolvedPath: string;
    defaultArgs: readonly string[];
  }>) => Promise<string[]> | string[];
}>;

const {
  capturedCapabilityParams,
  createAcpCliCapability,
  requireProviderCliLaunchSpec,
  resolveGeminiAcpFlag,
} = vi.hoisted(() => {
  const capturedCapabilityParams: { current: CapturedGeminiCliCapabilityParams | null } = { current: null };
  return {
    createAcpCliCapability: vi.fn((params: CapturedGeminiCliCapabilityParams) => {
      capturedCapabilityParams.current = params;
      return { descriptor: { id: 'cli.gemini' } };
    }),
    requireProviderCliLaunchSpec: vi.fn(),
    resolveGeminiAcpFlag: vi.fn(() => '--experimental-acp'),
    capturedCapabilityParams,
  };
});

vi.mock('@/capabilities/probes/createAcpCliCapability', () => ({
  createAcpCliCapability,
}));

vi.mock('@/runtime/managedTools/requireProviderCliLaunchSpec', () => ({
  requireProviderCliLaunchSpec,
}));

vi.mock('./detect', () => ({
  resolveGeminiAcpFlag,
}));

describe('gemini cli capability', () => {
  beforeEach(() => {
    vi.resetModules();
    createAcpCliCapability.mockClear();
    capturedCapabilityParams.current = null;
    requireProviderCliLaunchSpec.mockReset();
    resolveGeminiAcpFlag.mockReset();
    resolveGeminiAcpFlag.mockReturnValue('--experimental-acp');
    requireProviderCliLaunchSpec.mockReturnValue({
      source: 'managed',
      resolvedPath: '/tmp/gemini.js',
      command: '/runtime/node',
      args: ['/tmp/gemini.js'],
    });
  });

  it('resolves the ACP help probe through the canonical Gemini launch spec', async () => {
    await import('./capability');

    const resolveAcpProbeArgs = capturedCapabilityParams.current?.resolveAcpProbeArgs;
    expect(typeof resolveAcpProbeArgs).toBe('function');

    await expect(resolveAcpProbeArgs?.({
      resolvedPath: '/tmp/gemini.js',
      defaultArgs: ['--acp'],
    })).resolves.toEqual(['--experimental-acp']);

    expect(requireProviderCliLaunchSpec).toHaveBeenCalledWith('gemini', { processEnv: process.env });
    expect(resolveGeminiAcpFlag).toHaveBeenCalledWith({
      command: '/runtime/node',
      baseArgs: ['/tmp/gemini.js'],
      env: process.env,
    });
  });
});
