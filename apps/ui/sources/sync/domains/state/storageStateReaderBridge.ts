import type { StorageState } from '@/sync/store/types';

type StorageStateReader = () => StorageState;

let storageStateReader: StorageStateReader | null = null;

export function registerStorageStateReader(reader: StorageStateReader): void {
    storageStateReader = reader;
}

export function readRegisteredStorageState(): StorageState | null {
    return storageStateReader ? storageStateReader() : null;
}
