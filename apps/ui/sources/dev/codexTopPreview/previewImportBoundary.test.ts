import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const previewDir = dirname(fileURLToPath(import.meta.url));
const sourcesDir = resolve(previewDir, '../..');
const uiDir = resolve(sourcesDir, '..');

const packageAllow = new Set([
    'react',
    'react-native',
    'expo-router',
    'react-native-paper',
    'react-native-reanimated',
    'react-native-safe-area-context',
    'react-native-gesture-handler',
    'react-native-keyboard-controller',
    '@expo/vector-icons',
]);

const firstPartyAllow = new Set([
    'hooks/ui/useReducedMotionPreference.ts',
    'components/ui/motion/motionTokens.ts',
]);

const forbidden = /unistyles|\/sync\/|@\/sync|\/auth\/|@\/auth|AuthContext|RealtimeProvider|useDemoMessages|SessionView|\/rpc|persistence/;

/**
 * 收集预览目录里的实现文件，排除测试和交接说明。
 */
function listPreviewSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listPreviewSources(path));
            continue;
        }
        if (/\.(ts|tsx|js|cjs)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
            files.push(path);
        }
    }
    return files;
}

/**
 * 抽出静态 import 和 require 的模块名。
 */
function importSpecifiers(source: string): string[] {
    const specs: string[] = [];
    const pattern = /(?:from\s+|import\s+|require\(\s*)['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
        const spec = match[1];
        if (spec) specs.push(spec);
    }
    return specs;
}

/**
 * 把相对路径或 @/ 别名落到具体文件。找不到时返回 null。
 */
function materialize(id: string): string | null {
    const candidates = [id, `${id}.ts`, `${id}.tsx`, `${id}.js`, `${id}.cjs`, join(id, 'index.ts'), join(id, 'index.tsx')];
    return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

describe('codex top preview import boundary', () => {
    it('keeps the preview graph away from login, sync, and rpc', () => {
        const pending = listPreviewSources(previewDir);
        const seen = new Set<string>();
        const violations: string[] = [];

        while (pending.length > 0) {
            const file = pending.pop();
            if (!file || seen.has(file)) continue;
            seen.add(file);
            const source = readFileSync(file, 'utf8');
            for (const spec of importSpecifiers(source)) {
                if (forbidden.test(spec)) {
                    violations.push(`${relative(uiDir, file)} imports ${spec}`);
                    continue;
                }
                if (spec.startsWith('@/')) {
                    const relativePath = spec.slice(2);
                    if (!firstPartyAllow.has(`${relativePath}.ts`) && !firstPartyAllow.has(`${relativePath}.tsx`)) {
                        violations.push(`${relative(uiDir, file)} imports ${spec}`);
                        continue;
                    }
                    const materialized = materialize(resolve(sourcesDir, relativePath));
                    if (!materialized) violations.push(`${spec} did not resolve`);
                    else pending.push(materialized);
                    continue;
                }
                if (spec.startsWith('.')) {
                    const materialized = materialize(resolve(dirname(file), spec));
                    if (!materialized) {
                        violations.push(`${relative(uiDir, file)} imports missing ${spec}`);
                        continue;
                    }
                    const outsidePreview = !materialized.startsWith(`${previewDir}/`) && materialized !== previewDir;
                    const allowedOutside = firstPartyAllow.has(relative(sourcesDir, materialized));
                    if (outsidePreview && !allowedOutside) {
                        violations.push(`${relative(uiDir, file)} imports ${spec}`);
                        continue;
                    }
                    pending.push(materialized);
                    continue;
                }
                if (!packageAllow.has(spec)) violations.push(`${relative(uiDir, file)} imports ${spec}`);
            }
        }

        expect(violations).toEqual([]);
        expect(seen.size).toBeGreaterThan(0);
    });

    it('loads official unistyles only when the preview entry is inactive', () => {
        const source = readFileSync(resolve(uiDir, 'index.ts'), 'utf8');
        expect(source).toContain("require('./sources/dev/codexTopPreview/resolveCodexTopRouterRoot.cjs')");
        expect(source).not.toContain('sources/sync');
        expect(source).not.toContain('AuthContext');
        expect(source.match(/require\('\.\/sources\/unistyles'\)/g)).toHaveLength(1);
        expect(source).toMatch(/if \(!shouldSkipOfficialUnistylesForCodexTopPreview\(\)\) \{\s*require\('\.\/sources\/unistyles'\);\s*\}/);
    });
});
