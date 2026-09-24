import type { UnistylesThemes } from 'react-native-unistyles';

import { resolveAgentIdFromConnectedServiceId } from './registryCore';
import { PROVIDER_LOGO_SVG_XML, githubSvg } from './providerLogoSvgXml';

type Theme = UnistylesThemes[keyof UnistylesThemes];

/**
 * Resolves the themed, monochrome brand-mark SVG XML for a connected service.
 *
 * Reuses the canonical registry plumbing: a service id maps to an `AgentId` via
 * `resolveAgentIdFromConnectedServiceId`, and the mark comes from the shared
 * `PROVIDER_LOGO_SVG_XML` registry. `github` has no `AgentId`, so it is
 * special-cased onto the dedicated `githubSvg` mark. Returns `null` when no mark
 * exists (the caller falls back to a generic `key-outline` glyph).
 *
 * LOCKED: marks render in the registry's monochrome/themed treatment
 * (`theme.colors.text.primary`); full-color brand marks are deferred.
 */
export function resolveConnectedServiceBrandIconXml(
    serviceId: string | null | undefined,
    theme: Theme,
): string | null {
    const normalized = typeof serviceId === 'string' ? serviceId.trim().toLowerCase() : '';
    if (!normalized) return null;

    if (normalized === 'github') return githubSvg(theme);

    const agentId = resolveAgentIdFromConnectedServiceId(normalized);
    if (!agentId) return null;

    const resolver = PROVIDER_LOGO_SVG_XML[agentId];
    return resolver ? resolver(theme) : null;
}
