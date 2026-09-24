import { createAcpCliCapability } from '@/capabilities/probes/createAcpCliCapability';
import { geminiTransport } from '@/backends/gemini/acp/transport';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { resolveGeminiAcpFlag } from './detect';

export const cliCapability = createAcpCliCapability({
  agentId: 'gemini',
  title: 'Gemini CLI',
  acpArgs: ['--acp'],
  transport: geminiTransport,
  resolveAcpProbeArgs: async () => {
    const launchSpec = requireProviderCliLaunchSpec('gemini', { processEnv: process.env });
    return [
      resolveGeminiAcpFlag({
        command: launchSpec.command,
        baseArgs: launchSpec.args,
        env: process.env,
      }),
    ];
  },
});
