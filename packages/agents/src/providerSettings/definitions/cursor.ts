import { z } from 'zod';
import { buildSettingArtifacts, type SettingDefinitionMap } from '@happier-dev/protocol';

import type { ProviderSettingsDefinition } from '../types.js';

export function normalizeCursorBinaryPath(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function normalizeCursorAgentFallbackEnabled(raw: unknown): boolean {
  if (raw === false) return false;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '0' || value === 'false' || value === 'no') return false;
  return true;
}

export function normalizeCursorApiEndpoint(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function resolveCursorSpawnExtrasFromSettings(settings: Readonly<Record<string, unknown>>): Readonly<{
  cursorBinaryPath?: string;
  cursorAgentFallbackEnabled?: boolean;
  cursorApiEndpoint?: string;
}> {
  const cursorBinaryPath = normalizeCursorBinaryPath(settings.cursorBinaryPath);
  const cursorAgentFallbackEnabled = normalizeCursorAgentFallbackEnabled(settings.cursorAgentFallbackEnabled);
  const cursorApiEndpoint = normalizeCursorApiEndpoint(settings.cursorApiEndpoint);
  return {
    ...(cursorBinaryPath ? { cursorBinaryPath } : {}),
    ...(cursorAgentFallbackEnabled === false ? { cursorAgentFallbackEnabled } : {}),
    ...(cursorApiEndpoint ? { cursorApiEndpoint } : {}),
  };
}

export const CURSOR_PROVIDER_FIELDS = {
  cursorBinaryPath: {
    schema: z.string(),
    default: '',
    description: 'Optional machine-local override for the Cursor Agent CLI binary path',
    storageScope: 'local',
    analytics: {
      trackCurrentState: true,
      trackChanges: true,
      valueKind: 'presence',
      privacy: 'presence_only',
      identityScope: 'device_user',
      serializeCurrent: (value: string) => normalizeCursorBinaryPath(value).length > 0,
    },
  },
  cursorAgentFallbackEnabled: {
    schema: z.boolean(),
    default: true,
    description: 'Allow falling back to the generic agent command when cursor-agent is unavailable',
    storageScope: 'local',
    analytics: {
      trackCurrentState: true,
      trackChanges: true,
      valueKind: 'boolean',
      privacy: 'safe',
      identityScope: 'device_user',
    },
  },
  cursorApiEndpoint: {
    schema: z.string(),
    default: '',
    description: 'Optional Cursor Agent API endpoint override passed to the Cursor CLI',
    storageScope: 'local',
    analytics: {
      trackCurrentState: true,
      trackChanges: true,
      valueKind: 'presence',
      privacy: 'presence_only',
      identityScope: 'device_user',
      serializeCurrent: (value: string) => normalizeCursorApiEndpoint(value).length > 0,
    },
  },
} as const satisfies SettingDefinitionMap;

const CURSOR_PROVIDER_ARTIFACTS = buildSettingArtifacts(CURSOR_PROVIDER_FIELDS);

export const CURSOR_PROVIDER_SETTINGS_DEFAULTS = Object.freeze(CURSOR_PROVIDER_ARTIFACTS.defaults);

export function buildCursorProviderSettingsShape(_zod: typeof z) {
  return CURSOR_PROVIDER_ARTIFACTS.shape;
}

export const CURSOR_PROVIDER_SETTINGS_DEFINITION: ProviderSettingsDefinition = Object.freeze({
  providerId: 'cursor',
  fields: CURSOR_PROVIDER_ARTIFACTS.definitions,
  buildOutgoingMessageMetaExtras: () => ({}),
  resolveSpawnExtras: ({ settings }) => resolveCursorSpawnExtrasFromSettings(settings),
});
