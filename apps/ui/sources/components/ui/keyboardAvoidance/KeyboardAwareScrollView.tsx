import * as React from 'react';
import type { ScrollViewProps } from 'react-native';
import { Platform, ScrollView } from 'react-native';
import {
    KeyboardAwareScrollView as RNKCKeyboardAwareScrollView,
    type KeyboardAwareScrollViewProps as RNKCKeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

import { DEFAULT_KEYBOARD_AWARE_SCREEN_MODE } from './keyboardAvoidanceDefaults';
import {
    resolveKeyboardAwareScrollViewDefaults,
    type KeyboardAvoidancePlatform,
    type KeyboardAwareScreenMode,
} from './keyboardAvoidanceGeometry';

export type KeyboardAwareScrollViewProps = ScrollViewProps
    & Pick<RNKCKeyboardAwareScrollViewProps, 'disableScrollOnKeyboardHide' | 'extraKeyboardSpace' | 'ScrollViewComponent'>
    & Readonly<{
        mode?: Extract<KeyboardAwareScreenMode, 'scrollForm'>;
        keyboardVerticalOffset?: number;
        bottomOffset?: number;
        enabled?: boolean;
    }>;

export const KeyboardAwareScrollView = React.forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
    function KeyboardAwareScrollView(
        {
            mode = 'scrollForm',
            keyboardVerticalOffset,
            bottomOffset,
            enabled,
            automaticallyAdjustKeyboardInsets,
            disableScrollOnKeyboardHide,
            extraKeyboardSpace,
            ScrollViewComponent,
            ...props
        },
        ref,
    ) {
        const defaults = resolveKeyboardAwareScrollViewDefaults({
            mode: mode ?? DEFAULT_KEYBOARD_AWARE_SCREEN_MODE,
            platform: Platform.OS as KeyboardAvoidancePlatform,
            keyboardVerticalOffset,
        });

        if (!defaults.useKeyboardController) {
            if (ScrollViewComponent) {
                return (
                    <ScrollViewComponent
                        automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
                        {...props}
                    />
                );
            }

            return (
                <ScrollView
                    ref={ref}
                    automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
                    {...props}
                />
            );
        }

        return (
            <RNKCKeyboardAwareScrollView
                ref={ref}
                automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets ?? defaults.automaticallyAdjustKeyboardInsets}
                bottomOffset={bottomOffset ?? defaults.bottomOffset}
                disableScrollOnKeyboardHide={disableScrollOnKeyboardHide}
                enabled={enabled ?? defaults.enabled}
                extraKeyboardSpace={extraKeyboardSpace}
                ScrollViewComponent={ScrollViewComponent}
                {...props}
            />
        );
    },
);
