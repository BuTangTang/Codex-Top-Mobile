import * as React from 'react';
import { DirectSessionsBrowseScreen } from './DirectSessionsBrowseScreen';
import type { PhoneBrowseSnapshot, PhoneBrowseSource } from './phoneBrowseAggregation';

/** 以稳定来源身份挂接既有查询 owner；屏幕不为每台电脑另画列表或空态。 */
export const PhoneBrowseSourceOwner = React.memo(function PhoneBrowseSourceOwner(props: Readonly<{
    source: PhoneBrowseSource;
    serverId: string;
    searchQuery: string;
    onSnapshot: (key: string, snapshot: PhoneBrowseSnapshot | null) => void;
}>) {
    const { source, serverId, searchQuery, onSnapshot } = props;
    const lockScope = React.useMemo(() => ({ machineId: source.machineId, serverId, providerId: 'codex' as const, source: source.source }), [source.machineId, source.source, serverId]);
    const publishSnapshot = React.useCallback((snapshot: PhoneBrowseSnapshot | null) => onSnapshot(source.key, snapshot), [onSnapshot, source.key]);
    const phoneData = React.useMemo(() => ({ searchQuery, onSnapshot: publishSnapshot }), [searchQuery, publishSnapshot]);
    return <DirectSessionsBrowseScreen lockScope={lockScope} phoneData={phoneData} />;
});
