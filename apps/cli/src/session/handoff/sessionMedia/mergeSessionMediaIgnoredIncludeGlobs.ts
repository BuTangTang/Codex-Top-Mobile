import type { SessionHandoffWorkspaceTransfer } from '@happier-dev/protocol';

function toLiteralGitPathspec(relativePath: string): string {
  return `:(literal)${relativePath}`;
}

export function mergeSessionMediaIgnoredIncludeGlobs(input: Readonly<{
  workspaceTransfer: SessionHandoffWorkspaceTransfer;
  referencedMediaPaths: readonly string[];
}>): SessionHandoffWorkspaceTransfer {
  if (input.referencedMediaPaths.length === 0) {
    return {
      ...input.workspaceTransfer,
      ignoredIncludeGlobs: [...input.workspaceTransfer.ignoredIncludeGlobs],
    };
  }

  const ignoredIncludeGlobs = new Set<string>(input.workspaceTransfer.ignoredIncludeGlobs);
  for (const path of input.referencedMediaPaths) {
    ignoredIncludeGlobs.add(toLiteralGitPathspec(path));
  }

  return {
    ...input.workspaceTransfer,
    includeIgnoredMode: 'include_selected',
    ignoredIncludeGlobs: [...ignoredIncludeGlobs],
  };
}
