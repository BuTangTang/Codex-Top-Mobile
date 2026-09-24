import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ItemList } from '@/components/ui/lists/ItemList';
import { getAvatarUrl, getDisplayName, type Profile } from '@/sync/domains/profiles/profile';
import { t } from '@/text';

/** 手机账号页只展示真实身份和当前设备退出入口，不暴露密钥或设备配对流程。 */
export function PhoneAccountSummary(props: Readonly<{
    profile: Profile;
    isAuthenticated: boolean;
    loginName?: string;
    onLogout: () => Promise<void>;
}>) {
    const { theme } = useUnistyles();
    const name = props.loginName || getDisplayName(props.profile) || props.profile.username || t('settingsAccount.notAvailable');
    return (
        <ItemList style={{ backgroundColor: theme.colors.surface.base }}>
            <SettingsSection compact>
                <Item
                    style={{ minHeight: 48 }}
                    testID="settings-account-phone-identity"
                    title={name}
                    subtitle={props.isAuthenticated ? '独立账号' : t('settingsAccount.statusNotAuthenticated')}
                    icon={<Avatar id={props.profile.id} size={40} imageUrl={getAvatarUrl(props.profile)} thumbhash={props.profile.avatar?.thumbhash} />}
                    density="cozy"
                    titleLines={0}
                    showChevron={false}
                />
            </SettingsSection>
            <SettingsSection compact footer="仅访问自己账号下的电脑、项目和会话">
                <Item style={{ minHeight: 48 }} testID="settings-account-phone-name" title="账号" detail={name} density="cozy" titleLines={0} showChevron={false} />
            </SettingsSection>
            <SettingsSection compact footer="退出仅影响当前设备，其他已登录设备不受影响。">
                <Item
                    style={{ minHeight: 48 }}
                    testID="settings-account-logout"
                    title={t('settingsAccount.logout')}
                    icon={<Icon name="sign-out" size={22} color={theme.colors.state.danger.foreground} />}
                    density="cozy"
                    titleLines={0}
                    showChevron={false}
                    destructive
                    onPress={props.onLogout}
                />
            </SettingsSection>
        </ItemList>
    );
}
