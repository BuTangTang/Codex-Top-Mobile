import { realpathSync } from 'node:fs'
import { posix, win32 } from 'node:path'

import type { RpcHandlerRegistrar } from '@/api/rpc/types'
import {
  type FilesystemAccessPolicy,
  resolveFilesystemAccessPolicy,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy'
import type { MachineFileBrowserRoot } from '@happier-dev/protocol'
import { RPC_METHODS } from '@happier-dev/protocol/rpc'

import { resolveMachineFileBrowserConfig } from './machineFileBrowserConfig'
import { listMachineBrowseDirectory } from './listMachineBrowseDirectory'
import { listMachineBrowseRoots } from './listMachineBrowseRoots'
import { resolveMachineBrowseRoots } from './resolveMachineBrowseRoots'

type RegisterMachineFileBrowserHandlersParams = Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar
  accessPolicy?: FilesystemAccessPolicy
  deps?: Readonly<{
    resolveRoots?: typeof resolveMachineBrowseRoots
    maxEntries?: number
    statConcurrency?: number
    platform?: NodeJS.Platform
  }>
}>

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix
}

function canonicalizeBrowseRoot(rootPath: string, platform: NodeJS.Platform): string {
  const resolved = pathApi(platform).resolve(rootPath)
  if (platform !== process.platform) {
    return resolved
  }
  try {
    return realpathSync.native?.(resolved) ?? realpathSync(resolved)
  } catch {
    return resolved
  }
}

function rootsFromRestrictedPolicy(accessPolicy: FilesystemAccessPolicy, platform: NodeJS.Platform): MachineFileBrowserRoot[] | null {
  if (accessPolicy.kind !== 'restrictedRoots') {
    return null
  }

  const roots: MachineFileBrowserRoot[] = []
  const seen = new Set<string>()
  for (const root of accessPolicy.roots) {
    const path = canonicalizeBrowseRoot(root, platform)
    if (seen.has(path)) continue
    seen.add(path)
    roots.push({ id: path, label: path, path })
  }
  return roots
}

export function registerMachineFileBrowserHandlers(params: RegisterMachineFileBrowserHandlersParams): void {
  const config = resolveMachineFileBrowserConfig()
  const resolveRoots = params.deps?.resolveRoots ?? resolveMachineBrowseRoots
  const maxEntries = params.deps?.maxEntries ?? config.maxEntries
  const statConcurrency = params.deps?.statConcurrency ?? config.statConcurrency
  const platform = params.deps?.platform ?? process.platform
  const accessPolicy = params.accessPolicy ?? resolveFilesystemAccessPolicy({ platform })
  const restrictedRoots = rootsFromRestrictedPolicy(accessPolicy, platform)

  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_FILESYSTEM_LIST_ROOTS,
    async () => await listMachineBrowseRoots({
      resolveRoots: async () => restrictedRoots ?? await resolveRoots({ platform }),
    }),
  )

  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_FILESYSTEM_LIST_DIRECTORY,
    async (raw) => {
      const roots = restrictedRoots ?? await resolveRoots({ platform })
      return await listMachineBrowseDirectory({
        raw,
        roots,
        platform,
        maxEntries,
        statConcurrency,
      })
    },
  )
}
