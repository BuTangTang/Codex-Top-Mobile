import * as React from 'react';
import { View, ScrollView, Platform } from 'react-native';
import { useDeviceType } from '@/utils/platform/responsive';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Typography } from '@/constants/Typography';
import { ITEM_TITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import type { useDirectSessionControl } from '@/components/sessions/model/useDirectSessionControl';

/** 审批使用平面分隔和蓝色常规按钮，保留完整详情滚动与 48 点触摸区域。 */
const styles = StyleSheet.create((theme) => ({
    viewport: { maxHeight: 260 },
    panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: theme.colors.surface.inset },
    phonePanel: { paddingHorizontal: 4, paddingVertical: 4, gap: 4, backgroundColor: theme.colors.surface.base },
    title: { ...Typography.default('semiBold'), fontSize: 14, color: theme.colors.text.primary },
    detail: { ...Typography.mono(), fontSize: 12, color: theme.colors.text.primary },
    hint: { ...Typography.default(), fontSize: 12, color: theme.colors.text.secondary },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    phoneActions: { gap: 8 },
    action: { minHeight: 48, minWidth: 48, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.colors.state.active.background },
    actionText: { ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.state.active.onTint },
    secondaryActionText: { ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.text.primary },
    secondaryAction: { minHeight: 48, minWidth: 48, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border.default },
    refresh: { alignSelf: 'flex-start', minHeight: 48, minWidth: 48, justifyContent: 'center', borderRadius: 8 },
    request: { gap: 8, paddingVertical: 8 },
    phoneRequest: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.default },
}));

/** 将原文件操作类型转换为可读标签，未知类型不暴露内部协议值。 */
function formatApprovalFileKind(kind: string): string {
    switch (kind) {
        case 'add': return '新增';
        case 'delete': return '删除';
        case 'update': return '修改';
        default: return '文件操作';
    }
}

/** 仅解释已知审批阻断原因；未知原因统一引导电脑核对，不能暗示允许批准。 */
function formatApprovalReason(reason: string): string {
    switch (reason) {
        case 'unsupported_request': return '当前请求类型暂不支持在手机处理。';
        case 'approval_details_incomplete': return '操作详情不完整，请在电脑查看并处理。';
        default: return '当前操作需要在电脑查看并处理。';
    }
}

/** 展示原桌面请求的完整范围；只有明确可决定且未发出的版本允许一次性操作。 */
export function DesktopApprovalPanel(props: Readonly<{
    control: ReturnType<typeof useDirectSessionControl>;
    canWrite: boolean;
}>) {
    const compactPhone = useDeviceType() === 'phone' && Platform.OS !== 'web';
    const control = props.control;
    const requests = control.snapshot?.requests ?? [];
    /** 刷新继续交由原控制器读取原桌面状态。 */
    const refresh = () => { void control.refresh(); };
    if (!requests.length && !control.error && !control.outcome && !control.loading) return null;
    return <ScrollView style={styles.viewport} contentContainerStyle={[styles.panel, compactPhone ? styles.phonePanel : null]} keyboardShouldPersistTaps="handled" testID="desktop-approval-panel">
        {control.loading ? <Text style={styles.hint}>正在核对桌面状态…</Text> : null}
        {control.error ? <Text style={styles.hint}>暂无法读取桌面待处理详情，请刷新或在电脑上查看。</Text> : null}
        {control.outcome ? <Text testID="desktop-control-outcome" style={styles.hint} accessibilityLiveRegion="polite">
            {control.outcome === 'accepted' ? '补充已接收，等待原会话后续输出。' : control.outcome === 'unknown' ? '操作结果待确认，请核对桌面最新状态，勿重复提交。' : '桌面未接受这次操作，请核对最新状态。'}
        </Text> : null}
        {requests.map(/** 保留请求与版本身份，只有原控制器确认可决定时开放按钮。 */ (request) => {
            const disabled = !props.canWrite || control.busy || control.loading || !request.canDecide || control.snapshot?.state !== 'running' || control.isRequestLocked(request);
            /** 审批保留同一请求对象，不重新构造或替换其身份。 */
            const allowOnce = () => { void control.decide(request, 'allow_once'); };
            /** 拒绝继续提交给原请求的控制器。 */
            const deny = () => { void control.decide(request, 'deny'); };
            return <View key={JSON.stringify([request.requestId, request.revision])} style={[styles.request, compactPhone ? styles.phoneRequest : null]}>
                <Text style={styles.title}>{request.kind === 'command' ? '等待命令确认' : request.kind === 'file_change' ? '等待文件修改确认' : '请在电脑上处理'}</Text>
                {request.command ? <Text testID={`desktop-approval-command-${request.requestId}`} style={styles.detail} selectable>{request.command}</Text> : null}
                {request.cwd ? <Text style={styles.hint} selectable>{request.cwd}</Text> : null}
                {request.files?.map((file, index) => <View key={JSON.stringify([file.path, index])}>
                    <Text style={styles.detail} selectable>{`${formatApprovalFileKind(file.kind)} · ${file.path}`}</Text>
                    {file.diff ? <Text style={styles.detail} selectable>{file.diff}</Text> : null}
                </View>)}
                {request.reason ? <Text style={styles.hint}>{formatApprovalReason(request.reason)}</Text> : null}
                {!request.canDecide ? <Text style={styles.hint}>当前请求无法在手机安全决定，请到电脑处理。</Text> : null}
                <View style={[styles.actions, compactPhone ? styles.phoneActions : null]}>
                    <RoundButton testID={`desktop-approval-allow-${request.requestId}`} title="允许一次" size={compactPhone ? "large" : "small"} display={compactPhone ? "inverted" : "default"} style={compactPhone ? styles.action : undefined} textStyle={compactPhone ? styles.actionText : undefined} disabled={disabled} onPress={allowOnce} />
                    <RoundButton testID={`desktop-approval-deny-${request.requestId}`} title="拒绝" size={compactPhone ? "large" : "small"} display={compactPhone ? "inverted" : "default"} style={compactPhone ? styles.secondaryAction : undefined} textStyle={compactPhone ? styles.secondaryActionText : undefined} disabled={disabled} onPress={deny} />
                </View>
            </View>;
        })}
        <RoundButton testID="desktop-control-refresh" title={compactPhone ? "刷新" : "刷新桌面状态"} accessibilityLabel="刷新桌面状态" size={compactPhone ? "large" : "small"} display={compactPhone ? "inverted" : "default"} style={compactPhone ? styles.refresh : undefined} textStyle={compactPhone ? styles.secondaryActionText : undefined} disabled={control.loading || control.busy} onPress={refresh} />
    </ScrollView>;
}
