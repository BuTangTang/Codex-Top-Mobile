import * as React from 'react';
import { Platform } from 'react-native';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { buildScmTreeBadgeSignature, createScmTreeBadgeIndex, type ScmTreeBadgeIndex } from './scmTreeBadges';

export function useScmTreeBadgeIndex(snapshot: ScmWorkingSnapshot | null | undefined): ScmTreeBadgeIndex | null {
    const [index, setIndex] = React.useState<ScmTreeBadgeIndex | null>(null);
    const signature = React.useMemo(() => buildScmTreeBadgeSignature(snapshot), [snapshot]);
    const nativeIndex = React.useMemo(() => {
        if (Platform.OS === 'web') {
            return null;
        }
        return snapshot ? createScmTreeBadgeIndex(snapshot) : null;
    }, [signature]);
    const snapshotRef = React.useRef(snapshot);
    snapshotRef.current = snapshot;

    React.useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }
        const currentSnapshot = snapshotRef.current;
        if (!currentSnapshot) {
            setIndex(null);
            return;
        }

        let cancelled = false;
        const compute = () => {
            if (cancelled) return;
            setIndex(createScmTreeBadgeIndex(currentSnapshot));
        };

        if (Platform.OS === 'web') {
            const handle = setTimeout(compute, 0);
            return () => {
                cancelled = true;
                clearTimeout(handle);
            };
        }

        compute();
        return () => {
            cancelled = true;
        };
    }, [signature]);

    return Platform.OS === 'web' ? index : nativeIndex;
}
