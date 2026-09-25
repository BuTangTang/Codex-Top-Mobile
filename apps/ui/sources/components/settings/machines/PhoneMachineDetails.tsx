import * as React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useMachine } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope } from '@/sync/store/hooks';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { Item } from '@/components/ui/lists/Item';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ItemList } from '@/components/ui/lists/ItemList';
import { usePhoneMachineProjects } from './usePhoneMachineProjects';
import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

/** 手机电脑详情只读真实身份与连接状态，项目来自该电脑保存的真实配置，新建入口保持关闭。 */
export function PhoneMachineDetails(props: Readonly<{ machineId: string; serverId?: string }>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const scope = useActiveServerAccountScope();
    const machine = useMachine(props.machineId);
    const nowMs = useSessionListRuntimeNowMs();
    const machineOnline = machine ? isMachineOnline(machine, nowMs) : false;
    const projects = usePhoneMachineProjects({ machineId: props.machineId, serverId: props.serverId, enabled: machineOnline });
    if (!scope || !machine || (props.serverId && props.serverId !== scope.serverId)) {
        return <ItemList style={{ backgroundColor: theme.colors.surface.base }}><SettingsSection compact><Item style={{ minHeight: 48 }} testID="phone-machine-unavailable" title="无法读取该电脑" subtitle="请返回电脑列表，确认当前账号和连接。" mode="info" density="cozy" /></SettingsSection></ItemList>;
    }
    const lastSeen = Number.isFinite(machine.activeAt) && machine.activeAt > 0 ? new Date(machine.activeAt) : null;
    const lastSeenLabel = lastSeen && Number.isFinite(lastSeen.getTime()) ? lastSeen.toLocaleString() : '未知';
    return <ItemList style={{ backgroundColor: theme.colors.surface.base }}>
        <SettingsSection compact>
            <Item style={{ minHeight: 48 }} testID="phone-machine-identity" title={machine.metadata?.displayName || machine.metadata?.host || machine.id}
                subtitle={machineOnline ? '在线' : '离线'} icon={<Icon name="desktop" size={24} color={theme.colors.accent.blue} />}
                density="cozy" titleLines={0} showChevron={false} />
            <Item style={{ minHeight: 48 }} title={t('codexTopProjects.codex')} subtitle={t('codexTopProjects.unknownCodex')} density="cozy" mode="info" />
            <Item style={{ minHeight: 48 }} testID="phone-machine-last-seen" title="上次连接" detail={lastSeenLabel} density="cozy" titleLines={0} showChevron={false} />
        </SettingsSection>
        <SettingsSection compact>
            <Item style={{ minHeight: 48 }} testID="phone-machine-view-sessions" title="查看会话" density="cozy" icon={<Icon name="chat-circle-dots" size={22} color={theme.colors.text.secondary} />}
                onPress={() => router.push({ pathname: '/machine/[id]/sessions', params: { id: machine.id, serverId: scope.serverId } })} />
        </SettingsSection>
        <SettingsSection compact title={t('codexTopProjects.title')}>
            {!machineOnline ? <Item style={{ minHeight: 48 }} testID="phone-machine-projects-offline" title={t('codexTopProjects.offline')} density="cozy" mode="info" /> : null}
            {projects.loading && projects.projects === null ? <Item style={{ minHeight: 48 }} title={t('codexTopProjects.loading')} density="cozy" mode="info" /> : null}
            {projects.error ? <Item style={{ minHeight: 48 }} testID="phone-machine-projects-unavailable" title={t('codexTopProjects.unavailable')} subtitle={projects.projects ? t('codexTopProjects.partial') : undefined} density="cozy" mode="info" /> : null}
            {projects.projects?.length === 0 ? <Item style={{ minHeight: 48 }} testID="phone-machine-projects-empty" title={t('codexTopProjects.empty')} density="cozy" mode="info" /> : null}
            {projects.projects?.map((project) => <Item style={{ minHeight: 48 }} titleLines={0} key={JSON.stringify([project.sourceKey, project.id])} testID={`phone-machine-project-${project.id}`}
                title={project.name || project.id} subtitle={project.available ? t('codexTopProjects.openSessions') : t('codexTopProjects.unavailableFolder')}
                density="cozy" disabled={!project.available} icon={<Icon name="folder" size={22} color={theme.colors.text.secondary} />}
                onPress={() => router.push({ pathname: '/machine/[id]/sessions', params: { id: machine.id, serverId: scope.serverId, projectId: project.id, sourceKey: project.sourceKey } })} />)}
            {machineOnline ? <Item style={{ minHeight: 48 }} testID="phone-machine-projects-refresh" title={t('codexTopProjects.refresh')} density="cozy" disabled={projects.loading} onPress={() => { void projects.refresh(); }} /> : null}
        </SettingsSection>
    </ItemList>;
}
