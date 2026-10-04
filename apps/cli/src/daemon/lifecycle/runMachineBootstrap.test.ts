import { describe, expect, it, vi } from 'vitest';

import { runMachineBootstrap, type MachineBootstrapOptions } from './runMachineBootstrap';

type Registration = Readonly<{ machineId: string }>;

/** 构造受测试控制的接口等待，不启动计时器、网络或 daemon。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** 用合成注册/持久化边界观察真正的外围函数，能力初始化不产生外部副作用。 */
function createHarness() {
  const state: { preflight: Registration | null; shuttingDown: boolean; ownsLock: boolean } = {
    preflight: null, shuttingDown: false, ownsLock: true,
  };
  const events: string[] = [];
  const ensureRegistered = vi.fn<() => Promise<Registration>>(async () => ({ machineId: 'registered' }));
  const clearPreflightRegistration = vi.fn(() => { state.preflight = null; events.push('clear-preflight'); });
  const publishRegisteredIdentity = vi.fn((registered: Registration) => {
    events.push(`publish:${registered.machineId}`);
    return state.ownsLock;
  });
  const attachMachine = vi.fn(async (registered: Registration) => { events.push(`attach:${registered.machineId}`); });
  const shouldRetry = vi.fn((_error: unknown) => true);
  const delayForAttempt = vi.fn((attempt: number) => attempt * 10);
  const wait = vi.fn<(delayMs: number) => Promise<'elapsed' | 'shutdown'>>(async () => 'elapsed');
  const reportRejected = vi.fn((_error: unknown) => {});
  const reportExhausted = vi.fn((_attempt: number) => {});
  const reportRetry = vi.fn((_error: unknown, _attempt: number, _retryDelayMs: number) => {});
  const options: MachineBootstrapOptions<Registration> = {
    getPreflightRegistration: () => state.preflight,
    clearPreflightRegistration,
    isShuttingDown: () => state.shuttingDown,
    ensureRegistered, publishRegisteredIdentity, attachMachine,
    retry: { maxAttempts: 3, shouldRetry, delayForAttempt, wait, reportRejected, reportExhausted, reportRetry },
  };
  return { options, state, events, ensureRegistered, clearPreflightRegistration, publishRegisteredIdentity,
    attachMachine, shouldRetry, delayForAttempt, wait, reportRejected, reportExhausted, reportRetry };
}

describe('runMachineBootstrap', () => {
  it('consumes the existing preflight slot before publishing and begins attaching without waiting for a new registration', async () => {
    const h = createHarness();
    const preflight = { machineId: 'preflight' };
    const attached = deferred<void>();
    h.state.preflight = preflight;
    h.attachMachine.mockImplementation(async () => { await attached.promise; });
    const running = runMachineBootstrap(h.options);
    expect(h.state.preflight).toBeNull();
    expect(h.ensureRegistered).not.toHaveBeenCalled();
    expect(h.publishRegisteredIdentity).toHaveBeenCalledWith(preflight);
    expect(h.attachMachine).toHaveBeenCalledWith(preflight);
    expect(h.events).toEqual(['clear-preflight', 'publish:preflight']);
    attached.resolve();
    await running;
  });

  it('does no registration or preflight consumption if shutdown has already begun', async () => {
    const h = createHarness();
    h.state.preflight = { machineId: 'preflight' };
    h.state.shuttingDown = true;
    await runMachineBootstrap(h.options);
    expect(h.state.preflight).toEqual({ machineId: 'preflight' });
    expect(h.clearPreflightRegistration).not.toHaveBeenCalled();
    expect(h.ensureRegistered).not.toHaveBeenCalled();
    expect(h.attachMachine).not.toHaveBeenCalled();
  });

  it('consumes a completed attempt but never publishes a registration that arrives after shutdown', async () => {
    const h = createHarness();
    const registration = deferred<Registration>();
    h.ensureRegistered.mockReturnValue(registration.promise);
    const running = runMachineBootstrap(h.options);
    h.state.shuttingDown = true;
    registration.resolve({ machineId: 'late' });
    await running;
    expect(h.clearPreflightRegistration).toHaveBeenCalledTimes(1);
    expect(h.publishRegisteredIdentity).not.toHaveBeenCalled();
    expect(h.attachMachine).not.toHaveBeenCalled();
    expect(h.wait).not.toHaveBeenCalled();
  });

  it('does not attach or retry when the lock owner refuses identity publication', async () => {
    const h = createHarness();
    h.state.ownsLock = false;
    await runMachineBootstrap(h.options);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
    expect(h.publishRegisteredIdentity).toHaveBeenCalledTimes(1);
    expect(h.attachMachine).not.toHaveBeenCalled();
    expect(h.shouldRetry).not.toHaveBeenCalled();
  });

  it('retries transient registration failures with the original increasing attempt numbers and supplied delays', async () => {
    const h = createHarness();
    const first = new Error('first transient');
    const second = new Error('second transient');
    h.ensureRegistered.mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    await runMachineBootstrap(h.options);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(3);
    expect(h.clearPreflightRegistration).toHaveBeenCalledTimes(1);
    expect(h.wait.mock.calls).toEqual([[10], [20]]);
    expect(h.reportRetry.mock.calls).toEqual([[first, 1, 10], [second, 2, 20]]);
    expect(h.attachMachine).toHaveBeenCalledTimes(1);
  });

  it('stops at the configured maximum without scheduling another delay', async () => {
    const h = createHarness();
    const error = new Error('transient');
    h.ensureRegistered.mockRejectedValue(error);
    await runMachineBootstrap({ ...h.options, retry: { ...h.options.retry, maxAttempts: 2 } });
    expect(h.ensureRegistered).toHaveBeenCalledTimes(2);
    expect(h.wait.mock.calls).toEqual([[10]]);
    expect(h.reportExhausted).toHaveBeenCalledWith(2);
    expect(h.clearPreflightRegistration).not.toHaveBeenCalled();
    expect(h.attachMachine).not.toHaveBeenCalled();
  });

  it('keeps zero maximum attempts unlimited until the existing shutdown or success boundary', async () => {
    const h = createHarness();
    h.ensureRegistered.mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two'))
      .mockRejectedValueOnce(new Error('three'));
    await runMachineBootstrap({ ...h.options, retry: { ...h.options.retry, maxAttempts: 0 } });
    expect(h.ensureRegistered).toHaveBeenCalledTimes(4);
    expect(h.wait.mock.calls).toEqual([[10], [20], [30]]);
    expect(h.reportExhausted).not.toHaveBeenCalled();
  });

  it('reports a non-retryable failure through the existing diagnostic owner without another attempt', async () => {
    const h = createHarness();
    const rejection = new Error('synthetic credential rejection');
    h.ensureRegistered.mockRejectedValue(rejection);
    h.shouldRetry.mockReturnValue(false);
    await runMachineBootstrap(h.options);
    expect(h.reportRejected).toHaveBeenCalledWith(rejection);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
    expect(h.reportRetry).not.toHaveBeenCalled();
    expect(h.wait).not.toHaveBeenCalled();
  });

  it('retains the original report-before-shutdown-check ordering without starting a delay', async () => {
    const h = createHarness();
    h.ensureRegistered.mockRejectedValueOnce(new Error('transient'));
    h.reportRetry.mockImplementation(() => { h.state.shuttingDown = true; });
    await runMachineBootstrap(h.options);
    expect(h.reportRetry).toHaveBeenCalledTimes(1);
    expect(h.wait).not.toHaveBeenCalled();
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
  });

  it('ends when the existing retry wait observes shutdown', async () => {
    const h = createHarness();
    h.ensureRegistered.mockRejectedValueOnce(new Error('transient'));
    h.wait.mockResolvedValue('shutdown');
    await runMachineBootstrap(h.options);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
    expect(h.wait).toHaveBeenCalledWith(10);
  });

  it('does not reuse a consumed preflight after an initialization failure and retains the same retry policy', async () => {
    const h = createHarness();
    const preflight = { machineId: 'preflight' };
    const failure = new Error('initialization transient');
    h.state.preflight = preflight;
    h.attachMachine.mockRejectedValueOnce(failure);
    await runMachineBootstrap(h.options);
    expect(h.attachMachine.mock.calls).toEqual([[preflight], [{ machineId: 'registered' }]]);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
    expect(h.state.preflight).toBeNull();
    expect(h.reportRetry).toHaveBeenCalledWith(failure, 1, 10);
  });

  it('keeps publication exceptions within the original registration retry boundary', async () => {
    const h = createHarness();
    const failure = new Error('synthetic persistence failure');
    h.publishRegisteredIdentity.mockImplementationOnce(() => { throw failure; });
    await runMachineBootstrap(h.options);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(2);
    expect(h.attachMachine).toHaveBeenCalledTimes(1);
    expect(h.reportRetry).toHaveBeenCalledWith(failure, 1, 10);
  });

  it('does not swallow an exception thrown by the original retry diagnostic owner', async () => {
    const h = createHarness();
    const diagnosticFailure = new Error('synthetic diagnostic failure');
    h.ensureRegistered.mockRejectedValueOnce(new Error('transient'));
    h.reportRetry.mockImplementation(() => { throw diagnosticFailure; });
    await expect(runMachineBootstrap(h.options)).rejects.toBe(diagnosticFailure);
    expect(h.ensureRegistered).toHaveBeenCalledTimes(1);
    expect(h.wait).not.toHaveBeenCalled();
  });
});
