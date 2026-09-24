import * as React from 'react';
import { View } from 'react-native';
import type { DirectSessionActivityV1 } from '@happier-dev/protocol';

import type { ResolvedItemDensity } from '@/components/ui/lists/useResolvedItemDensity';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { Theme } from '@/theme';
import { t } from '@/text';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';

type AppTheme = Theme;

type DirectBrowseCandidate = Readonly<{
    remoteSessionId: string;
    title?: string;
    updatedAtMs: number;
    activity?: DirectSessionActivityV1;
    details?: Record<string, unknown>;
}>;

export function readDirectBrowseCandidatePath(details: Record<string, unknown> | undefined): string | null {
    const cwd = typeof details?.cwd === 'string' ? details.cwd.trim() : '';
    if (cwd) return cwd;
    const path = typeof details?.path === 'string' ? details.path.trim() : '';
    return path || null;
}

function normalizeCandidateTitle(candidate: DirectBrowseCandidate): string | null {
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    if (!title || title === candidate.remoteSessionId) return null;
    return title;
}

export function formatDirectBrowseCandidatePathLabel(path: string | null): string | null {
    const normalizedPath = typeof path === 'string' ? path.replace(/\\/g, '/').trim() : '';
    if (!normalizedPath) return null;
    return normalizedPath;
}

export function buildDirectBrowseCandidateDisplayTitle(candidate: DirectBrowseCandidate): string {
    const candidateTitle = normalizeCandidateTitle(candidate);
    if (candidateTitle) return candidateTitle;

    const pathLabel = formatDirectBrowseCandidatePathLabel(readDirectBrowseCandidatePath(candidate.details));
    if (pathLabel) return pathLabel.split('/').filter(Boolean).at(-1) ?? pathLabel;

    return candidate.remoteSessionId;
}

/** 复用已本地化的紧凑时间；运行状态优先，未来或无效时间不伪造历史。 */
function buildDirectBrowseCandidatePrimaryMeta(candidate: DirectBrowseCandidate): string | null {
    if (candidate.activity === 'running') {
        return t('directSessions.browseActivityRunningNow');
    }

    const nowMs = Date.now();
    if (Number.isFinite(candidate.updatedAtMs) && candidate.updatedAtMs > 0 && candidate.updatedAtMs <= nowMs) {
        return formatRelativeTimeShort(candidate.updatedAtMs, nowMs);
    }

    return null;
}

export function buildDirectBrowseCandidateSubtitle(
    candidate: DirectBrowseCandidate,
    theme: AppTheme,
    density: ResolvedItemDensity,
): React.ReactNode {
    const pathLabel = formatDirectBrowseCandidatePathLabel(readDirectBrowseCandidatePath(candidate.details));
    const meaningfulTitle = normalizeCandidateTitle(candidate);
    const subtitleMetrics = ITEM_SUBTITLE_TEXT_METRICS[density];
    const subtitleTextStyle = {
        ...Typography.default('regular'),
        ...subtitleMetrics,
    } as const;
    const primaryMeta = buildDirectBrowseCandidatePrimaryMeta(candidate);
    const secondaryLine = pathLabel ?? (!meaningfulTitle ? candidate.remoteSessionId : null);

    return (
        <Text style={subtitleTextStyle} numberOfLines={1}>
            {primaryMeta ? (
                <Text
                    style={[
                        subtitleTextStyle,
                        {
                            color: theme.colors.text.secondary,
                        },
                    ]}
                >
                    {primaryMeta}
                </Text>
            ) : null}
            {primaryMeta && secondaryLine ? (
                <Text
                    style={[
                        subtitleTextStyle,
                        {
                            color: theme.colors.text.secondary,
                        },
                    ]}
                >
                    {' · '}
                </Text>
            ) : null}
            {secondaryLine ? (
                <Text
                    style={[
                        subtitleTextStyle,
                        {
                            color: theme.colors.text.tertiary,
                        },
                    ]}
                >
                    {secondaryLine}
                </Text>
            ) : null}
        </Text>
    );
}

export function buildDirectBrowseCandidateRightElement(
    candidate: DirectBrowseCandidate,
    theme: AppTheme,
    density: ResolvedItemDensity,
): React.ReactNode {
    const badge = (() => {
        switch (candidate.activity) {
            case 'running':
                return {
                    color: theme.colors.state.success.foreground,
                    label: t('directSessions.browseActivityRunning'),
                    pulsing: true,
                };
            case 'active_recently':
                return {
                    color: theme.colors.accent.orange,
                    label: t('directSessions.browseActivityRecent'),
                    pulsing: false,
                };
            case 'idle':
                return {
                    color: theme.colors.text.secondary,
                    label: t('directSessions.browseActivityIdle'),
                    pulsing: false,
                };
            case 'unknown':
                return {
                    color: theme.colors.text.secondary,
                    label: t('directSessions.browseActivityUnknown'),
                    pulsing: false,
                };
            default:
                return null;
        }
    })();

    if (!badge) return null;
    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderRadius: 999,
                backgroundColor: theme.colors.surface.inset,
                paddingHorizontal: 7,
                paddingVertical: 3,
            }}
        >
            <StatusDot color={badge.color} isPulsing={badge.pulsing} size={7} />
            <Text
                style={{
                    color: badge.color,
                    ...Typography.default('semiBold'),
                    ...ITEM_SUBTITLE_TEXT_METRICS[density],
                }}
            >
                {badge.label}
            </Text>
        </View>
    );
}
