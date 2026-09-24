import { describe, expect, it, vi } from 'vitest';

import { ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandler, RpcHandlerRegistrar } from '../rpc/types';

function parseResult(value: unknown) {
  return ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema.parse(value);
}

describe('registerMachineConnectedServiceQuotaRpcHandlers', () => {
  it('dispatches recovery-credit consume requests to the daemon control path', async () => {
    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    const consumeConnectedServiceQuotaRecoveryCredit = vi.fn(async () => ({
      ok: true,
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: 1_000,
        staleAfterMs: 300_000,
        planLabel: 'Plus',
        accountLabel: 'work@example.com',
        source: 'provider_api',
        confidence: 'exact',
        evidence: { kind: 'provider_api', observedAtMs: 1_000 },
        meters: [],
      },
      receipt: {
        idempotencyKey: 'reset-req-1',
        providerCreditId: 'credit-1',
        status: 'consumed',
      },
    }));
    const { registerMachineConnectedServiceQuotaRpcHandlers } = await import('./rpcHandlers.connectedServiceQuotas');

    registerMachineConnectedServiceQuotaRpcHandlers({
      rpcHandlerManager: {
        registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
          handlers.set(method, async (raw: unknown) => await handler(raw as TRequest));
        },
      } satisfies RpcHandlerRegistrar,
      deps: {
        consumeConnectedServiceQuotaRecoveryCredit,
      },
    });

    const result = parseResult(await handlers.get(RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_RECOVERY_CREDIT_CONSUME)?.({
      serviceId: 'openai-codex',
      profileId: ' work ',
      idempotencyKey: ' reset-req-1 ',
      providerCreditId: ' credit-1 ',
    }));

    expect(consumeConnectedServiceQuotaRecoveryCredit).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      idempotencyKey: 'reset-req-1',
      providerCreditId: 'credit-1',
    });
    expect(result).toEqual({
      ok: true,
      snapshot: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'work',
      }),
      receipt: {
        idempotencyKey: 'reset-req-1',
        providerCreditId: 'credit-1',
        status: 'consumed',
      },
    });
  });

  it('returns schema-valid errors for invalid requests', async () => {
    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    const { registerMachineConnectedServiceQuotaRpcHandlers } = await import('./rpcHandlers.connectedServiceQuotas');

    registerMachineConnectedServiceQuotaRpcHandlers({
      rpcHandlerManager: {
        registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
          handlers.set(method, async (raw: unknown) => await handler(raw as TRequest));
        },
      } satisfies RpcHandlerRegistrar,
    });

    expect(parseResult(await handlers.get(RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_RECOVERY_CREDIT_CONSUME)?.({
      serviceId: 'openai-codex',
      profileId: '',
    }))).toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });
  });
});
