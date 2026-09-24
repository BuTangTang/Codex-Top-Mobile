import type { SessionCatalogControlAdapter as GenericSessionCatalogControlAdapter } from '@/session/catalogControls/sessionCatalogControlTypes';

import { withCodexAppServerControlClient } from '../control/withCodexAppServerControlClient';
import {
    listCodexAppServerSkills,
    listCodexVendorPlugins,
} from '../pluginAndSkillCatalog';

type CodexAppServerCatalogControlContext = Readonly<{
    cwd: string;
    metadata: Record<string, unknown> | null;
    accountSettings?: Readonly<Record<string, unknown>> | null;
    processEnv?: NodeJS.ProcessEnv;
    timeoutMs?: number | null;
}>;

type CodexAppServerCatalogControlAdapter = Readonly<{
    listVendorPlugins: (params: CodexAppServerCatalogControlContext) => Promise<unknown>;
    listSkills: (params: CodexAppServerCatalogControlContext) => Promise<unknown>;
}>;

function unsupportedVendorPlugins(diagnostic: string): Readonly<{
    unsupported: true;
    vendorPlugins: [];
    diagnostic: string;
}> {
    return { unsupported: true, vendorPlugins: [], diagnostic };
}

function unsupportedSkills(diagnostic: string): Readonly<{
    unsupported: true;
    skills: [];
    diagnostic: string;
}> {
    return { unsupported: true, skills: [], diagnostic };
}

function normalizeCwd(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function createCodexAppServerCatalogControlAdapter(): CodexAppServerCatalogControlAdapter {
    return {
        listVendorPlugins: async (params) => {
            const controlResult = await withCodexAppServerControlClient({
                cwd: params.cwd,
                metadata: params.metadata,
                accountSettings: params.accountSettings ?? null,
                processEnv: params.processEnv,
                timeoutMs: params.timeoutMs,
                run: async (client) => await listCodexVendorPlugins({
                    client,
                    cwd: params.cwd,
                }),
            });
            return controlResult.ok
                ? controlResult.value
                : unsupportedVendorPlugins(controlResult.errorCode);
        },
        listSkills: async (params) => {
            const controlResult = await withCodexAppServerControlClient({
                cwd: params.cwd,
                metadata: params.metadata,
                accountSettings: params.accountSettings ?? null,
                processEnv: params.processEnv,
                timeoutMs: params.timeoutMs,
                run: async (client) => await listCodexAppServerSkills({
                    client,
                    cwd: params.cwd,
                }),
            });
            return controlResult.ok
                ? controlResult.value
                : unsupportedSkills(controlResult.errorCode);
        },
    };
}

const nativeCatalogControlAdapter = createCodexAppServerCatalogControlAdapter();

export const codexAppServerCatalogControlAdapter: GenericSessionCatalogControlAdapter = {
    listVendorPlugins: async (params) => {
        const cwd = normalizeCwd(params.cwd);
        if (!cwd) return unsupportedVendorPlugins('session_catalog_control_cwd_unavailable');
        return await nativeCatalogControlAdapter.listVendorPlugins({
            cwd,
            metadata: params.metadata,
        });
    },
    listSkills: async (params) => {
        const cwd = normalizeCwd(params.cwd);
        if (!cwd) return unsupportedSkills('session_catalog_control_cwd_unavailable');
        return await nativeCatalogControlAdapter.listSkills({
            cwd,
            metadata: params.metadata,
        });
    },
};
