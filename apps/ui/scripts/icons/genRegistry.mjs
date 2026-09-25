// Generates the icon registry from the verified concept mapping.
// Re-run after editing mapping.json; never hand-edit the generated file.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , mappingPath, outPath] = process.argv;
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));

// 将映射名称转换为规范组件名；保留 Icon 后缀，避免 Circle、Infinity 等名称与全局对象冲突。
const pascal = (kebab) => kebab.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Icon';
// Keyed by the PHOSPHOR name, not the old Ionicons/Octicons one. The mapping is a migration
// artifact — the app's vocabulary after this is Phosphor's, so carrying the old names forward as
// the public key would preserve exactly the split-brain the migration removes. Several old names
// collapse onto one Phosphor icon (Ionicons `git-branch-outline` and Octicons `git-branch` both
// became `git-branch`), which is the point.
// A concept may need its OWN key even though Phosphor draws it with an existing glyph, because the
// other family distinguishes them. `sidebar-right-open` is Phosphor's mirrored `sidebar-simple` but
// a dedicated right-edge glyph in HugeIcons, so the vocabulary has to carry the concept, not just
// the drawing. Aliases live in the mapping under a `#alias:` prefix.
const ALIAS_PREFIX = '#alias:';
const aliases = Object.entries(mapping)
    .filter(([k]) => k.startsWith(ALIAS_PREFIX))
    .map(([k, v]) => [k.slice(ALIAS_PREFIX.length), v]);
const canonical = [...new Set(
    Object.entries(mapping).filter(([k]) => !k.startsWith(ALIAS_PREFIX)).map(([, v]) => v),
)].sort().map((p) => [p, p]);
const entries = [...canonical, ...aliases].sort(([a], [b]) => (a < b ? -1 : 1));
const components = [...new Set(entries.map(([, p]) => pascal(p)))].sort();

const out = `// GENERATED — do not edit by hand.
// Source: scripts/icons/mapping.json  ·  Regenerate: node scripts/icons/genRegistry.mjs
//
// 使用包公开的逐图标入口，避免 Metro 经总入口收集整套图标；保留原组件及所有字重。
${components.map(c => `import { ${c} } from 'phosphor-react-native/src/icons/${c.slice(0, -'Icon'.length)}';`).join('\n')}
import type { Icon as PhosphorIcon } from 'phosphor-react-native';

export const ICON_REGISTRY = {
${entries.map(([k, v]) => `    '${k}': ${pascal(v)},`).join('\n')}
} as const satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICON_REGISTRY;
`;
writeFileSync(outPath, out);
console.log(`${entries.length} names -> ${components.length} distinct Phosphor components`);
