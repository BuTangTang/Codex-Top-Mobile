import React from 'react';
import { View, Platform } from 'react-native';
import { Typography } from '@/constants/Typography';
import { normalizeKeyboardKeyPressEvent, type SupportedKey } from '@/keyboard/events';
import { t } from '@/text';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TextInput } from '@/components/ui/text/Text';


interface CommandPaletteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    onKeyPress?: (key: string) => void;
    inputRef?: React.RefObject<React.ElementRef<typeof TextInput> | null>;
    placeholder?: string;
    autoFocus?: boolean;
}

type CommandPaletteKeyEvent = Readonly<{
    nativeEvent?: Readonly<{
        key?: unknown;
        code?: unknown;
        shiftKey?: unknown;
        altKey?: unknown;
        ctrlKey?: unknown;
        metaKey?: unknown;
        repeat?: unknown;
        isComposing?: unknown;
        keyCode?: unknown;
    }>;
    preventDefault?: () => void;
    stopPropagation?: () => void;
}>;

const handledCommandPaletteKeys = new Set<SupportedKey>(['ArrowDown', 'ArrowUp', 'Enter', 'Escape']);

function readBoolean(value: unknown): boolean {
    return value === true;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function CommandPaletteInput({ value, onChangeText, onKeyPress, inputRef, placeholder, autoFocus = true }: CommandPaletteInputProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const handleKeyDown = React.useCallback((e: CommandPaletteKeyEvent) => {
        if (Platform.OS === 'web' && onKeyPress) {
            const nativeEvent = e.nativeEvent;
            const keyEvent = normalizeKeyboardKeyPressEvent({
                key: readString(nativeEvent?.key) ?? '',
                code: readString(nativeEvent?.code),
                shiftKey: readBoolean(nativeEvent?.shiftKey),
                altKey: readBoolean(nativeEvent?.altKey),
                ctrlKey: readBoolean(nativeEvent?.ctrlKey),
                metaKey: readBoolean(nativeEvent?.metaKey),
                repeat: readBoolean(nativeEvent?.repeat),
                isComposing: nativeEvent?.isComposing === true || nativeEvent?.keyCode === 229,
            });

            if (!keyEvent || keyEvent.isComposing || !handledCommandPaletteKeys.has(keyEvent.key)) return;

            e.preventDefault?.();
            e.stopPropagation?.();
            onKeyPress(keyEvent.key);
        }
    }, [onKeyPress]);

    return (
        <View style={styles.container}>
            <TextInput
                ref={inputRef}
                style={[styles.input, Typography.default()]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder ?? t('commandPalette.placeholder')}
                placeholderTextColor={theme.colors.input.placeholder}
                autoFocus={autoFocus}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="go"
                onKeyPress={handleKeyDown}
                blurOnSubmit={false}
            />
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    },
    input: {
        paddingHorizontal: 32,
        paddingVertical: 24,
        fontSize: 20,
        color: theme.colors.text.primary,
        letterSpacing: -0.3,
        // Remove outline on web
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
}));
