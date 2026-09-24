import React from 'react';
import { View } from 'react-native';

import type { TreeDropMeasurableRef } from '@/components/ui/treeDragDrop';

export type RegisterSessionListTreeRowBounds = (rowId: string, ref: TreeDropMeasurableRef | null) => void;
export type UnregisterSessionListTreeRowBounds = (rowId: string) => void;

/**
 * Static frame around a non-draggable section header.
 *
 * Phase 3 of the session-list drag geometry & performance unification: the
 * frame no longer renders a row-local drop indicator and no longer receives an
 * `activeDropVisual`. The single list-level `SessionListDropOverlay` owns the
 * indicator. The frame still registers its content bounds on layout so the
 * pointer can hit-test against it.
 */
export const SessionListHeaderFrame = React.memo(function SessionListHeaderFrame(props: Readonly<{
    children: React.ReactNode;
    treeRowId: string;
    onRegisterTreeRowBounds: RegisterSessionListTreeRowBounds;
    onUnregisterTreeRowBounds: UnregisterSessionListTreeRowBounds;
}>) {
    const wrapperRef = React.useRef<View>(null);
    React.useEffect(() => {
        return () => {
            props.onUnregisterTreeRowBounds(props.treeRowId);
        };
    }, [props.onUnregisterTreeRowBounds, props.treeRowId]);
    return (
        <View
            ref={wrapperRef}
            collapsable={false}
            style={{ position: 'relative' }}
            onLayout={() => props.onRegisterTreeRowBounds(props.treeRowId, wrapperRef.current)}
        >
            {props.children}
        </View>
    );
});
