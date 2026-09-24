import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { PermissionModePicker } from './PermissionModePicker';
import type { PermissionModePickerStyles } from './permissionModePickerStyles';
import { renderScreen } from '@/dev/testkit';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { EffectivePermissionModeDescription } from '@/sync/domains/permissions/describeEffectivePermissionMode';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * FR4-16 — typed style contract assertions.
 *
 * The picker used to accept `styles: any`, which let style-shape drift bypass
 * the type system. The runtime side of the contract is exercised here by
 * building a `PermissionModePickerStyles` value (the type system catches
 * missing/mistyped fields at build time) and confirming the picker renders
 * with that shape.
 */
describe('PermissionModePickerStyles typed contract (FR4-16)', () => {
    it('accepts a fully populated PermissionModePickerStyles shape', async () => {
        const styles: PermissionModePickerStyles = {
            overlaySection: { paddingVertical: 16 },
            overlaySectionTitle: { fontSize: 12, fontWeight: '600' },
            overlayOptionRow: { flexDirection: 'row', alignItems: 'center' },
            overlayOptionRowPressed: { backgroundColor: '#eef' },
            overlayRadioOuter: { width: 16, height: 16, borderRadius: 8 },
            overlayRadioOuterSelected: { borderColor: '#0a0' },
            overlayRadioOuterUnselected: { borderColor: '#999' },
            overlayRadioInner: { width: 6, height: 6, borderRadius: 3 },
            overlayOptionLabel: { fontSize: 14 },
            overlayOptionLabelSelected: { color: '#0a0' },
            overlayOptionLabelUnselected: { color: '#222' },
            overlayOptionDescription: { fontSize: 11 },
        };
        const policy: EffectivePermissionModeDescription = {
            effectiveMode: 'default' as PermissionMode,
            reasons: [],
            notes: [],
        };
        const screen = await renderScreen(
            <PermissionModePicker
                title="PERMISSIONS"
                options={[
                    { value: 'default', label: 'Default', description: 'Ask each time' },
                    { value: 'yolo', label: 'YOLO', description: 'Skip prompts' },
                ]}
                selected={'default' as PermissionMode}
                onSelect={() => {}}
                styles={styles}
                effectivePermissionLabel="Effective"
                effectivePermissionPolicy={policy}
            />,
        );
        expect(screen.findByTestId('permission-mode-default')).toBeTruthy();
        expect(screen.findByTestId('permission-mode-yolo')).toBeTruthy();
    });

    it('also accepts arrays as StyleProp (RN style composition)', async () => {
        const styles: PermissionModePickerStyles = {
            overlaySection: [{ paddingVertical: 8 }, { paddingHorizontal: 12 }],
            overlaySectionTitle: { fontSize: 12 },
            overlayOptionRow: { flexDirection: 'row' },
            overlayOptionRowPressed: { backgroundColor: '#eef' },
            overlayRadioOuter: { width: 16, height: 16 },
            overlayRadioOuterSelected: { borderColor: '#0a0' },
            overlayRadioOuterUnselected: { borderColor: '#999' },
            overlayRadioInner: { width: 6, height: 6 },
            overlayOptionLabel: { fontSize: 14 },
            overlayOptionLabelSelected: { color: '#0a0' },
            overlayOptionLabelUnselected: { color: '#222' },
            overlayOptionDescription: { fontSize: 11 },
        };
        const policy: EffectivePermissionModeDescription = {
            effectiveMode: 'default' as PermissionMode,
            reasons: [],
            notes: [],
        };
        const screen = await renderScreen(
            <PermissionModePicker
                title="PERMISSIONS"
                options={[
                    { value: 'default', label: 'Default', description: 'Ask each time' },
                ]}
                selected={'default' as PermissionMode}
                onSelect={() => {}}
                styles={styles}
                effectivePermissionLabel="Effective"
                effectivePermissionPolicy={policy}
            />,
        );
        expect(screen.findByTestId('permission-mode-default')).toBeTruthy();
    });
});
