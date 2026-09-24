import type { AvatarStyleId } from '@/sync/domains/settings/registry/account/avatarStyleSetting';
import { createGeneratedAvatarCacheKey } from '@/components/ui/avatar/generation/cache/key';
import { readAvatarXmlFromMemory, writeAvatarXmlToMemory } from '@/components/ui/avatar/generation/cache/memory';
import { scheduleAvatarXmlStoreWrite } from '@/components/ui/avatar/generation/cache/store';
import { getMeshGradientVariantForAvatarStyle } from '@/components/ui/avatar/avatarStyleOptions';
import { deriveMeshGradientAvatar } from '@/components/ui/avatar/meshGradient/deriveMeshGradientAvatar';
import type { MeshGradientThemeInput } from '@/components/ui/avatar/meshGradient/meshGradientTypes';

import { renderMeshGradientSvg } from './render';

const RENDER_SIZE = 128;

type Params = Readonly<{
    id: string;
    styleId?: AvatarStyleId;
    monochrome: boolean;
    theme: MeshGradientThemeInput;
}>;

function themeSignature(theme: MeshGradientThemeInput): string {
    return [
        theme.surfaceBase,
        theme.surfaceInset,
        theme.surfaceElevated,
        theme.secondaryForeground,
        ...theme.accentColors,
    ].join('|');
}

function getMeshGradientAvatarCacheKey(params: Params): string {
    const selectedVariant = params.styleId ? getMeshGradientVariantForAvatarStyle(params.styleId) : 'auto';
    return createGeneratedAvatarCacheKey([
        params.id,
        params.monochrome ? 'monochrome' : 'color',
        selectedVariant ?? 'auto',
        themeSignature(params.theme),
    ]);
}

export function getCachedMeshGradientAvatarXml(params: Params): string {
    const selectedVariant = params.styleId ? getMeshGradientVariantForAvatarStyle(params.styleId) : 'auto';
    const cacheKey = getMeshGradientAvatarCacheKey(params);
    const memory = readAvatarXmlFromMemory(cacheKey);
    if (memory) return memory;

    const model = deriveMeshGradientAvatar({
        id: params.id,
        size: RENDER_SIZE,
        monochrome: params.monochrome,
        theme: params.theme,
        patternVariant: selectedVariant && selectedVariant !== 'auto' ? selectedVariant : undefined,
    });
    const xml = renderMeshGradientSvg(model, RENDER_SIZE);
    writeAvatarXmlToMemory(cacheKey, xml);
    return xml;
}

export function scheduleCachedMeshGradientAvatarXmlPersistence(params: Params, xml: string): void {
    scheduleAvatarXmlStoreWrite(getMeshGradientAvatarCacheKey(params), xml);
}
