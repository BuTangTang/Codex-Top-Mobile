import * as React from 'react';
import { DirectSessionsBrowseScreen } from './DirectSessionsBrowseScreen';
import type { PhoneBrowseSnapshot, PhoneBrowseSource } from './phoneBrowseAggregation';
import type { DirectBrowseObservationScope } from './useDirectBrowseCandidates';

/** 以稳定来源身份挂接既有查询 owner；屏幕不为每台电脑另画列表或空态。 */
export const PhoneBrowseSourceOwner = React.memo(function PhoneBrowseSourceOwner(props: Readonly<{
    source: PhoneBrowseSource;
    serverId: string;
    searchQuery: string;
    requestLimit?: number;
    discoveryEnabled: boolean;
    observationScope: DirectBrowseObservationScope;
    actionPending: boolean;
    isActionPending: () => boolean;
    onSnapshot: (key: string, snapshot: PhoneBrowseSnapshot | null) => void;
}>) {
    const { source, serverId, searchQuery, requestLimit, discoveryEnabled, observationScope, actionPending, isActionPending, onSnapshot } = props;
    const lockScope = React.useMemo(() => ({ machineId: source.machineId, serverId, providerId: 'codex' as const, source: source.source }), [source.machineId, source.source, serverId]);
    const publishSnapshot = React.useCallback((snapshot: PhoneBrowseSnapshot | null) => onSnapshot(source.key, snapshot), [onSnapshot, source.key]);
    const phoneData = React.useMemo(() => ({ searchQuery, requestLimit, discoveryEnabled, observationScope, actionPending, isActionPending, onSnapshot: publishSnapshot }), [searchQuery, requestLimit, discoveryEnabled, observationScope, actionPending, isActionPending, publishSnapshot]);
    return <DirectSessionsBrowseScreen lockScope={lockScope} phoneData={phoneData} />;
});
