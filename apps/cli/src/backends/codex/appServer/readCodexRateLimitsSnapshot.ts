export type CodexRateLimitsReadClient = Readonly<{
  request: (method: 'account/rateLimits/read', params: null | Record<string, never>) => Promise<unknown>;
}>;

export async function readCodexRateLimitsSnapshot(
  client: CodexRateLimitsReadClient,
): Promise<unknown> {
  try {
    return await client.request('account/rateLimits/read', null);
  } catch (firstError) {
    try {
      return await client.request('account/rateLimits/read', {});
    } catch {
      throw firstError;
    }
  }
}
