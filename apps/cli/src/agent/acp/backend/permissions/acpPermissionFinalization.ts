export type AcpPendingPermissionAbortHandler = Readonly<{
  abortPendingRequestsAndFlush?: (reason: string) => Promise<void>;
}>;

export async function abortPendingAcpPermissionRequests(
  permissionHandler: AcpPendingPermissionAbortHandler | null | undefined,
  reason: string,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await permissionHandler?.abortPendingRequestsAndFlush?.(reason);
  } catch (error) {
    onError?.(error);
  }
}
