import * as React from 'react';

import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { useConnectAccount } from '@/hooks/auth/useConnectAccount';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';
import { parseTerminalConnectUrl } from '@/utils/path/terminalConnectUrl';

type UseScannedAuthUrlProcessorOptions = Readonly<{
    onSuccess?: () => void;
    onError?: (error: any) => void;
}>;

export function useScannedAuthUrlProcessor(options?: UseScannedAuthUrlProcessorOptions) {
    const accountConnect = useConnectAccount(options);
    const terminalConnect = useConnectTerminal(options);

    const processAuthUrl = React.useCallback(async (rawUrl: string) => {
        const url = String(rawUrl ?? '').trim();
        if (!url) return false;

        if (parseTerminalConnectUrl(url)) {
            return await terminalConnect.processAuthUrl(url);
        }

        if (parseAccountConnectDeepLink(url)) {
            return await accountConnect.processAuthUrl(url);
        }

        await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
        return false;
    }, [accountConnect, terminalConnect]);

    return {
        processAuthUrl,
        isLoading: accountConnect.isLoading || terminalConnect.isLoading,
    };
}
