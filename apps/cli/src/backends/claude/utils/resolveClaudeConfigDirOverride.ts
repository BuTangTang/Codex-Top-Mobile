import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

export function resolveClaudeConfigDirOverride(env: NodeJS.ProcessEnv): string | null {
  const explicit = expandHomeDirPath(typeof env.CLAUDE_CONFIG_DIR === 'string' ? env.CLAUDE_CONFIG_DIR.trim() : '', env);
  if (explicit.length > 0) return explicit;
  const happierOverride =
    expandHomeDirPath(typeof env.HAPPIER_CLAUDE_CONFIG_DIR === 'string' ? env.HAPPIER_CLAUDE_CONFIG_DIR.trim() : '', env);
  return happierOverride.length > 0 ? happierOverride : null;
}
