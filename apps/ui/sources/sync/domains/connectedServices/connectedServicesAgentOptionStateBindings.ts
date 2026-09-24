import {
    ConnectedServiceBindingsV1Schema,
    type ConnectedServiceBindingSelectionV1,
} from '@happier-dev/protocol';

export type ConnectedServicesServiceBinding = ConnectedServiceBindingSelectionV1;

export const CONNECTED_SERVICES_BINDINGS_KEY = 'connectedServicesBindingsByServiceId' as const;

export function parseConnectedServicesBindingsByServiceIdFromAgentOptionState(params: Readonly<{
    agentOptionState: Record<string, unknown> | null | undefined;
}>): Readonly<Record<string, ConnectedServicesServiceBinding | undefined>> {
    const raw = params.agentOptionState?.[CONNECTED_SERVICES_BINDINGS_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const parsed = ConnectedServiceBindingsV1Schema.safeParse({
        v: 1,
        bindingsByServiceId: raw,
    });
    return parsed.success ? parsed.data.bindingsByServiceId : {};
}
