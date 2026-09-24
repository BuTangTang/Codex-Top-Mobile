import { describe, expect, it } from 'vitest';

import { callEncryptedMachineRpc, type MemoryRpcSchema } from './memoryRpc';
import { encryptLegacyBase64 } from './messageCrypto';

const passthroughSchema: MemoryRpcSchema<unknown> = {
  safeParse: (input: unknown) => ({ success: true, data: input }),
};

describe('callEncryptedMachineRpc', () => {
  it('retries malformed non-error envelopes until a valid encrypted result arrives', async () => {
    let calls = 0;
    const secret = new Uint8Array(32).fill(7);
    const response = { ok: true, value: 'ready' };

    await expect(
      callEncryptedMachineRpc({
        ui: {
          rpcCall: async () => {
            calls += 1;
            if (calls === 1) {
              return { ok: true, result: 123 };
            }
            return {
              ok: true,
              result: encryptLegacyBase64(response, secret),
            };
          },
        },
        machineId: 'machine-1',
        method: 'memory.search',
        req: {},
        secret,
        schema: passthroughSchema,
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual(response);

    expect(calls).toBe(2);
  });

  it('fails fast when the machine RPC returns an explicit error envelope', async () => {
    let calls = 0;

    await expect(
      callEncryptedMachineRpc({
        ui: {
          rpcCall: async () => {
            calls += 1;
            return {
              ok: false,
              errorCode: 'memory_index_unavailable',
              error: 'index is disabled',
            };
          },
        },
        machineId: 'machine-1',
        method: 'memory.search',
        req: {},
        secret: new Uint8Array(32),
        schema: passthroughSchema,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/memory_index_unavailable.*index is disabled|index is disabled.*memory_index_unavailable/);

    expect(calls).toBe(1);
  });
});
