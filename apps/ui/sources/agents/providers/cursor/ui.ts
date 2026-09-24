import type { AgentUiConfig } from '@/agents/registry/registryUi';
import { PROVIDER_LOGO_SVG_XML } from '@/agents/registry/providerLogoSvgXml';

export const CURSOR_UI: AgentUiConfig = {
    id: 'cursor',
    icon: null,
    svgIconXml: PROVIDER_LOGO_SVG_XML.cursor ?? null,
    tintColor: null,
    avatarOverlay: {
        circleScale: 0.42,
        iconScale: ({ size }: { size: number }) => Math.round(size * 0.32),
    },
    cliGlyph: 'CU',
};
