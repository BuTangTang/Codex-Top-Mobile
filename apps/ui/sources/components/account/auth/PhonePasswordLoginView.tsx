import * as React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { Text, TextInput } from '@/components/ui/text/Text';
import { BrandLogo } from '@/components/ui/navigation/BrandLogo';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { layout } from '@/components/ui/layout/layout';
import { useAuth } from '@/auth/context/AuthContext';
import { assertAuthServerScopeCurrent } from '@/auth/context/authServerScope';
import { passwordLogin, PasswordLoginError } from '@/auth/flows/passwordLogin';
import { getActiveServerSnapshot, subscribeActiveServer } from '@/sync/domains/server/serverRuntime';
import { t } from '@/text';

/** 手机账号入口只管理表单和请求寿命，凭据与登录后会话返回仍由原 owner 管理。 */
export function PhonePasswordLoginView() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const auth = useAuth();
    const isFocused = useIsFocused();
    const focused = React.useRef(isFocused);
    focused.current = isFocused;
    const [server, setServer] = React.useState(getActiveServerSnapshot);
    const [loginName, setLoginName] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [showPassword, setShowPassword] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<'invalidCredentials' | 'rateLimited' | 'unavailable' | null>(null);
    const attempt = React.useRef(0);
    const pending = React.useRef<AbortController | null>(null);

    /** 离开、换服或新尝试使原请求失效；Abort 负责网络，代次守卫覆盖 KDF 和保存阶段。 */
    const cancel = React.useCallback(() => {
        attempt.current += 1;
        pending.current?.abort();
        pending.current = null;
    }, []);
    React.useEffect(() => {
        if (!isFocused) cancel();
        setBusy(false);
        return cancel;
    }, [cancel, isFocused]);
    React.useEffect(() => subscribeActiveServer((snapshot) => {
        cancel();
        setServer(snapshot);
        setBusy(false);
        setError(null);
    }), [cancel]);

    /** 先绘制忙态再派生密码，成功交给 AuthContext，保留首页原通知返回参数。 */
    const submit = async () => {
        if (pending.current || !focused.current || !loginName.trim() || !password) return;
        const controller = new AbortController();
        pending.current = controller;
        const id = ++attempt.current;
        const scope = {
            expectedActiveServerSnapshot: getActiveServerSnapshot(),
            isStillValid: () => focused.current && attempt.current === id && !controller.signal.aborted,
        };
        setBusy(true);
        setError(null);
        try {
            // 双帧让 React 忙态有提交绘制机会；标准 KDF 的计算耗时仍需真机验证。
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            assertAuthServerScopeCurrent(scope);
            const credentials = await passwordLogin({ loginName, password, ...scope, signal: controller.signal });
            assertAuthServerScopeCurrent(scope);
            await auth.loginWithCredentials(credentials, scope);
            // 不另建跳转 owner：Home 已有 Authenticated 分支消费 sessionAuthReturnTo。
            if (scope.isStillValid()) setPassword('');
        } catch (cause) {
            if (scope.isStillValid()) setError(cause instanceof PasswordLoginError ? cause.code : 'unavailable');
        } finally {
            if (attempt.current === id) {
                pending.current = null;
                setBusy(false);
            }
        }
    };
    /** 服务器设置保留现有公开入口，打开前立即取消旧服务器登录。 */
    const openServer = () => {
        cancel();
        setBusy(false);
        router.push('/server');
    };
    return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.form, { maxWidth: layout.maxWidth }]}>
                <View style={styles.brand}><BrandLogo size={88} /><Text style={styles.title}>{t('phonePasswordLogin.title')}</Text></View>
                <Text style={styles.label}>{t('phonePasswordLogin.username')}</Text>
                <View style={styles.field}><Icon name="user-circle" size={20} color={theme.colors.text.secondary} /><TextInput testID="phone-login-name" style={styles.input} value={loginName} onChangeText={setLoginName} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" maxLength={128} editable={!busy} accessibilityLabel={t('phonePasswordLogin.username')} /></View>
                <Text style={styles.label}>{t('phonePasswordLogin.password')}</Text>
                <View style={styles.field}><Icon name="lock" size={20} color={theme.colors.text.secondary} /><TextInput testID="phone-login-password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" maxLength={1024} editable={!busy} accessibilityLabel={t('phonePasswordLogin.password')} returnKeyType="go" onSubmitEditing={() => { void submit(); }} />
                    <Pressable testID="phone-login-password-toggle" style={styles.eye} onPress={() => setShowPassword((value) => !value)} accessibilityRole="button" accessibilityLabel={t(showPassword ? 'phonePasswordLogin.hidePassword' : 'phonePasswordLogin.showPassword')}><Icon name={showPassword ? 'eye-slash' : 'eye'} size={20} color={theme.colors.text.secondary} /></Pressable>
                </View>
                {error ? <Text testID="phone-login-error" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(`phonePasswordLogin.${error}`)}</Text> : null}
                <RoundButton testID="phone-login-submit" title={t('phonePasswordLogin.login')} loading={busy} disabled={busy || !loginName.trim() || !password} onPress={submit} style={styles.login} />
                <Pressable testID="phone-login-server" onPress={openServer} accessibilityRole="button" style={styles.server}><Icon name="hard-drives" size={18} color={theme.colors.accent.blue} /><Text style={styles.serverText}>{t('phonePasswordLogin.server')}</Text></Pressable>
                <Text style={styles.serverAddress}>{server.serverUrl}</Text>
            </View>
        </ScrollView>
    </KeyboardAvoidingView>;
}

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28 },
    form: { width: '100%', alignSelf: 'center' },
    brand: { alignItems: 'center', marginBottom: 32, gap: 20 },
    title: { ...Typography.default('semiBold'), fontSize: 22, lineHeight: 28, color: theme.colors.text.primary, textAlign: 'center' },
    label: { ...Typography.default(), fontSize: 15, lineHeight: 20, color: theme.colors.text.secondary, marginBottom: 6 },
    field: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 12, paddingLeft: 14, marginBottom: 16, gap: 12 },
    input: { ...Typography.default(), fontSize: 17, lineHeight: 22, color: theme.colors.text.primary, flex: 1, minWidth: 0, paddingVertical: 12 },
    eye: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    error: { ...Typography.default(), fontSize: 13, lineHeight: 18, color: theme.colors.state.danger.foreground, marginBottom: 12 },
    login: { minHeight: 48, borderRadius: 12, backgroundColor: theme.colors.accent.blue, marginTop: 12 },
    server: { minHeight: 48, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
    serverText: { ...Typography.default(), fontSize: 15, lineHeight: 20, color: theme.colors.accent.blue },
    serverAddress: { ...Typography.default(), fontSize: 12, lineHeight: 16, color: theme.colors.text.secondary, textAlign: 'center' },
}));
