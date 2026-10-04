import { readFile } from 'node:fs/promises';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('waitForSessionWebhook import boundary', () => {
  /** 检查擦除类型后的真实依赖，避免等待常量把账号查询带入 RPC 注册和 provider 图。 */
  it('does not introduce RPC registration or provider catalog runtime imports', async () => {
    const source = await readFile(new URL('./waitForSessionWebhook.ts', import.meta.url), 'utf8');
    const emitted = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const runtimeImports = ts.preProcessFile(emitted).importedFiles;

    // 类型仍可来自现有契约；只有会进入运行闭包的注册层依赖属于回归。
    for (const dependency of runtimeImports) {
      expect(dependency.fileName).not.toMatch(/(?:rpc\/handlers\/|backends\/catalog(?:\.|$))/);
    }
  });
});
