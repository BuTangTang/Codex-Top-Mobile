import React from 'react';
import { Platform, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { ProviderSettingFieldDef } from '@/agents/providers/shared/providerSettingsPlugin';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { providerSettingsFieldStyles as styles } from './providerSettingsFieldStyles';
import { resolveProviderSettingsText } from './providerSettingsText';

function isStepAligned(n: number, step: number, base: number): boolean {
    if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return true;
    const scaled = (n - base) / step;
    const rounded = Math.round(scaled);
    return Math.abs(scaled - rounded) < 1e-9;
}

export const ProviderSettingsNumberField = React.memo(function ProviderSettingsNumberField(props: Readonly<{
    field: ProviderSettingFieldDef;
    value: unknown;
    localInputs: Record<string, string>;
    setLocalInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setFieldValue: (field: ProviderSettingFieldDef, value: unknown) => void;
}>) {
    const { theme } = useUnistyles();
    const { field, value, localInputs, setLocalInputs, setFieldValue } = props;

    const rawFromSetting = typeof value === 'number' ? String(value) : '';
    const externalRaw = value === null || value === undefined ? '' : rawFromSetting;
    const raw = Object.prototype.hasOwnProperty.call(localInputs, field.key)
        ? localInputs[field.key]!
        : externalRaw;
    const parsed = raw.trim().length === 0 ? null : Number(raw);
    const spec = field.numberSpec;
    const isValid =
        parsed === null
            ? true
            : Number.isFinite(parsed)
              && (spec?.min == null || parsed >= spec.min)
              && (spec?.max == null || parsed <= spec.max)
              && (spec?.step == null || isStepAligned(parsed, spec.step, spec?.min ?? 0));
    const showError = raw.trim().length > 0 && !isValid;

    const clearLocalInput = React.useCallback(() => {
        setLocalInputs((prev) => {
            if (!(field.key in prev)) return prev;
            const next = { ...prev };
            delete next[field.key];
            return next;
        });
    }, [field.key, setLocalInputs]);

    const [focused, setFocused] = React.useState(false);
    const prevExternalRawRef = React.useRef(externalRaw);
    React.useEffect(() => {
        const prevExternalRaw = prevExternalRawRef.current;
        prevExternalRawRef.current = externalRaw;
        if (focused) return;
        if (prevExternalRaw === externalRaw) return;
        clearLocalInput();
    }, [clearLocalInput, externalRaw, focused]);

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
                    showError ? { borderWidth: 1, borderColor: theme.colors.state.danger.foreground } : null,
                ]}
                placeholder={resolveProviderSettingsText(field.numberSpec?.placeholder) ?? t('common.optional')}
                placeholderTextColor={theme.colors.input.placeholder}
                value={raw}
                keyboardType={Platform.select({ ios: 'number-pad', default: 'numeric' })}
                onFocus={() => setFocused(true)}
                onChangeText={(next) => {
                    setLocalInputs((prev) => ({ ...prev, [field.key]: next }));
                    const trimmed = next.trim();
                    if (!trimmed) {
                        setFieldValue(field, null);
                        return;
                    }
                    const n = Number(trimmed);
                    if (!Number.isFinite(n)) return;
                    if (field.numberSpec?.min != null && n < field.numberSpec.min) return;
                    if (field.numberSpec?.max != null && n > field.numberSpec.max) return;
                    if (field.numberSpec?.step != null && !isStepAligned(n, field.numberSpec.step, field.numberSpec?.min ?? 0)) return;
                    setFieldValue(field, n);
                }}
                onBlur={() => {
                    setFocused(false);
                    const trimmed = raw.trim();
                    if (!trimmed) {
                        clearLocalInput();
                        return;
                    }
                    if (isValid) clearLocalInput();
                }}
                autoCapitalize="none"
                autoCorrect={false}
            />
            {showError ? (
                <Text style={{ ...Typography.default(), fontSize: 12, color: theme.colors.state.danger.foreground, marginTop: 6 }}>
                    {t('settingsProviders.invalidNumber')}
                </Text>
            ) : null}
        </View>
    );
});
