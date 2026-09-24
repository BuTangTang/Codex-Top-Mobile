import { z } from 'zod';

export const AccountSettingsPersistedObjectSchema = z.object({}).passthrough();

export type AccountSettingsPersistedObject = z.infer<typeof AccountSettingsPersistedObjectSchema>;
