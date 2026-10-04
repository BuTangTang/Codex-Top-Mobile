/** 机器注册外围使用原 owner 的实时槽、身份发布和初始化闭包，不复制连接或账号状态。 */
export type MachineBootstrapOptions<TRegistered> = Readonly<{
  getPreflightRegistration: () => TRegistered | null;
  clearPreflightRegistration: () => void;
  isShuttingDown: () => boolean;
  ensureRegistered: () => Promise<TRegistered>;
  publishRegisteredIdentity: (registered: TRegistered) => boolean;
  attachMachine: (registered: TRegistered) => Promise<void>;
  retry: Readonly<{
    maxAttempts: number;
    shouldRetry: (error: unknown) => boolean;
    delayForAttempt: (attempt: number) => number;
    wait: (delayMs: number) => Promise<'elapsed' | 'shutdown'>;
    reportRejected: (error: unknown) => void;
    reportExhausted: (attempt: number) => void;
    reportRetry: (error: unknown, attempt: number, retryDelayMs: number) => void;
  }>;
}>;

/** 沿用注册与初始化的共同重试边界；关闭、锁和诊断仍由原生命周期 owner 决定。 */
export async function runMachineBootstrap<TRegistered>(options: MachineBootstrapOptions<TRegistered>): Promise<void> {
  let attempts = 0;
  while (!options.isShuttingDown()) {
    try {
      const registered = options.getPreflightRegistration() ?? await options.ensureRegistered();
      options.clearPreflightRegistration();
      if (options.isShuttingDown()) return;
      if (!options.publishRegisteredIdentity(registered)) return;
      await options.attachMachine(registered);
      return;
    } catch (error) {
      if (!options.retry.shouldRetry(error)) {
        options.retry.reportRejected(error);
        return;
      }

      attempts += 1;
      if (options.retry.maxAttempts > 0 && attempts >= options.retry.maxAttempts) {
        options.retry.reportExhausted(attempts);
        return;
      }

      const retryDelayMs = options.retry.delayForAttempt(attempts);
      options.retry.reportRetry(error, attempts, retryDelayMs);
      if (options.isShuttingDown()) return;
      const sleepResult = await options.retry.wait(retryDelayMs);
      if (sleepResult === 'shutdown') return;
    }
  }
}
