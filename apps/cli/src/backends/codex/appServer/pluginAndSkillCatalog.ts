import type { CodexAppServerClient } from './client/createCodexAppServerClient';
import { isCodexAppServerMethodNotFoundError } from './appServerCompatibility';

type MetadataRecord = Record<string, unknown>;

export type CodexVendorPluginCatalogEntry = Readonly<{
    id: string;
    name: string;
    displayName: string;
    description?: string;
    vendorPluginRef: string;
    installed: boolean;
    enabled: boolean;
    mentionable: boolean;
}>;

export type CodexSkillCatalogEntry = Readonly<{
    name: string;
    displayName: string;
    description?: string;
    path: string;
    enabled: boolean;
    origin: 'codex_native';
}>;

function asRecord(value: unknown): MetadataRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as MetadataRecord : null;
}

function asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    const record = asRecord(value);
    const data = record?.data ?? record?.plugins ?? record?.skills;
    return Array.isArray(data) ? data : [];
}

function readArrayProperty(record: MetadataRecord | null, key: string): unknown[] {
    const value = record?.[key];
    return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readMarketplaceName(record: MetadataRecord): string | null {
    const direct = readString(record.marketplaceName ?? record.marketplace);
    if (direct) return direct;
    const source = asRecord(record.source);
    return readString(source?.marketplace ?? source?.marketplaceName ?? source?.name);
}

function normalizePlugin(record: MetadataRecord): CodexVendorPluginCatalogEntry | null {
    const name = readString(record.name);
    if (!name) return null;
    const marketplaceName = readMarketplaceName(record);
    const id = readString(record.id);
    const vendorPluginRef = readString(record.vendorPluginRef ?? record.mentionPath)
        ?? (id?.startsWith('plugin://') ? id : null)
        ?? (marketplaceName ? `plugin://${name}@${marketplaceName}` : readString(record.path));
    if (!vendorPluginRef) return null;
    const installed = readBoolean(record.installed, false);
    const enabled = readBoolean(record.enabled, false);
    const pluginInterface = asRecord(record.interface);
    const description = readString(
        record.description
            ?? record.shortDescription
            ?? pluginInterface?.shortDescription
            ?? pluginInterface?.longDescription,
    );
    return {
        id: id ?? vendorPluginRef,
        name,
        displayName: readString(record.displayName ?? record.title ?? pluginInterface?.displayName) ?? name,
        ...(description ? { description } : {}),
        vendorPluginRef,
        installed,
        enabled,
        mentionable: installed && enabled,
    };
}

function normalizeSkill(record: MetadataRecord): CodexSkillCatalogEntry | null {
    const name = readString(record.name);
    const path = readString(record.path ?? record.location);
    if (!name || !path) return null;
    const skillInterface = asRecord(record.interface);
    const description = readString(
        skillInterface?.shortDescription
            ?? record.shortDescription
            ?? record.description,
    );
    return {
        name,
        displayName: readString(record.displayName ?? record.title ?? skillInterface?.displayName) ?? name,
        ...(description ? { description } : {}),
        path,
        enabled: readBoolean(record.enabled, true),
        origin: 'codex_native',
    };
}

function readPluginCatalogEntries(response: unknown): MetadataRecord[] {
    const responseRecord = asRecord(response);
    const marketplaces = readArrayProperty(responseRecord, 'marketplaces');
    if (marketplaces.length === 0) {
        return asArray(response).map((entry) => asRecord(entry)).filter((entry): entry is MetadataRecord => entry !== null);
    }

    const entries: MetadataRecord[] = [];
    for (const marketplaceValue of marketplaces) {
        const marketplace = asRecord(marketplaceValue);
        if (!marketplace) continue;
        const marketplaceName = readString(marketplace.name);
        for (const pluginValue of readArrayProperty(marketplace, 'plugins')) {
            const plugin = asRecord(pluginValue);
            if (!plugin) continue;
            entries.push(marketplaceName ? { ...plugin, marketplaceName } : plugin);
        }
    }
    return entries;
}

function readSkillCatalogEntries(response: unknown): MetadataRecord[] {
    const responseRecord = asRecord(response);
    const data = readArrayProperty(responseRecord, 'data');
    if (data.length === 0) {
        return asArray(response).map((entry) => asRecord(entry)).filter((entry): entry is MetadataRecord => entry !== null);
    }

    const entries: MetadataRecord[] = [];
    for (const listEntryValue of data) {
        const listEntry = asRecord(listEntryValue);
        if (!listEntry) continue;
        for (const skillValue of readArrayProperty(listEntry, 'skills')) {
            const skill = asRecord(skillValue);
            if (skill) entries.push(skill);
        }
    }
    return entries;
}

export async function listCodexVendorPlugins(params: Readonly<{
    client: Pick<CodexAppServerClient, 'request'>;
    cwd: string;
}>): Promise<Readonly<{
    supported: boolean;
    vendorPlugins: CodexVendorPluginCatalogEntry[];
    diagnostic?: string;
}>> {
    try {
        const response = await params.client.request('plugin/list', { cwds: [params.cwd] });
        const byVendorPluginRef = new Map<string, CodexVendorPluginCatalogEntry>();
        for (const entry of readPluginCatalogEntries(response)) {
            const plugin = normalizePlugin(entry);
            if (!plugin || byVendorPluginRef.has(plugin.vendorPluginRef)) continue;
            byVendorPluginRef.set(plugin.vendorPluginRef, plugin);
        }
        return { supported: true, vendorPlugins: [...byVendorPluginRef.values()] };
    } catch (error) {
        if (isCodexAppServerMethodNotFoundError(error)) {
            return {
                supported: false,
                vendorPlugins: [],
                diagnostic: error instanceof Error ? error.message : String(error),
            };
        }
        throw error;
    }
}

export async function listCodexAppServerSkills(params: Readonly<{
    client: Pick<CodexAppServerClient, 'request'>;
    cwd: string;
}>): Promise<Readonly<{
    supported: boolean;
    skills: CodexSkillCatalogEntry[];
    diagnostic?: string;
}>> {
    try {
        const response = await params.client.request('skills/list', { cwds: [params.cwd] });
        const byName = new Map<string, CodexSkillCatalogEntry>();
        for (const entry of readSkillCatalogEntries(response)) {
            const skill = normalizeSkill(entry);
            if (!skill) continue;
            const key = skill.name.toLowerCase();
            const existing = byName.get(key);
            if (!existing || (!existing.enabled && skill.enabled)) {
                byName.set(key, skill);
            }
        }
        return { supported: true, skills: [...byName.values()] };
    } catch (error) {
        if (isCodexAppServerMethodNotFoundError(error)) {
            return {
                supported: false,
                skills: [],
                diagnostic: error instanceof Error ? error.message : String(error),
            };
        }
        throw error;
    }
}
