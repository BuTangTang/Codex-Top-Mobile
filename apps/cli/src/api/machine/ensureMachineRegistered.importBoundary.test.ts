import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('ensureMachineRegistered import boundary', () => {
    it('keeps registration recovery without importing the general API capability graph', async () => {
        // 只在内存观察真实入口依赖，不执行注册或读取任何账号数据。
        const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
        const result = await build({
            absWorkingDir: cliRoot,
            entryPoints: [fileURLToPath(new URL('./ensureMachineRegistered.ts', import.meta.url))],
            bundle: true,
            write: false,
            metafile: true,
            platform: 'node',
            format: 'esm',
            packages: 'external',
            alias: { '@': `${cliRoot}src` },
            logLevel: 'silent',
        });
        const modules = Object.keys(result.metafile!.inputs);
        expect(modules).toEqual(expect.arrayContaining(['src/configuration.ts', 'src/persistence.ts']));
        const unrelatedCapabilities = [
            'src/api/api.ts',
            'src/api/apiMachine.ts',
            'src/api/session/sessionClient.ts',
            'src/api/machine/rpcHandlers.ts',
            'src/backends/catalog.ts',
        ];
        expect(modules.filter((module) => unrelatedCapabilities.includes(module))).toEqual([]);
    });

    it('keeps the shared error owner free of local and external runtime dependencies', async () => {
        const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
        const result = await build({
            absWorkingDir: cliRoot,
            entryPoints: [fileURLToPath(new URL('./machineRegistrationErrors.ts', import.meta.url))],
            bundle: true,
            write: false,
            metafile: true,
            platform: 'node',
            format: 'esm',
            packages: 'external',
            logLevel: 'silent',
        });
        expect(Object.keys(result.metafile!.inputs)).toEqual(['src/api/machine/machineRegistrationErrors.ts']);
        expect(result.metafile!.inputs['src/api/machine/machineRegistrationErrors.ts'].imports).toEqual([]);
    });
});
