import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { useScannedAuthUrlProcessor } from '@/hooks/auth/useScannedAuthUrlProcessor';
import { Modal } from '@/modal';
import { t } from '@/text';

import { QrCodeScannerView } from './QrCodeScannerView';

type ScanAuthQrScreenProps = Readonly<{
    testIDPrefix: string;
}>;

export function ScanAuthQrScreen(props: ScanAuthQrScreenProps) {
    const router = useRouter();
    const { processAuthUrl } = useScannedAuthUrlProcessor({
        onSuccess: () => router.back(),
    });

    return (
        <QrCodeScannerView
            testIDPrefix={props.testIDPrefix}
            title={t('connect.linkNewDeviceTitle')}
            subtitle={t('connect.linkNewDeviceSubtitle')}
            permissionRequiredMessage={t('modals.cameraPermissionsRequiredToScanQr')}
            onCancel={() => router.back()}
            onScan={async (data) => {
                if (data.trim()) {
                    await processAuthUrl(data.trim());
                }
            }}
            footer={
                <View style={{ width: '100%', maxWidth: 360 }}>
                    <RoundButton
                        testID={`${props.testIDPrefix}-enter-url`}
                        size="normal"
                        title={t('connect.enterUrlManually')}
                        action={async () => {
                            const url = await Modal.prompt(
                                t('connect.linkNewDeviceTitle'),
                                undefined,
                                {
                                    confirmText: t('common.continue'),
                                    cancelText: t('common.cancel'),
                                },
                            );
                            if (typeof url === 'string' && url.trim()) {
                                await processAuthUrl(url.trim());
                            }
                        }}
                    />
                </View>
            }
        />
    );
}
