import { createServerUrlComparableKey } from '@happier-dev/protocol';
import { readSettings } from '@/persistence';

/** 产品模式在原凭据目录保留单一来源归属；普通 CLI 保持原有行为。 */
export async function isProductAccountBindingValid(input: { accountId: string; serverUrl: string }): Promise<boolean> {
  if (process.env.HAPPIER_PRODUCT_MODE !== 'codextop') return true;
  const binding = (await readSettings()).passwordAccountBinding;
  return Boolean(binding && binding.accountId === input.accountId && binding.serverKey === createServerUrlComparableKey(input.serverUrl));
}
