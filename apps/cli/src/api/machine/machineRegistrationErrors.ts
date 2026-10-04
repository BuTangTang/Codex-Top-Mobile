/** 机器注册错误的唯一无依赖 owner；公共 API 再导出相同构造器和判断函数。 */

export class MachineIdConflictError extends Error {
  readonly machineId: string;
  /** 保留原机器标识与错误信息，供注册恢复和公共 API 共用。 */
  constructor(machineId: string) {
    super(`Machine id conflict: ${machineId} is already registered to a different account on this relay`);
    this.name = 'MachineIdConflictError';
    this.machineId = machineId;
  }
}

export class MachineRevokedError extends Error {
  readonly machineId: string;
  /** 保留原机器标识与错误信息，供注册恢复和公共 API 共用。 */
  constructor(machineId: string) {
    super(`Machine revoked: ${machineId} is no longer valid on this relay and must be rotated`);
    this.name = 'MachineRevokedError';
    this.machineId = machineId;
  }
}

export class MachineReplacedError extends Error {
  readonly machineId: string;
  readonly replacementMachineId: string | null;
  /** 只按原规则规范化替代标识，缺失时继续保留 null。 */
  constructor(machineId: string, replacementMachineId?: string | null) {
    const replacement = typeof replacementMachineId === 'string' && replacementMachineId.trim()
      ? replacementMachineId.trim()
      : null;
    super(
      replacement
        ? `Machine replaced: ${machineId} was replaced by ${replacement}`
        : `Machine replaced: ${machineId} is no longer the current machine identity on this relay`,
    );
    this.name = 'MachineReplacedError';
    this.machineId = machineId;
    this.replacementMachineId = replacement;
  }
}

export class MachineContentPublicKeyMismatchError extends Error {
  readonly machineId: string;
  readonly reason: string;
  /** 保留服务端拒绝原因，防止凭据不匹配进入机器轮换重试。 */
  constructor(machineId: string, reason: string) {
    super(
      `Machine registration rejected by server (reason=${reason}). ` +
        'This usually means your local encryption key does not match your current account credentials. ' +
        'Try `happier auth logout` then `happier auth login`.',
    );
    this.name = 'MachineContentPublicKeyMismatchError';
    this.machineId = machineId;
    this.reason = reason;
  }
}

/** 按原结构证据识别错误，兼容不同 bundle 实例而不收紧字段条件。 */
export function isMachineIdConflictError(error: unknown): error is MachineIdConflictError {
  // Avoid relying on `instanceof`: bundlers / test runners may load multiple module instances.
  if (!error || typeof error !== 'object') return false;
  const maybe = error as Record<string, unknown>;
  return maybe.name === 'MachineIdConflictError' && typeof maybe.machineId === 'string' && maybe.machineId.length > 0;
}

/** 按原结构证据识别错误，兼容不同 bundle 实例而不收紧字段条件。 */
export function isMachineRevokedError(error: unknown): error is MachineRevokedError {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as Record<string, unknown>;
  return maybe.name === 'MachineRevokedError' && typeof maybe.machineId === 'string' && maybe.machineId.length > 0;
}

/** 按原结构证据识别错误，兼容不同 bundle 实例而不收紧字段条件。 */
export function isMachineReplacedError(error: unknown): error is MachineReplacedError {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as Record<string, unknown>;
  return (
    maybe.name === 'MachineReplacedError'
    && typeof maybe.machineId === 'string'
    && maybe.machineId.length > 0
    && (
      maybe.replacementMachineId === null
      || typeof maybe.replacementMachineId === 'string'
      || maybe.replacementMachineId === undefined
    )
  );
}

/** 按原结构证据识别错误，兼容不同 bundle 实例而不收紧字段条件。 */
export function isMachineContentPublicKeyMismatchError(error: unknown): error is MachineContentPublicKeyMismatchError {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as Record<string, unknown>;
  return (
    maybe.name === 'MachineContentPublicKeyMismatchError'
    && typeof maybe.machineId === 'string'
    && maybe.machineId.length > 0
    && typeof maybe.reason === 'string'
    && maybe.reason.length > 0
  );
}

