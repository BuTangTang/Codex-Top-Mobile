/** 原生产品的构建组成；默认 Happier CLI 不读取此清单。 */
export const CODEX_TOP_ARTIFACT_PROFILE = {
  id: 'codex-top',
  revision: 1,
  sourceEntry: 'src/product/codextop.ts',
  aliases: {
    '@/backends/catalogRegistry': 'src/backends/catalogRegistry.codexTop.ts',
    '@/daemon/memory/daemonMemoryCapability': 'src/runtime/profiles/codexTopCapabilities.ts',
    '@/rpc/handlers/sessionToolCapabilities': 'src/runtime/profiles/codexTopCapabilities.ts',
    '@/runtime/productCapabilities': 'src/runtime/profiles/codexTopCapabilities.ts',
  },
  // 真实 managed-child/MCP 路径使用的入口，和主入口一起生成、共用 chunks。
  additionalEntries: [
    'src/backends/codex/happyMcpStdioBridge.ts',
    'src/mcp/bridges/remoteMcpStdioBridge.ts',
    'src/mcp/launchers/stdioMcpServerLauncher.ts',
  ],
  externals: ['sharp', 'node-pty', '@homebridge/node-pty-prebuilt-multiarch'],
  sidecars: [
    'childProcessOptions.cjs',
    'terminal_launch_spec_runner.cjs',
    'node_pty_relay.cjs',
    'shims/git',
  ],
  // 封闭的 darwin-arm64 运行资源。其它架构必须另行验证清单，不能照搬本机产物。
  nativePackages: [
    { name: 'node-pty', version: '1.1.0', entries: ['package.json', 'LICENSE', 'lib', 'prebuilds/darwin-arm64/pty.node', 'prebuilds/darwin-arm64/spawn-helper'] },
    // 原 fallback 在本机无 native binary，保留原 loader/失败语义，不带其它平台的二进制。
    { name: '@homebridge/node-pty-prebuilt-multiarch', version: '0.13.1', entries: ['package.json', 'LICENSE', 'lib'] },
    { name: 'sharp', version: '0.34.5', entries: ['package.json', 'LICENSE', 'lib'] },
    { name: '@img/sharp-darwin-arm64', version: '0.34.5', entries: ['package.json', 'LICENSE', 'lib/sharp-darwin-arm64.node'] },
    { name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4', entries: ['package.json', 'README.md', 'lib/index.js', 'lib/libvips-cpp.8.17.3.dylib', 'lib/glib-2.0', 'versions.json'] },
  ],
  // Sharp 的真实 JS 运行依赖，采用安装包本身的依赖解析；不是整个 CLI package.json。
  runtimePackages: [
    { name: '@img/colour', version: '1.0.0', entries: ['package.json', 'LICENSE.md', 'color.cjs', 'index.cjs'] },
    { name: 'detect-libc', version: '2.1.2', entries: ['package.json', 'LICENSE', 'lib'] },
    { name: 'semver', version: '7.7.3', entries: ['package.json', 'LICENSE', 'index.js', 'preload.js', 'classes', 'functions', 'internal', 'ranges'] },
  ],
} as const;

export function assertCodexTopArtifactTarget(target: Readonly<{ os: string; arch: string; bunTarget: string }>): void {
  if (target.os !== 'darwin' || target.arch !== 'arm64' || target.bunTarget !== 'bun-darwin-arm64') {
    throw new Error('[codex-top-artifact] only the verified darwin-arm64 resource layout is supported');
  }
}
