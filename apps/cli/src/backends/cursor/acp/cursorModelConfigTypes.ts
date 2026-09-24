import type { SessionConfigOption } from '@/agent/acp/AcpBackend';

export type CursorSessionModelConfigUpdate = Readonly<{
  modelId: string;
  configUpdates?: ReadonlyArray<Readonly<{
    configId: string;
    value: string | number | boolean | null;
  }>>;
}> | null;

export type CursorSessionConfigOptionUpdate =
  | Readonly<{ configId: string; value: string | number | boolean | null }>
  | Readonly<{ modelId: string }>
  | null;

export type CursorSessionModelsFromConfigOptions = Readonly<{
  currentModelId: string;
  availableModels: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    description?: string;
    modelOptions?: ReadonlyArray<Readonly<{
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: string;
      currentValue: string | number | boolean | null;
      options?: ReadonlyArray<Readonly<{
        value: string | number | boolean | null;
        name: string;
        description?: string;
      }>>;
    }>>;
  }>>;
}>;

export type CursorSessionModesFromConfigOptions = Readonly<{
  currentModeId: string;
  availableModes: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    description?: string;
  }>>;
}>;

export type SessionConfigOptionValue = NonNullable<SessionConfigOption['options']>[number]['value'];
