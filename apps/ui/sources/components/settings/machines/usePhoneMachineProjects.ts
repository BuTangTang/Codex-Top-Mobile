import * as React from 'react';
import type { DesktopProjectV1, DirectSessionsSource } from '@happier-dev/protocol';
import { machineDirectSessionsProjectsList } from '@/sync/ops/machineDirectSessions';
import { useActiveServerAccountScope, useProfile, useSettings } from '@/sync/store/hooks';
import { resolveDirectBrowseSourceOptions } from '@/components/sessions/directSessions/browse/resolveDirectBrowseSourceOptions';
import { t } from '@/text';

export type PhoneMachineProject = DesktopProjectV1 & Readonly<{ source: DirectSessionsSource; sourceKey: string }>;
type ProjectState = Readonly<{ identity: string; projects: PhoneMachineProject[] | null; error: string | null; loading: boolean }>;

/** 按当前账号、电脑与实际来源读取桌面项目；旧账号或旧电脑回包不能更新选择。 */
export function usePhoneMachineProjects(params: Readonly<{ machineId: string | null; serverId?: string; enabled: boolean }>) {
    const scope = useActiveServerAccountScope();
    const profile = useProfile();
    const settings = useSettings();
    const serverId = params.serverId ?? scope?.serverId;
    const enabled = Boolean(params.enabled && scope && params.machineId && serverId === scope.serverId);
    const sources = React.useMemo(() => resolveDirectBrowseSourceOptions({ providerId: 'codex', profile, settings }), [profile, settings]);
    const sourcesKey = JSON.stringify(sources.map(({ key, source }) => [key, source]));
    const identity = JSON.stringify([scope?.accountId, serverId, params.machineId, sourcesKey]);
    const current = React.useRef({ identity, enabled });
    current.current = { identity, enabled };
    const version = React.useRef(0);
    const [state, setState] = React.useState<ProjectState>({ identity: '', projects: null, error: null, loading: false });

    /** 保留同目标已加载项目直到新响应返回，失败与真实空列表分开表达。 */
    const refresh = React.useCallback(async () => {
        if (!enabled || !params.machineId) return;
        const requestVersion = ++version.current;
        setState((previous) => ({ identity, projects: previous.identity === identity ? previous.projects : null, error: null, loading: true }));
        const sourceOptions = JSON.parse(sourcesKey) as Array<[string, DirectSessionsSource]>;
        const results = await Promise.allSettled(sourceOptions.map(([, source]) =>
            machineDirectSessionsProjectsList({ machineId: params.machineId!, providerId: 'codex', source }, { serverId })));
        if (current.current.identity !== identity || !current.current.enabled || version.current !== requestVersion) return;
        const projects: PhoneMachineProject[] = [];
        let error: string | null = null;
        let successCount = 0;
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                successCount += 1;
                const [sourceKey, source] = sourceOptions[index]!;
                projects.push(...result.value.projects.map((project) => ({ ...project, sourceKey, source })));
            } else {
                error = result.status === 'fulfilled' && !result.value.ok ? result.value.error : t('codexTopProjects.unavailable');
            }
        });
        setState({ identity, projects: successCount ? projects : null, error: error ?? (successCount ? null : t('codexTopProjects.unavailable')), loading: false });
    }, [enabled, identity, params.machineId, serverId, sourcesKey]);

    React.useEffect(() => { void refresh(); }, [refresh]);
    React.useEffect(() => () => { current.current = { identity: '', enabled: false }; version.current += 1; }, []);
    const visible = enabled && state.identity === identity;
    return { projects: visible ? state.projects : null, error: visible ? state.error : null, loading: visible ? state.loading : enabled, refresh };
}
