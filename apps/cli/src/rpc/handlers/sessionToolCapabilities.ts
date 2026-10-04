import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import type { FilesystemAccessPolicy } from './fileSystem/accessPolicy/filesystemAccessPolicy';
import { registerRipgrepHandler } from './ripgrep';
import { registerDifftasticHandler } from './difftastic';

export type SessionToolRegistrar = (
  manager: RpcHandlerRegistrar,
  workingDirectory: string,
  options?: Readonly<{ accessPolicy?: FilesystemAccessPolicy }>,
) => void;

/** 默认工具沿原顺序同步注册，保留各工具的路径授权与执行逻辑。 */
export const sessionToolRegistrars: readonly SessionToolRegistrar[] = Object.freeze([
  registerRipgrepHandler,
  registerDifftasticHandler,
]);
