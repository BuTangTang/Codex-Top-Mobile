import * as React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { PhoneSessionsOverview } from '@/components/sessions/directSessions/browse/PhoneSessionsOverview';

/** 电脑与项目会话使用独立栈页面；复用列表 owner，返回时保留原电脑详情及首页状态。 */
export default function MachineSessionsScreen() {
    const router = useRouter();
    const { id, serverId, projectId, sourceKey } = useLocalSearchParams<{
        id?: string | string[]; serverId?: string | string[]; projectId?: string | string[]; sourceKey?: string | string[];
    }>();
    return <>
        <Stack.Screen options={{ headerShown: false }} />
        <PhoneSessionsOverview historyScope={{ machineId: id ?? '', serverId, projectId, sourceKey }} onBack={router.back} />
    </>;
}
