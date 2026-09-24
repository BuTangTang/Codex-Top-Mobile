import type { FilesystemAccessPolicy } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import {
  filesystemPathComparisonKey,
  normalizeFilesystemPathForPolicy,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';

export function createSessionMediaAccessPolicy(input: Readonly<{
  workingDirectory: string;
  providerMediaRoots?: readonly (string | null | undefined)[];
}>): Extract<FilesystemAccessPolicy, { kind: 'restrictedRoots' }> {
  const roots: string[] = [];
  const seen = new Set<string>();

  const addRoot = (root: string | null | undefined): void => {
    const raw = typeof root === 'string' ? root.trim() : '';
    if (!raw) return;
    const normalized = normalizeFilesystemPathForPolicy(raw);
    const key = filesystemPathComparisonKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(normalized);
  };

  addRoot(input.workingDirectory);
  for (const root of input.providerMediaRoots ?? []) {
    addRoot(root);
  }

  return { kind: 'restrictedRoots', roots };
}
