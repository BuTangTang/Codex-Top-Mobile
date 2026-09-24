import { accountSettingsParse } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { refreshAccountSettingsForMinimumVersion } from '@/settings/accountSettings/refreshAccountSettingsForMinimumVersion';
import { updateAccountSettingsV2WithRetry } from '@/settings/accountSettings/updateAccountSettingsV2WithRetry';

export async function rememberCodexUsageLimitRecoveryPreference(params: Readonly<{
    credentials: Credentials;
}>): Promise<void> {
    const { version } = await updateAccountSettingsV2WithRetry({
        credentials: params.credentials,
        mutate: (settings) => {
            const parsed = accountSettingsParse(settings);
            return {
                ...parsed,
                usageLimitRecoverySettingsV1: {
                    v: 1,
                    mode: 'auto_wait',
                },
            };
        },
    });

    await refreshAccountSettingsForMinimumVersion({
        credentials: params.credentials,
        minSettingsVersion: version,
        mode: 'blocking',
    });
}
