import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import { resolveSessionAuthReturnTo, buildAuthRestoreRoute, buildSessionAuthReturnTo } from '@/auth/routing/authRouting';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { useAuth } from '@/auth/context/AuthContext';
import { generateAuthKeyPair, authQRStart } from '@/auth/flows/qrStart';
import { authQRWait } from '@/auth/flows/qrWait';
import { buildPairingDeepLink, parsePairingDeepLink } from '@/auth/pairing/pairingUrl';
import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { encodeBase64 } from '@/encryption/base64';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { pairingRequest } from '@/sync/api/account/apiPairingAuth';
import { getActiveServerUrl, areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { normalizeServerUrl, upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { resolveEffectiveServerUrlOverride } from '@/sync/domains/server/url/serverUrlOverridePolicy';
import { isLoopbackServerUrl } from '@/sync/domains/server/url/serverUrlClassification';
import { Text } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Typography } from '@/constants/Typography';
import { QrCodeScannerView } from '@/components/qr/QrCodeScannerView';
import { promptAccountConnectApprovalRequired } from './accountConnectApprovalGuidance';

const stylesheet = StyleSheet.create((theme) => ({
    scrollView: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
    },
    container: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    contentWrapper: {
        width: '100%',
        maxWidth: 560,
        paddingVertical: 28,
    },
    title: {
        fontSize: 18,
        color: theme.colors.text.primary,
        marginBottom: 10,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 14,
        color: theme.colors.text.secondary,
        lineHeight: 20,
        textAlign: 'center',
        ...Typography.default(),
    },
    statusCard: {
        marginTop: 18,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface.base,
    },
    codeLabel: {
        marginTop: 12,
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    codeValue: {
        marginTop: 6,
        fontSize: 18,
        color: theme.colors.text.primary,
        letterSpacing: 1,
        ...Typography.mono(),
    },
    footer: {
        marginTop: 18,
        alignItems: 'center',
        width: '100%',
        gap: 12,
    },
    footerButton: {
        width: '100%',
        maxWidth: 360,
    },
}));

function resolveDeviceLabel(): string | null {
    const name = Constants.deviceName ?? '';
    const trimmed = String(name).trim();
    if (trimmed) return trimmed;
    if (Platform.OS === 'ios') return 'iPhone';
    if (Platform.OS === 'android') return 'Android';
    return null;
}

export const RestoreScanComputerQrView = React.memo(function RestoreScanComputerQrView() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const isFocused = useIsFocused();
    const params = useLocalSearchParams();
    const target = buildSessionAuthReturnTo(params);
    const focusLifetimeRef = React.useRef({ active: isFocused, target });
    // 失焦或目标变化立即废弃旧焦点生命周期，返回同一目标也不能复活旧请求。
    if (!isFocused || focusLifetimeRef.current.target !== target) focusLifetimeRef.current.active = false;
    if (isFocused && !focusLifetimeRef.current.active) focusLifetimeRef.current = { active: true, target };
    const focusLifetime = focusLifetimeRef.current;
    React.useEffect(() => () => { focusLifetime.active = false; }, [focusLifetime]);
    const auth = useAuth();
    const pairingDecision = useFeatureDecision('auth.pairing.desktopQrMobileScan');
    const pairingState = pairingDecision?.state ?? 'unknown';

    const [phase, setPhase] = React.useState<'idle' | 'requesting' | 'waiting'>('idle');
    const [confirmCode, setConfirmCode] = React.useState<string | null>(null);
    const [waitingDots, setWaitingDots] = React.useState(0);
    const isCancelledRef = React.useRef(false);

    const processPairingLink = React.useCallback(
        async (rawUrl: string) => {
            // 登录完成前后均核对页面归属，防止迟到结果抢回新通知页面。
            const isCurrent = () => !isCancelledRef.current && focusLifetime.active;
            if (parseAccountConnectDeepLink(rawUrl.trim())) {
                const action = await promptAccountConnectApprovalRequired();
                // 提示框关闭前可能已由新通知离开页面，旧结果不得重新导航。
                if (!isCurrent()) return;
                if (action === 'showQr') {
                    router.push(buildAuthRestoreRoute('/restore/show-qr', params, getActiveServerSnapshot().serverId));
                }
                return;
            }

            const parsed = parsePairingDeepLink(rawUrl.trim());
            if (!parsed) {
                await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'));
                return;
            }

            setPhase('requesting');
            setConfirmCode(null);

            try {
                const activeServerUrl = normalizeServerUrl(getActiveServerUrl());
                const activeServerUrlIsLoopback = activeServerUrl ? isLoopbackServerUrl(activeServerUrl) : false;

                if (parsed.serverUrl) {
                    const target = resolveEffectiveServerUrlOverride({
                        requestedServerUrl: parsed.serverUrl,
                        activeServerUrl,
                    });
                    if (target) {
                        await upsertActivateAndSwitchServer({
                            serverUrl: target,
                            source: 'url',
                            scope: 'device',
                            refreshAuth: auth.refreshFromActiveServer,
                        });
                    }
                }

                // 显式二维码换服完成后、任何认证请求之前固定来源。
                const loginServerId = getActiveServerSnapshot().serverId;
                const isLoginSourceCurrent = () => isCurrent() && areServerProfileIdentifiersEquivalent(loginServerId, getActiveServerSnapshot().serverId);
                if (!isLoginSourceCurrent()) return;
                const keypair = generateAuthKeyPair();
                const started = await authQRStart(keypair);
                if (!isLoginSourceCurrent()) return;
                if (!started) {
                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                    setPhase('idle');
                    return;
                }

                const pairingRes = await pairingRequest({
                    pairId: parsed.pairId,
                    secret: parsed.secret,
                    publicKey: encodeBase64(keypair.publicKey),
                    deviceLabel: resolveDeviceLabel() ?? undefined,
                });

                if (!isLoginSourceCurrent()) return;
                if (!pairingRes.ok) {
                    if (pairingRes.reason === 'not_found') {
                        const requestedLoopback = parsed.serverUrl ? isLoopbackServerUrl(parsed.serverUrl) : false;
                        const showServerUrlNotEmbeddedHint = parsed.serverUrl == null || (requestedLoopback && !activeServerUrlIsLoopback);
                        if (showServerUrlNotEmbeddedHint) {
                            await Modal.alertAsync(t('connect.serverUrlNotEmbeddedTitle'), t('connect.serverUrlNotEmbeddedBody'));
                        } else {
                            await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                        }
                    } else if (pairingRes.reason === 'already_requested') {
                        await Modal.alertAsync(
                            t('connect.pairingAlreadyRequestedTitle'),
                            t('connect.pairingAlreadyRequestedBody'),
                        );
                    } else {
                        await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                    }
                    setPhase('idle');
                    return;
                }

                setConfirmCode(pairingRes.data.confirmCode);

                setPhase('waiting');
                const credentials = await authQRWait(
                    keypair,
                    (dots) => setWaitingDots(dots),
                    () => !isCurrent(),
                );

                if (credentials && isLoginSourceCurrent()) {
                    const secretString = encodeBase64(credentials.secret, 'base64url');
                    await auth.login(credentials.token, secretString);
                    if (isCurrent()) {
                        router.replace(resolveSessionAuthReturnTo(params, getActiveServerSnapshot().serverId) ?? '/');
                    }
                } else if (isCurrent()) {
                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                    setPhase('idle');
                }
            } catch {
                if (isCurrent()) {
                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                }
                setPhase('idle');
            }
        },
        [auth, router, params, focusLifetime],
    );

    React.useEffect(() => {
        return () => {
            isCancelledRef.current = true;
        };
    }, []);

    const waitingSuffix = phase === 'waiting' ? '.'.repeat(waitingDots % 4) : '';
    const statusText =
        phase === 'idle'
            ? t('connect.scanComputerQrInstructions')
                : phase === 'requesting'
                    ? t('common.loading')
                    : `${t('connect.waitingForApproval')}${waitingSuffix}`;

    if (pairingState === 'unknown') {
        return (
            <ScrollView style={styles.scrollView} contentContainerStyle={{ flexGrow: 1 }}>
                <View style={styles.container}>
                    <View style={styles.contentWrapper}>
                        <Text style={styles.title}>{t('connect.restoreAccount')}</Text>
                        <Text style={styles.subtitle}>{t('common.loading')}</Text>

                        <View style={styles.statusCard}>
                            <ActivitySpinner size="small" color={theme.colors.text.primary} />
                        </View>

                        <View style={styles.footer}>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-open-manual"
                                    size="small"
                                    title={t('connect.restoreWithSecretKeyInstead')}
                                    display="inverted"
                                    action={async () => {
                                        router.push(buildAuthRestoreRoute('/restore/manual', params, getActiveServerSnapshot().serverId));
                                    }}
                                />
                            </View>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-show-qr-instead"
                                    size="small"
                                    title={t('connect.showQrInstead')}
                                    display="inverted"
                                    action={async () => {
                                        router.push(buildAuthRestoreRoute('/restore/show-qr', params, getActiveServerSnapshot().serverId));
                                    }}
                                />
                            </View>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-scan-cancel"
                                    size="small"
                                    title={t('common.back')}
                                    display="inverted"
                                    action={async () => {
                                        router.back();
                                    }}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            </ScrollView>
        );
    }

    if (pairingState !== 'enabled') {
        return (
            <ScrollView style={styles.scrollView} contentContainerStyle={{ flexGrow: 1 }}>
                <View style={styles.container}>
                    <View style={styles.contentWrapper}>
                        <Text style={styles.title}>{t('connect.restoreAccount')}</Text>
                        <Text style={styles.subtitle}>{t('connect.scanComputerQrUnavailableBody')}</Text>

                        <View style={styles.statusCard}>
                            <Text style={styles.codeLabel}>{t('connect.scanComputerQrUnavailableTitle')}</Text>
                        </View>

                        <View style={styles.footer}>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-open-manual"
                                    size="small"
                                    title={t('connect.restoreWithSecretKeyInstead')}
                                    display="inverted"
                                    action={async () => {
                                        router.push(buildAuthRestoreRoute('/restore/manual', params, getActiveServerSnapshot().serverId));
                                    }}
                                />
                            </View>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-show-qr-instead"
                                    size="small"
                                    title={t('connect.showQrInstead')}
                                    display="inverted"
                                    action={async () => {
                                        router.push(buildAuthRestoreRoute('/restore/show-qr', params, getActiveServerSnapshot().serverId));
                                    }}
                                />
                            </View>
                            <View style={styles.footerButton}>
                                <RoundButton
                                    testID="restore-scan-cancel"
                                    size="small"
                                    title={t('common.back')}
                                    display="inverted"
                                    action={async () => {
                                        router.back();
                                    }}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            </ScrollView>
        );
    }

    if (phase === 'idle') {
        return (
            <QrCodeScannerView
                active={isFocused}
                testIDPrefix="restore-scan"
                title={t('connect.restoreAccount')}
                subtitle={t('connect.scanComputerQrInstructions')}
                permissionRequiredMessage={t('modals.cameraPermissionsRequiredToScanQr')}
                onCancel={() => router.back()}
                onScan={async (data) => {
                    if (typeof data === 'string' && data.trim()) {
                        await processPairingLink(data.trim());
                    }
                }}
                footer={
                    <>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-enter-pairing-link"
                                size="normal"
                                title={t('connect.enterUrlManually')}
                                action={async () => {
                                    const url = await Modal.prompt(
                                        t('connect.enterUrlManually'),
                                        undefined,
                                        {
                                            placeholder: buildPairingDeepLink({
                                                pairId: '…',
                                                secret: '…',
                                                serverUrl: getActiveServerUrl(),
                                            }),
                                            confirmText: t('common.continue'),
                                            cancelText: t('common.cancel'),
                                        },
                                    );
                                    if (typeof url === 'string' && url.trim()) {
                                        await processPairingLink(url.trim());
                                    }
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-open-manual"
                                size="small"
                                title={t('connect.restoreWithSecretKeyInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push(buildAuthRestoreRoute('/restore/manual', params, getActiveServerSnapshot().serverId));
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-show-qr-instead"
                                size="small"
                                title={t('connect.showQrInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push(buildAuthRestoreRoute('/restore/show-qr', params, getActiveServerSnapshot().serverId));
                                }}
                            />
                        </View>
                    </>
                }
            />
        );
    }

    return (
        <ScrollView style={styles.scrollView} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={styles.container}>
                <View style={styles.contentWrapper}>
                    <Text style={styles.title}>{t('connect.restoreAccount')}</Text>
                    <Text style={styles.subtitle}>{statusText}</Text>

                    <View style={styles.statusCard}>
                        <ActivitySpinner size="small" color={theme.colors.text.primary} />
                        {confirmCode ? (
                            <>
                                <Text style={styles.codeLabel}>{t('connect.confirmCodeLabel')}</Text>
                                <Text style={styles.codeValue}>{confirmCode}</Text>
                            </>
                        ) : null}
                    </View>

                    <View style={styles.footer}>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-enter-pairing-link"
                                size="small"
                                title={t('connect.enterUrlManually')}
                                display="inverted"
                                action={async () => {
                                    const url = await Modal.prompt(
                                        t('connect.enterUrlManually'),
                                        undefined,
                                        {
                                            placeholder: buildPairingDeepLink({
                                                pairId: '…',
                                                secret: '…',
                                                serverUrl: getActiveServerUrl(),
                                            }),
                                            confirmText: t('common.continue'),
                                            cancelText: t('common.cancel'),
                                        },
                                    );
                                    if (typeof url === 'string' && url.trim()) {
                                        await processPairingLink(url.trim());
                                    }
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-open-manual"
                                size="small"
                                title={t('connect.restoreWithSecretKeyInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push(buildAuthRestoreRoute('/restore/manual', params, getActiveServerSnapshot().serverId));
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-show-qr-instead"
                                size="small"
                                title={t('connect.showQrInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push(buildAuthRestoreRoute('/restore/show-qr', params, getActiveServerSnapshot().serverId));
                                }}
                            />
                        </View>
                    </View>
                </View>
            </View>
        </ScrollView>
    );
});
