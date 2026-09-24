import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text, TextInput } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { ComposerKeyboardScaffold } from '@/components/sessions/keyboardAvoidance';
import { PopoverBoundaryProvider } from '@/components/ui/popover';
import { AgentInputAttachmentsRow } from '@/components/sessions/agentInput/components/AgentInputAttachmentsRow';
import { AttachmentFilePicker } from '@/components/sessions/attachments/AttachmentFilePicker';
import { useNewSessionPromptValue, type NewSessionPromptStore } from '../hooks/screenModel/newSessionPromptStore';
import type { useNewSessionAttachmentsController } from '../attachments/useNewSessionAttachmentsController';
import type { AgentInputContentPopoverConfig } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { NewSessionWizardPopoverItem } from './NewSessionWizardAdaptiveSelection';
import { t } from '@/text';
import { Item } from '@/components/ui/lists/Item';
import { AgentInputChipPickerPanel } from '@/components/sessions/agentInput/components/AgentInputChipPickerPanel';
import { getPermissionModeOptionsForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import { NewSessionWizardDropdownSelectionItem } from './NewSessionWizardAdaptiveSelection';
import type { NewSessionSimplePanelProps } from './NewSessionSimplePanel';

type LaunchSettings = Pick<NewSessionSimplePanelProps,
    'agentType' | 'agentLabel' | 'handleAgentClick' | 'agentPickerOptions' | 'agentPickerSelectedOptionId' | 'onAgentPickerSelect'
    | 'useProfiles' | 'selectedProfileId' | 'profilePopover' | 'permissionMode' | 'handlePermissionModeChange'
    | 'modelMode' | 'setModelMode' | 'modelOptions'>;


type Props = Readonly<{
    boundaryRef: React.RefObject<View>;
    headerHeight: number;
    safeAreaBottom: number;
    promptStore: NewSessionPromptStore;
    onChangeText: (text: string) => void;
    machineName?: string;
    selectedPath: string;
    machinePopover?: AgentInputContentPopoverConfig;
    pathPopover?: AgentInputContentPopoverConfig;
    canCreate: boolean;
    isCreating: boolean;
    attachments: ReturnType<typeof useNewSessionAttachmentsController>;
    topContent?: React.ReactNode;
    launch: LaunchSettings;
}>;

/** Android 表单只重排展示；草稿、选择器、附件和提交仍由原模型管理。 */
export function NewSessionPhoneForm(props: Props) {
    const { theme } = useUnistyles();
    const prompt = useNewSessionPromptValue(props.promptStore);
    const [showLaunchSettings, setShowLaunchSettings] = React.useState(false);
    const launch = props.launch;
    const agentName = launch.agentLabel || launch.agentPickerOptions?.find((option) => option.id === (launch.agentPickerSelectedOptionId || launch.agentType))?.label || launch.agentType;
    // 未选定代理时不猜测权限集合，等待原模型提供实际代理。
    const permissions = launch.agentType ? getPermissionModeOptionsForAgentType(launch.agentType) : [];

    // 原附件卡片继续展示并允许移除，避免隐藏附件随文字意外发送。
    const badges = props.attachments.extraActionChips.flatMap((chip) => chip.composerAttachmentBadge ? [chip.composerAttachmentBadge] : []);
    return (
        <View ref={props.boundaryRef} testID="new-session-phone-form" style={{ flex: 1, backgroundColor: theme.colors.surface.base }}>
            <PopoverBoundaryProvider boundaryRef={props.boundaryRef}>
                <ComposerKeyboardScaffold
                    mode="newSession"
                    headerHeight={props.headerHeight}
                    safeAreaBottom={props.safeAreaBottom}
                    style={{ flex: 1 }}
                    composer={<View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                        <RoundButton
                            testID="new-session-phone-submit"
                            title={t('components.emptySessionsTablet.startNewSessionButton')}
                            disabled={!props.canCreate || props.isCreating}
                            loading={props.isCreating}
                            style={{ borderRadius: 12, backgroundColor: theme.colors.accent.blue }}
                            onPress={() => {
                                // 保留模型的可提交门禁，不绕过机器在线与必填项校验。
                                if (props.canCreate && !props.isCreating) props.attachments.handleSend();
                            }}
                        />
                    </View>}
                >
                    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
                        {props.topContent}
                        <NewSessionWizardPopoverItem
                            testID="new-session-phone-machine"
                            title={t('tabs.machines')}
                            subtitle={props.machineName || t('sessionGettingStarted.phoneTitle')}
                            icon={<Icon name="desktop" size={24} color={theme.colors.accent.blue} />}
                            popover={props.machinePopover}
                            boundaryRef={props.boundaryRef}
                        />
                        <NewSessionWizardPopoverItem
                            testID="new-session-phone-path"
                            title={t('newSession.selectWorkingDirectoryTitle')}
                            subtitle={props.selectedPath}
                            icon={<Icon name="folder" size={24} color={theme.colors.accent.blue} />}
                            popover={props.pathPopover}
                            boundaryRef={props.boundaryRef}
                        />
                        {/* 已恢复的运行方式始终可见，不能把旧草稿的非 Codex 或配置选择静默带入提交。 */}
                        {launch.agentPickerOptions && launch.onAgentPickerSelect ? <NewSessionWizardPopoverItem
                            testID="new-session-phone-agent"
                            title={t('newSession.selectAiBackendTitle')}
                            subtitle={agentName}
                            icon={<Icon name="cpu" size={24} color={theme.colors.accent.blue} />}
                            boundaryRef={props.boundaryRef}
                            popover={{ renderContent: ({ requestClose, maxHeight }) => <AgentInputChipPickerPanel
                                title={t('newSession.selectAiBackendTitle')}
                                options={launch.agentPickerOptions ?? []}
                                selectedOptionId={launch.agentPickerSelectedOptionId || launch.agentType}
                                onSelect={(id) => { launch.onAgentPickerSelect?.(id); requestClose(); }}
                                onRequestClose={requestClose}
                                maxHeight={maxHeight}
                            /> }}
                        /> : <Item testID="new-session-phone-agent" title={t('newSession.selectAiBackendTitle')} subtitle={agentName} onPress={launch.handleAgentClick} />}
                        {launch.useProfiles || launch.selectedProfileId ? <NewSessionWizardPopoverItem
                            testID="new-session-phone-profile"
                            title={t('newSession.selectAiProfileTitle')}
                            subtitle={launch.selectedProfileId || t('common.default')}
                            icon={<Icon name="user-circle" size={24} color={theme.colors.accent.blue} />}
                            boundaryRef={props.boundaryRef}
                            popover={launch.profilePopover}
                        /> : null}
                        <Item testID="new-session-phone-launch-settings" title={t('newSession.launchSettings')}
                            subtitle={`${launch.modelMode || 'default'} · ${permissions.find((option) => option.value === launch.permissionMode)?.label || launch.permissionMode}`}
                            accessibilityState={{ expanded: showLaunchSettings }}
                            onPress={() => setShowLaunchSettings((open) => !open)} />
                        {showLaunchSettings ? <>
                            <NewSessionWizardDropdownSelectionItem
                                testID="new-session-phone-model"
                                title={t('newSession.selectModelTitle')}
                                icon={<Icon name="cpu" size={24} color={theme.colors.accent.blue} />}
                                boundaryRef={props.boundaryRef}
                                selectedId={launch.modelMode}
                                items={launch.modelOptions.map((option) => ({ id: option.value, title: option.label, subtitle: option.description }))}
                                onSelect={(id) => { const option = launch.modelOptions.find((option) => option.value === id); if (option) launch.setModelMode?.(option.value); }}
                            />
                            <NewSessionWizardDropdownSelectionItem
                                testID="new-session-phone-permission"
                                title={t('newSession.selectPermissionModeTitle')}
                                icon={<Icon name="shield" size={24} color={theme.colors.accent.blue} />}
                                boundaryRef={props.boundaryRef}
                                selectedId={launch.permissionMode}
                                items={permissions.map((option) => ({ id: option.value, title: option.label, subtitle: option.description }))}
                                onSelect={(id) => { const option = permissions.find((option) => option.value === id); if (option) launch.handlePermissionModeChange?.(option.value); }}
                            />
                        </> : null}
                        <TextInput
                            testID="new-session-phone-prompt"
                            value={prompt}
                            onChangeText={props.onChangeText}
                            placeholder={t('session.inputPlaceholder')}
                            placeholderTextColor={theme.colors.text.secondary}
                            multiline
                            textAlignVertical="top"
                            editable={!props.isCreating}
                            style={{ minHeight: 200, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 12, padding: 16, color: theme.colors.text.primary, backgroundColor: theme.colors.surface.inset, fontSize: 16 }}
                        />
                        <AgentInputAttachmentsRow attachments={props.attachments.agentInputAttachments} composerBadges={badges} />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {props.attachments.extraActionChips.map((chip) => <React.Fragment key={chip.key}>
                                {chip.render({
                                    chipStyle: () => ({ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }),
                                    showLabel: true,
                                    iconColor: theme.colors.accent.blue,
                                    textStyle: { color: theme.colors.text.secondary },
                                    countTextStyle: { color: theme.colors.text.secondary },
                                    popoverAnchorRef: props.boundaryRef,
                                })}
                            </React.Fragment>)}
                        </View>
                        {!props.canCreate && !props.isCreating ? <Text style={{ color: theme.colors.text.secondary }}>{t('common.unavailable')}</Text> : null}
                    </ScrollView>
                    {props.attachments.attachmentsUploadsEnabled ? <AttachmentFilePicker ref={props.attachments.filePickerRef} onAttachmentsPicked={props.attachments.addPickedAttachments} multiple /> : null}
                </ComposerKeyboardScaffold>
            </PopoverBoundaryProvider>
        </View>
    );
}
