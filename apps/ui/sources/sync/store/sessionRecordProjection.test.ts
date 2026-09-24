import { describe, expect, it, vi } from 'vitest';

import {
    forEachRecordValue,
    forEachRecordValueById,
} from './sessionRecordProjection';

function expectNoObjectValuesOnRecord(action: () => void, guardedRecord: object): void {
    const originalObjectValues = Object.values.bind(Object);
    const valuesSpy = vi.spyOn(Object, 'values').mockImplementation(((value: object) => {
        if (value === guardedRecord) {
            throw new Error('projector materialized a guarded record with Object.values');
        }
        return originalObjectValues(value);
    }) as typeof Object.values);

    try {
        expect(action).not.toThrow();
    } finally {
        valuesSpy.mockRestore();
    }
}

function expectNoObjectKeysOnRecord(action: () => void, guardedRecord: object): void {
    const originalObjectKeys = Object.keys.bind(Object);
    const keysSpy = vi.spyOn(Object, 'keys').mockImplementation(((value: object) => {
        if (value === guardedRecord) {
            throw new Error('projector materialized guarded record keys with Object.keys');
        }
        return originalObjectKeys(value);
    }) as typeof Object.keys);

    try {
        expect(action).not.toThrow();
    } finally {
        keysSpy.mockRestore();
    }
}

describe('sessionRecordProjection', () => {
    it('visits record values without Object.values or full-array projection', () => {
        const record = {
            session1: { id: 'session1' },
            session2: { id: 'session2' },
        };
        const values: Array<{ id: string }> = [];

        expectNoObjectValuesOnRecord(() => {
            expectNoObjectKeysOnRecord(() => {
                forEachRecordValue(record, (value) => {
                    values.push(value);
                });
            }, record);
        }, record);

        expect(values).toEqual([
            record.session1,
            record.session2,
        ]);
    });

    it('visits only requested record ids', () => {
        const record = {
            session1: { id: 'session1' },
            session2: { id: 'session2' },
        };
        const visited: Array<{ id: string }> = [];

        forEachRecordValueById(record, ['missing', 'session2'], (value) => {
            visited.push(value);
        });

        expect(visited).toEqual([
            record.session2,
        ]);
    });
});
