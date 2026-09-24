import { describe, expect, it } from 'vitest';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { scanUserFacingStrings } from '../../tools/i18n/userFacingTextScan';

describe('tools/i18n/userFacingTextScan', () => {
    it('flags nested string literals used as title/subtitle in JSX props', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'happier-ui-i18n-scan-'));
        try {
            const filePath = path.join(dir, 'Example.tsx');
            await fs.writeFile(
                filePath,
                [
                    'export function Example() {',
                    '  return (',
                    '    <DropdownMenu',
                    '      items={[{',
                    '        title: "Custom…",',
                    '        subtitle: "Enter a custom backend id.",',
                    '      }]}',
                    '      itemTrigger={{ title: "Hands-free" }}',
                    '    />',
                    '  );',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            const hits = scanUserFacingStrings({ sourcesRootDir: dir });
            const texts = hits.map((h) => h.text);

            expect(texts).toEqual(expect.arrayContaining(['Custom…', 'Enter a custom backend id.', 'Hands-free']));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('flags nested fallbacks, Modal alerts, and user-facing variables', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'happier-ui-i18n-scan-'));
        try {
            const filePath = path.join(dir, 'Example.tsx');
            await fs.writeFile(
                filePath,
                [
                    `import { Modal } from '@/modal';`,
                    `import { t } from '@/text';`,
                    '',
                    'export function Example() {',
                    '  const title = `Install ${String(123)} CLI`;',
                    "  const subtitle = 'Auto-install is not available for this machine.';",
                    '  return (',
                    '    <View>',
                    "      <Item title={t('common.ok') ?? 'Fallback'} subtitle={subtitle} />",
                    "      <Button onPress={() => Modal.alert('Error', 'Bad stuff')} />",
                    '      <Text>{title}</Text>',
                    '    </View>',
                    '  );',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            const hits = scanUserFacingStrings({ sourcesRootDir: dir });
            const texts = hits.map((h) => h.text);

            expect(texts).toEqual(
                expect.arrayContaining(['Fallback', 'Error', 'Bad stuff', 'Auto-install is not available for this machine.'])
            );
            expect(texts.some((text) => text.includes('Install') && text.includes('CLI'))).toBe(true);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    // F10 — Scanner exclusion narrowing: `*StorySurface.tsx` suffix used to
    // hide production onboarding/release-note story surfaces from the scanner.
    // The dev-only carve-out must target the SelectionList dev preview file
    // specifically, not every file ending in `StorySurface.tsx`.
    it('scans production *StorySurface.tsx files (onboarding/release notes) but excludes the dev SelectionList story surfaces', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'happier-ui-i18n-scan-'));
        try {
            const onboardingDir = path.join(dir, 'sources', 'components', 'onboarding', 'showcase');
            const releaseDir = path.join(dir, 'sources', 'components', 'changelog', 'releaseNotes');
            const selectionListDir = path.join(dir, 'sources', 'components', 'ui', 'selectionList');
            const selectionListStorySurfaceDir = path.join(selectionListDir, 'storySurface');
            await fs.mkdir(onboardingDir, { recursive: true });
            await fs.mkdir(releaseDir, { recursive: true });
            await fs.mkdir(selectionListDir, { recursive: true });
            await fs.mkdir(selectionListStorySurfaceDir, { recursive: true });

            await fs.writeFile(
                path.join(onboardingDir, 'OnboardingShowcaseStorySurface.tsx'),
                [
                    'export function OnboardingShowcaseStorySurface() {',
                    '  return <Text>Hardcoded onboarding copy</Text>;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            await fs.writeFile(
                path.join(releaseDir, 'ReleaseNotesStorySurface.tsx'),
                [
                    'export function ReleaseNotesStorySurface() {',
                    '  return <Text>Hardcoded release notes copy</Text>;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            await fs.writeFile(
                path.join(selectionListDir, 'SelectionListStorySurface.tsx'),
                [
                    'export function SelectionListStorySurface() {',
                    '  return <Text>Hardcoded selection list dev copy</Text>;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            await fs.writeFile(
                path.join(selectionListStorySurfaceDir, 'SelectionListBasicVariants.tsx'),
                [
                    'export function SelectionListBasicVariants() {',
                    '  return <StoryDeckCard title="Hardcoded selection list split dev copy" />;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            const hits = scanUserFacingStrings({ sourcesRootDir: path.join(dir, 'sources') });
            const texts = hits.map((h) => h.text);

            expect(texts).toEqual(expect.arrayContaining(['Hardcoded onboarding copy']));
            expect(texts).toEqual(expect.arrayContaining(['Hardcoded release notes copy']));
            expect(texts).not.toEqual(expect.arrayContaining(['Hardcoded selection list dev copy']));
            expect(texts).not.toEqual(expect.arrayContaining(['Hardcoded selection list split dev copy']));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('excludes debug-only dev routes even when sourcesRootDir is relative', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'happier-ui-i18n-scan-'));
        try {
            const devDir = path.join(dir, 'sources', 'app', '(app)', 'dev');
            await fs.mkdir(devDir, { recursive: true });

            await fs.writeFile(
                path.join(devDir, 'Example.tsx'),
                [
                    `import { Text } from '@/components/ui/text/Text';`,
                    '',
                    'export function Example() {',
                    '  return <Text>Hello from dev</Text>;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            const relativeRoot = path.relative(process.cwd(), path.join(dir, 'sources'));
            const hits = scanUserFacingStrings({ sourcesRootDir: relativeRoot });

            expect(hits).toEqual([]);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('excludes dev-only components under sources/components/dev', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'happier-ui-i18n-scan-'));
        try {
            const devComponentsDir = path.join(dir, 'sources', 'components', 'dev');
            await fs.mkdir(devComponentsDir, { recursive: true });

            await fs.writeFile(
                path.join(devComponentsDir, 'ExampleDevSection.tsx'),
                [
                    `import { Text } from '@/components/ui/text/Text';`,
                    '',
                    'export function ExampleDevSection() {',
                    '  return <Text>Hardcoded dev-only copy</Text>;',
                    '}',
                    '',
                ].join('\n'),
                'utf8'
            );

            const hits = scanUserFacingStrings({ sourcesRootDir: path.join(dir, 'sources') });
            expect(hits).toEqual([]);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
