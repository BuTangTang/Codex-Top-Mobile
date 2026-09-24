import * as React from 'react';
import { View } from 'react-native';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import type { AgentId } from '@/agents/catalog/catalog';
import { getAgentCore } from '@/agents/catalog/catalog';
import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { t } from '@/text';

export function getAgentDropdownMenuItems(params: {
    agentIds: readonly AgentId[];
    iconColor: string;
    iconSize?: number;
}): readonly DropdownMenuItem[] {
    const iconSize = params.iconSize ?? 22;
    return params.agentIds.map((id) => {
        const core = getAgentCore(id);
        return {
            id: String(id),
            title: t(core.displayNameKey),
            subtitle: String(id),
            icon: (
                <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                    <AgentIcon agentId={id} color={params.iconColor} size={iconSize} />
                </View>
            ),
        };
    });
}
