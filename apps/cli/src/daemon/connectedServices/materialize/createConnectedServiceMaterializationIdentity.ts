import { randomBytes as nodeRandomBytes } from 'node:crypto';

import {
  buildConnectedServiceMaterializationIdentityV1,
  ConnectedServiceMaterializationIdentityV1Schema,
  type ConnectedServiceMaterializationIdentityV1,
} from '@happier-dev/protocol';

export function readConnectedServiceMaterializationIdentityV1(
  value: unknown,
): ConnectedServiceMaterializationIdentityV1 | null {
  const parsed = ConnectedServiceMaterializationIdentityV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createConnectedServiceMaterializationIdentity(params: Readonly<{
  nowMs?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}> = {}): ConnectedServiceMaterializationIdentityV1 {
  const bytes = params.randomBytes?.(16) ?? nodeRandomBytes(16);
  return buildConnectedServiceMaterializationIdentityV1({
    id: `csm_${Buffer.from(bytes).toString('hex')}`,
    createdAtMs: Math.trunc(params.nowMs?.() ?? Date.now()),
  });
}
