import { readFile, writeFile, mkdir, copyFile, chmod, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// 由 canonical builder 在持有构建锁、完成不可变源码快照后调用。
const [sourceRootArg, outputDirArg, profilePath, metadataPath] = process.argv.slice(2);
if (!sourceRootArg || !outputDirArg || !profilePath || !metadataPath) throw new Error('Missing product bundle build arguments');
const sourceRoot = resolve(sourceRootArg);
const outputDir = resolve(outputDirArg);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
if (profile.id !== 'codex-top' || profile.revision !== 1) throw new Error('Unknown product artifact profile');

// 只改这次不可变快照的入口，正式源码和默认 CLI dist 均不覆盖。
await writeFile(join(sourceRoot, 'src/index.ts'), "import './product/codextop';\n");
await mkdir(outputDir, { recursive: true });
const aliases = Object.fromEntries(Object.entries(profile.aliases).map(([key, path]) => [key, resolve(sourceRoot, path)]));
const result = await Bun.build({
  entrypoints: [join(sourceRoot, 'src/index.ts'), ...profile.additionalEntries.map(path => join(sourceRoot, path))],
  root: join(sourceRoot, 'src'),
  outdir: outputDir,
  target: 'bun',
  format: 'esm',
  splitting: true,
  naming: { entry: '[dir]/[name].mjs', chunk: 'chunks/[name]-[hash].mjs', asset: 'assets/[name]-[hash].[ext]' },
  minify: { syntax: true, whitespace: true, identifiers: false },
  keepNames: true,
  metafile: true,
  external: profile.externals,
  plugins: [{
    name: 'codex-top-explicit-product-profile',
    setup(build) {
      build.onResolve({ filter: /^@\// }, ({ path }) => aliases[path] ? { path: aliases[path] } : undefined);
    },
  }],
});
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  throw new Error('Codex Top product bundle failed');
}
// 共享同一份运行时和 JS，避免 compile 把相同代码再次嵌入可执行文件。
// 拷贝这次实际执行构建的 Bun；产品启动不依赖 PATH、系统 Node 或用户缓存。
const runtimeDir = resolve(outputDir, '../runtime');
await mkdir(runtimeDir, { recursive: true });
const runtimePath = join(runtimeDir, 'bun');
await copyFile(process.execPath, runtimePath);
await chmod(runtimePath, (await stat(process.execPath)).mode & 0o777);
const runtimeBytes = await readFile(runtimePath);
await writeFile(metadataPath, JSON.stringify({ ...result.metafile,
  codexTopBuildRuntime: { version: Bun.version, revision: Bun.revision,
    sha256: createHash('sha256').update(runtimeBytes).digest('hex'), bytes: runtimeBytes.length },
}, null, 2) + '\n');
// 在编译可执行文件前阻止错误 alias 回拉已明确不属于产品的实现。
const retained = new Set(Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs)
  .filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name.replaceAll('\\', '/'))));
const forbidden = [...retained].filter(name => /\/backends\/catalogRegistry\.ts$|\/@huggingface\/|\/@anthropic-ai\/claude-agent-sdk\/|\/rpc\/handlers\/(?:difftastic|ripgrep)(?:\.ts$|\/)/.test('/' + name));
if (forbidden.length) throw new Error('Unexpected non-product dependencies retained: ' + forbidden.join(', '));
console.log(JSON.stringify({ profile: profile.id, outputs: result.outputs.length, retainedModules: retained.size }));
