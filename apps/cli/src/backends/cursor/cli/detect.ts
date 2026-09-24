import type { CliDetectSpec } from '@/backends/types';

export const cliDetect = {
  versionArgsToTry: [['--version'], ['-v'], ['version']],
  loginStatusArgs: ['about', '--format', 'json'],
} satisfies CliDetectSpec;
