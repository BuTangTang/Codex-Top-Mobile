import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

/**
 * FR4-16 — Typed style contract consumed by `PermissionModePicker` and threaded
 * through `AgentInputOverlayLayer`.
 *
 * Before this contract, both components accepted `styles: any`, which meant
 * any drift in the parent stylesheet keys (or a typo in a child)
 * silently bypassed TypeScript. The contract is intentionally narrow: it
 * enumerates exactly the fields the picker reads. Pass `StyleProp<...>` so
 * Unistyles' inferred object types remain compatible at the call site (the
 * Unistyles boundary may need a `as unknown as PermissionModePickerStyles`
 * narrowing cast — that is a documented narrow-boundary pattern, not a
 * blanket `any`).
 */
export type PermissionModePickerStyles = Readonly<{
    overlaySection: StyleProp<ViewStyle>;
    overlaySectionTitle: StyleProp<TextStyle>;
    overlayOptionRow: StyleProp<ViewStyle>;
    overlayOptionRowPressed: StyleProp<ViewStyle>;
    overlayRadioOuter: StyleProp<ViewStyle>;
    overlayRadioOuterSelected: StyleProp<ViewStyle>;
    overlayRadioOuterUnselected: StyleProp<ViewStyle>;
    overlayRadioInner: StyleProp<ViewStyle>;
    overlayOptionLabel: StyleProp<TextStyle>;
    overlayOptionLabelSelected: StyleProp<TextStyle>;
    overlayOptionLabelUnselected: StyleProp<TextStyle>;
    overlayOptionDescription: StyleProp<TextStyle>;
}>;
