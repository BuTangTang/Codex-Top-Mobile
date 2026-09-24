import { existsSync as defaultExistsSync, readFileSync as defaultReadFileSync } from 'node:fs';
import { resolve } from 'node:path';

function normalizeWorkspacePackageName(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('@happier-dev/')) {
    return value.slice('@happier-dev/'.length).trim();
  }
  return value;
}

function readJson(path, { readFileSync = defaultReadFileSync } = {}) {
  return JSON.parse(String(readFileSync(path, 'utf8')));
}

function collectInternalDependencyNames(pkgJson, currentPackageName) {
  const dependencies = new Set();
  for (const field of [pkgJson?.dependencies, pkgJson?.optionalDependencies, pkgJson?.devDependencies]) {
    if (!field || typeof field !== 'object') continue;
    for (const dependencyName of Object.keys(field)) {
      if (!dependencyName.startsWith('@happier-dev/')) continue;
      if (dependencyName === currentPackageName) continue;
      const normalized = normalizeWorkspacePackageName(dependencyName);
      if (normalized) {
        dependencies.add(normalized);
      }
    }
  }
  return [...dependencies];
}

export function resolveWorkspaceDependencyBuildOrder({
  repoRoot,
  seedPackageNames,
  existsSync = defaultExistsSync,
  readFileSync = defaultReadFileSync,
} = {}) {
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = (rawName) => {
    const workspaceName = normalizeWorkspacePackageName(rawName);
    if (!workspaceName || visited.has(workspaceName)) {
      return;
    }

    const packageJsonPath = resolve(repoRoot, 'packages', workspaceName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return;
    }

    if (visiting.has(workspaceName)) {
      return;
    }

    visiting.add(workspaceName);
    let packageJson;
    try {
      packageJson = readJson(packageJsonPath, { readFileSync });
    } catch {
      visiting.delete(workspaceName);
      return;
    }

    const currentPackageName = typeof packageJson?.name === 'string' ? packageJson.name : '';
    for (const dependencyName of collectInternalDependencyNames(packageJson, currentPackageName)) {
      visit(dependencyName);
    }

    visiting.delete(workspaceName);
    visited.add(workspaceName);
    ordered.push(workspaceName);
  };

  for (const seedName of Array.isArray(seedPackageNames) ? seedPackageNames : []) {
    visit(seedName);
  }

  return ordered;
}

export function resolveBundledWorkspaceDependencyBuildOrder({
  repoRoot,
  hostPackageDir,
  existsSync = defaultExistsSync,
  readFileSync = defaultReadFileSync,
} = {}) {
  const hostPackageJsonPath = resolve(hostPackageDir, 'package.json');
  if (!existsSync(hostPackageJsonPath)) {
    return [];
  }

  let hostPackageJson;
  try {
    hostPackageJson = readJson(hostPackageJsonPath, { readFileSync });
  } catch {
    return [];
  }

  const bundledDependencies = Array.isArray(hostPackageJson?.bundledDependencies)
    ? hostPackageJson.bundledDependencies
    : Array.isArray(hostPackageJson?.bundleDependencies)
      ? hostPackageJson.bundleDependencies
      : [];

  return resolveWorkspaceDependencyBuildOrder({
    repoRoot,
    seedPackageNames: bundledDependencies,
    existsSync,
    readFileSync,
  });
}
