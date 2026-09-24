export function isAllowedExactEnvKey(
  key: string,
  allowExact: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (allowExact.has(key)) return true;
  if (platform !== 'win32') return false;

  const normalizedKey = key.toLowerCase();
  for (const allowedKey of allowExact) {
    if (allowedKey.toLowerCase() === normalizedKey) return true;
  }
  return false;
}
