import * as React from 'react';
import { Pressable, View } from 'react-native';

import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { EffectivePermissionModeDescription } from '@/sync/domains/permissions/describeEffectivePermissionMode';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { PermissionModePickerStyles } from './permissionModePickerStyles';


export type PermissionModePickerOption = Readonly<{
    value: PermissionMode;
    label: string;
    description: string;
}>;

export function PermissionModePicker(props: {
    title: string;
    options: readonly PermissionModePickerOption[];
    selected: PermissionMode;
    onSelect: (mode: PermissionMode) => void;
    // FR4-16: explicit typed style contract (was `Readonly<{ ... any }>`).
    // See `permissionModePickerStyles.ts` for field definitions.
    styles: PermissionModePickerStyles;
    effectivePermissionLabel: string;
    effectivePermissionPolicy: EffectivePermissionModeDescription;
}): React.ReactNode {
    const selected = React.useMemo(() => {
        if (props.options.some((option) => option.value === props.selected)) {
            return props.selected;
        }
        return props.options[0]?.value ?? props.selected;
    }, [props.options, props.selected]);

    return (
        <View style={props.styles.overlaySection}>
            <Text style={props.styles.overlaySectionTitle}>{props.title}</Text>
            <View style={{ paddingHorizontal: 16 }}>
                <Text style={[props.styles.overlayOptionDescription]}>
                    {t('agentInput.permissionMode.effectiveLabel', { label: props.effectivePermissionLabel })}
                </Text>
                {props.effectivePermissionPolicy.notes.map((note, idx) => (
                    <Text key={idx} style={props.styles.overlayOptionDescription}>
                        {note}
                    </Text>
                ))}
            </View>
            {props.options.map((option) => {
                const isSelected = selected === option.value;
                return (
                    <Pressable
                        key={option.value}
                        testID={`permission-mode-${option.value}`}
                        onPress={() => props.onSelect(option.value)}
                        style={({ pressed }) => [props.styles.overlayOptionRow, pressed ? props.styles.overlayOptionRowPressed : null]}
                    >
                        <View
                            style={[
                                props.styles.overlayRadioOuter,
                                isSelected ? props.styles.overlayRadioOuterSelected : props.styles.overlayRadioOuterUnselected,
                            ]}
                        >
                            {isSelected ? <View style={props.styles.overlayRadioInner} /> : null}
                        </View>
                        <View>
                            <Text
                                style={[
                                    props.styles.overlayOptionLabel,
                                    isSelected ? props.styles.overlayOptionLabelSelected : props.styles.overlayOptionLabelUnselected,
                                ]}
                            >
                                {option.label}
                            </Text>
                            <Text style={props.styles.overlayOptionDescription}>{option.description}</Text>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}
