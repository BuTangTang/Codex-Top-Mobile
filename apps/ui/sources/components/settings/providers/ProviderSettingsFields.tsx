import React from 'react';

import type {
    ProviderSettingFieldDef,
    ProviderSettingsSectionDef,
} from '@/agents/providers/shared/providerSettingsPlugin';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

import { ProviderSettingsBooleanField } from './ProviderSettingsBooleanField';
import { ProviderSettingsEnumField, ProviderSettingsMultiEnumField } from './ProviderSettingsEnumField';
import { ProviderSettingsJsonField } from './ProviderSettingsJsonField';
import { ProviderSettingsNumberField } from './ProviderSettingsNumberField';
import { resolveProviderSettingsText } from './providerSettingsText';

type ProviderSettingsFieldsProps = Readonly<{
    sections: readonly ProviderSettingsSectionDef[];
    readFieldValue: (field: ProviderSettingFieldDef) => unknown;
    setFieldValue: (field: ProviderSettingFieldDef, value: unknown) => void;
    openMenu: string | null;
    setOpenMenu: (key: string | null) => void;
    localInputs: Record<string, string>;
    setLocalInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    popoverBoundaryRef: React.RefObject<unknown>;
}>;

const ProviderSettingsSection = React.memo(function ProviderSettingsSection(props: Readonly<{
    section: ProviderSettingsSectionDef;
    readFieldValue: (field: ProviderSettingFieldDef) => unknown;
    setFieldValue: (field: ProviderSettingFieldDef, value: unknown) => void;
    openMenu: string | null;
    setOpenMenu: (key: string | null) => void;
    localInputs: Record<string, string>;
    setLocalInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    popoverBoundaryRef: React.RefObject<unknown>;
}>) {
    const gatedFeatureEnabled = useFeatureEnabled(props.section.featureId ?? 'app.analytics');
    const featureEnabled = props.section.featureId ? gatedFeatureEnabled : true;
    if (!featureEnabled) return null;

    return (
        <ItemGroup
            title={resolveProviderSettingsText(props.section.title)}
            footer={resolveProviderSettingsText(props.section.footer)}
        >
            {props.section.fields.map((field) => {
                const value = props.readFieldValue(field);

                if (field.kind === 'boolean') {
                    return (
                        <ProviderSettingsBooleanField
                            key={field.key}
                            field={field}
                            value={value}
                            setFieldValue={props.setFieldValue}
                        />
                    );
                }

                if (field.kind === 'multiEnum') {
                    return (
                        <ProviderSettingsMultiEnumField
                            key={field.key}
                            field={field}
                            value={value}
                            open={props.openMenu === field.key}
                            setOpen={(next) => props.setOpenMenu(next ? field.key : null)}
                            popoverBoundaryRef={props.popoverBoundaryRef}
                            setFieldValue={props.setFieldValue}
                        />
                    );
                }

                if (field.kind === 'enum') {
                    return (
                        <ProviderSettingsEnumField
                            key={field.key}
                            field={field}
                            value={value}
                            open={props.openMenu === field.key}
                            setOpen={(next) => props.setOpenMenu(next ? field.key : null)}
                            popoverBoundaryRef={props.popoverBoundaryRef}
                            setFieldValue={props.setFieldValue}
                        />
                    );
                }

                if (field.kind === 'number') {
                    return (
                        <ProviderSettingsNumberField
                            key={field.key}
                            field={field}
                            value={value}
                            localInputs={props.localInputs}
                            setLocalInputs={props.setLocalInputs}
                            setFieldValue={props.setFieldValue}
                        />
                    );
                }

                if (field.kind === 'json' || field.kind === 'text') {
                    return (
                        <ProviderSettingsJsonField
                            key={field.key}
                            field={field}
                            value={value}
                            localInputs={props.localInputs}
                            setLocalInputs={props.setLocalInputs}
                            setFieldValue={props.setFieldValue}
                        />
                    );
                }

                return null;
            })}
        </ItemGroup>
    );
});

export const ProviderSettingsFields = React.memo(function ProviderSettingsFields(props: ProviderSettingsFieldsProps) {
    return (
        <>
            {props.sections.map((section) => (
                <ProviderSettingsSection
                    key={section.id}
                    section={section}
                    readFieldValue={props.readFieldValue}
                    setFieldValue={props.setFieldValue}
                    openMenu={props.openMenu}
                    setOpenMenu={props.setOpenMenu}
                    localInputs={props.localInputs}
                    setLocalInputs={props.setLocalInputs}
                    popoverBoundaryRef={props.popoverBoundaryRef}
                />
            ))}
        </>
    );
});
