import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const cliRoot = fileURLToPath(new URL('../../', import.meta.url));

/** 仅在内存生成入口依赖图，观察真实 CLI 模块闭包且不启动守护进程。 */
async function readBundledCliModules(entry: string): Promise<readonly string[]> {
    const result = await build({
        absWorkingDir: cliRoot,
        entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
        bundle: true,
        write: false,
        metafile: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        alias: { '@': `${cliRoot}src` },
        logLevel: 'silent',
    });
    return Object.keys(result.metafile!.inputs);
}

describe('ApiMachineClientCore import boundary', () => {
    it('keeps the real transport and RPC owner without importing the default capability graph', async () => {
        const coreModules = await readBundledCliModules('./apiMachineCore.ts');
        expect(coreModules).toEqual(expect.arrayContaining([
            'src/configuration.ts',
            'src/api/rpc/RpcHandlerManager.ts',
            'src/api/machine/connection/createMachineSocketTransport.ts',
        ]));
        const defaultCapabilityModules = [
            'src/api/apiMachine.ts',
            'src/api/machine/rpcHandlers.ts',
            'src/rpc/handlers/registerSessionHandlers.ts',
            'src/rpc/handlers/scm.ts',
            'src/api/machine/rpcHandlers.terminal.ts',
            'src/backends/catalog.ts',
        ];
        expect(coreModules.filter((module) => defaultCapabilityModules.includes(module))).toEqual([]);

        // 默认入口仍含原注册能力，证明观察的是实际依赖闭包而非排除了所有本地模块。
        const defaultModules = await readBundledCliModules('./apiMachine.ts');
        expect(defaultModules).toEqual(expect.arrayContaining([
            'src/api/apiMachineCore.ts',
            'src/api/machine/rpcHandlers.ts',
            'src/rpc/handlers/registerSessionHandlers.ts',
            'src/backends/catalog.ts',
        ]));
    });
});
