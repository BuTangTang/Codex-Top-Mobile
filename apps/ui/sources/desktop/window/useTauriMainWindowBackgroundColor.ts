import * as React from 'react';
import { Platform } from 'react-native';

import { fireAndForget } from '@/utils/system/fireAndForget';

import { applyTauriWindowBackgroundColor } from './applyTauriWindowBackgroundColor';

export function useTauriMainWindowBackgroundColor(
    color: string,
    enabled: boolean,
): void {
    React.useEffect(() => {
        if (!enabled || Platform.OS !== 'web') {
            return;
        }

        fireAndForget(applyTauriWindowBackgroundColor(color), {
            tag: 'useTauriMainWindowBackgroundColor.apply',
        });
    }, [color, enabled]);
}

