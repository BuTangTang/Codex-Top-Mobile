import React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { ProviderSettingFieldDef } from '@/agents/providers/shared/providerSettingsPlugin';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { providerSettingsFieldStyles as styles } from './providerSettingsFieldStyles';
import { resolveProviderSettingsText } from './providerSettingsText';

export const ProviderSettingsJsonField = React.memo(function ProviderSettingsJsonField(props: Readonly<{
    field: ProviderSettingFieldDef;
    value: unknown;
    localInputs: Record<string, string>;
    setLocalInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setFieldValue: (field: ProviderSettingFieldDef, value: unknown) => void;
}>) {
    const { theme } = useUnistyles();
    const { field, value, localInputs, setLocalInputs, setFieldValue } = props;
    const textValue = typeof value === 'string' ? value : '';
    const localValue = localInputs[field.key] ?? textValue;
    const jsonError =
        field.kind === 'json' && localValue.trim().length > 0
            ? (() => {
                try {
                    JSON.parse(localValue);
                    return null;
                } catch {
                    return t('settingsProviders.invalidJson');
                }
            })()
            : null;

    const commitJsonIfValid = () => {
        if (field.kind !== 'json') return;
        if (jsonError) return;
        setFieldValue(field, localValue);
        setLocalInputs((prev) => {
            if (!(field.key in prev)) return prev;
            const next = { ...prev };
            delete next[field.key];
            return next;
        });
    };

    return (
        <View testID={`settings-provider-field-${field.key}`} style={[styles.inputContainer, { paddingTop: 0 }]}>
            <Text style={styles.fieldLabel}>{resolveProviderSettingsText(field.title) ?? ''}</Text>
            {field.subtitle ? (
                <Text style={{ ...Typography.default(), fontSize: 13, color: theme.colors.text.secondary, marginBottom: 6 }}>
                    {resolveProviderSettingsText(field.subtitle) ?? ''}
                </Text>
            ) : null}
            <TextInput
                style={[
                    styles.textInput,
                    {
                        minHeight: field.kind === 'json' ? 110 : 44,
                        textAlignVertical: field.kind === 'json' ? 'top' : 'center',
                    },
                    jsonError ? { borderWidth: 1, borderColor: theme.colors.state.danger.foreground } : null,
                ]}
                multiline={field.kind === 'json'}
                placeholder={field.kind === 'json' ? '{ }' : ''}
                placeholderTextColor={theme.colors.input.placeholder}
                value={field.kind === 'json' ? localValue : textValue}
                onChangeText={(next) => {
                    if (field.kind === 'json') {
                        setLocalInputs((prev) => ({ ...prev, [field.key]: next }));
                        return;
                    }
                    setFieldValue(field, next);
                }}
                onEndEditing={commitJsonIfValid}
                onBlur={commitJsonIfValid}
                autoCapitalize="none"
                autoCorrect={false}
            />
            {jsonError ? (
                <Text style={{ ...Typography.default(), fontSize: 12, color: theme.colors.state.danger.foreground, marginTop: 6 }}>
                    {jsonError}
                </Text>
            ) : null}
        </View>
    );
});
