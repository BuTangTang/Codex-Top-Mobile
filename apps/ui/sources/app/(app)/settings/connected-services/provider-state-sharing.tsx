import React from 'react';

import { ConnectedServicesProviderStateSharingSettingsView } from '@/components/settings/connectedServices/ConnectedServicesProviderStateSharingSettings';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

export default React.memo(function ConnectedServicesProviderStateSharingRoute() {
    const enabled = useFeatureEnabled('connectedServices');

    if (!enabled) {
        return null;
    }

    return <ConnectedServicesProviderStateSharingSettingsView />;
});
