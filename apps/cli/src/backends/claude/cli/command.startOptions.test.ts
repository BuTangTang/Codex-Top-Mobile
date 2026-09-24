import { describe, expect, it } from 'vitest';

import { buildClaudeStartOptionsFromParsedArgs } from './command';
import { partitionProviderSessionArgs } from '@/cli/providerSessionArgPartition';

describe('buildClaudeStartOptionsFromParsedArgs', () => {
  it('threads --agent-mode plan into StartOptions so a plan-created session spawns Claude in plan mode (incident cmq9hemcs)', () => {
    const parsed = partitionProviderSessionArgs({
      args: [
        '--happy-starting-mode', 'remote',
        '--started-by', 'daemon',
        '--permission-mode', 'safe-yolo',
        '--permission-mode-updated-at', '1781181377912',
        '--agent-mode', 'plan',
        '--agent-mode-updated-at', '1781181377912',
        '--model', 'claude-haiku-4-5',
        '--model-updated-at', '1781181377912',
      ],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    expect(options.agentModeId).toBe('plan');
    expect(options.agentModeUpdatedAt).toBe(1781181377912);
    expect(options.permissionMode).toBe('safe-yolo');
    expect(options.permissionModeUpdatedAt).toBe(1781181377912);
    expect(options.modelId).toBe('claude-haiku-4-5');
    expect(options.startedBy).toBe('daemon');
  });

  it('omits agent-mode fields when --agent-mode is not provided', () => {
    const parsed = partitionProviderSessionArgs({
      args: ['--permission-mode', 'yolo'],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    expect('agentModeId' in options).toBe(false);
    expect('agentModeUpdatedAt' in options).toBe(false);
  });
});
