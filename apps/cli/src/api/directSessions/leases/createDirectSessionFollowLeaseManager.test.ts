import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDirectSessionFollowLeaseManager } from './createDirectSessionFollowLeaseManager';

describe('createDirectSessionFollowLeaseManager', () => {
  it('exposes an attached viewer observation only for its target and unexpired lifetime', async () => {
    let nowMs = 0;
    const manager = createDirectSessionFollowLeaseManager({ now: () => nowMs });
    const observation = { v: 1 as const, source: 'desktop' as const, turnId: 'current', state: 'running' as const };
    await manager.attach({ sessionId: 's', targetKey: 'target', ttlMs: 1000,
      acquireFollowLease: async () => ({ release: () => {}, getObservation: () => observation }) });
    expect(manager.getObservation({ sessionId: 's', targetKey: 'target' })).toEqual(observation);
    expect(manager.getObservation({ sessionId: 's', targetKey: 'other' })).toMatchObject({ state: 'unknown' });
    nowMs = 1001;
    expect(manager.getObservation({ sessionId: 's', targetKey: 'target' })).toMatchObject({ state: 'unknown' });
    await manager.dispose();
  });

  it.each(['detach', 'invalidate', 'dispose'] as const)('discards a viewer acquisition completing after %s', async (action) => {
    const manager = createDirectSessionFollowLeaseManager();
    let finish!: (lease: { release: () => void }) => void;
    const release = vi.fn();
    const attaching = manager.attach({ sessionId: 's', leaseId: 'viewer', ttlMs: 1000,
      acquireFollowLease: () => new Promise((resolve) => { finish = resolve; }) });
    if (action === 'detach') await manager.detach({ sessionId: 's', leaseId: 'viewer' });
    else if (action === 'invalidate') await manager.invalidateSession('s');
    else await manager.dispose();
    finish({ release });
    await attaching;
    expect(release).toHaveBeenCalledTimes(1);
    expect(manager.countActiveLeases('s')).toBe(0);
    await manager.dispose();
  });

  it('preserves a renewal received while the original acquisition is pending', async () => {
    let nowMs = 0;
    const manager = createDirectSessionFollowLeaseManager({ now: () => nowMs });
    let finish!: (lease: { release: () => void }) => void;
    const release = vi.fn();
    const acquire = vi.fn(() => new Promise<{ release: () => void }>((resolve) => { finish = resolve; }));
    const first = manager.attach({ sessionId: 's', leaseId: 'viewer', ttlMs: 1000, acquireFollowLease: acquire });
    nowMs = 500;
    await manager.attach({ sessionId: 's', leaseId: 'viewer', ttlMs: 2000, acquireFollowLease: acquire });
    finish({ release }); await first;
    nowMs = 1500;
    await vi.advanceTimersByTimeAsync(1000);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(manager.countActiveLeases('s')).toBe(1);
    await manager.dispose();
  });

  it('keeps background unknown authoritative and retains its observation after disabling notifications with a viewer', async () => {
    const manager = createDirectSessionFollowLeaseManager();
    const releaseViewer = vi.fn();
    const releaseBackground = vi.fn();
    const target = { sessionId: 's', targetKey: 'source' };
    await manager.attach({ ...target, leaseId: 'viewer', ttlMs: 1000, acquireFollowLease: async () => ({
      release: releaseViewer, getObservation: () => ({ v: 1, source: 'desktop', state: 'completed', turnId: 'old' }),
    }) });
    await manager.setBackgroundFollowEnabled({ ...target, enabled: true, acquireFollowLease: async () => ({
      release: releaseBackground, getObservation: () => ({ v: 1, state: 'unknown', reason: 'not_observed' }),
    }) });
    expect(releaseViewer).toHaveBeenCalledTimes(1);
    expect(manager.getObservation(target)).toMatchObject({ state: 'unknown' });
    await manager.setBackgroundFollowEnabled({ ...target, enabled: false });
    expect(releaseBackground).not.toHaveBeenCalled();
    expect(manager.getObservation(target)).toMatchObject({ state: 'unknown' });
    await manager.detach({ sessionId: 's', leaseId: 'viewer' });
    expect(releaseBackground).toHaveBeenCalledTimes(1);
    expect(manager.getObservation(target)).toMatchObject({ state: 'unknown' });
    await manager.dispose();
  });
  it('shares an in-flight background acquisition with a concurrent viewer expiry', async () => {
    let nowMs = 0;
    let resolveLease!: (lease: { release: () => void }) => void;
    const pending = new Promise<{ release: () => void }>((resolve) => { resolveLease = resolve; });
    const acquire = vi.fn(() => pending);
    const release = vi.fn();
    const manager = createDirectSessionFollowLeaseManager({ now: () => nowMs });
    await manager.attach({ sessionId: 's', ttlMs: 1 });
    const enabled = manager.setBackgroundFollowEnabled({ sessionId: 's', enabled: true, acquireFollowLease: acquire });
    nowMs = 2;
    await vi.advanceTimersByTimeAsync(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    resolveLease({ release });
    await enabled;
    await manager.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases an obsolete acquisition when a new generation enables the same session', async () => {
    let resolveOld!: (lease: { release: () => void }) => void;
    const oldRelease = vi.fn(); const currentRelease = vi.fn();
    const manager = createDirectSessionFollowLeaseManager();
    const old = manager.setBackgroundFollowEnabled({ sessionId: 's', enabled: true,
      acquireFollowLease: () => new Promise((resolve) => { resolveOld = resolve; }) });
    await manager.invalidateSession('s');
    await manager.setBackgroundFollowEnabled({ sessionId: 's', enabled: true,
      acquireFollowLease: async () => ({ release: currentRelease }) });
    resolveOld({ release: oldRelease });
    await old;
    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(manager.getBackgroundFollowLease('s')?.release).toBe(currentRelease);
    await manager.dispose();
    expect(currentRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps the same viewer and rejects a late old-generation acquisition after disabling and enabling again', async () => {
    const manager = createDirectSessionFollowLeaseManager();
    const target = { sessionId: 's', targetKey: 'source' };
    const oldRelease = vi.fn();
    const currentRelease = vi.fn();
    let finishOld!: (lease: { release: () => void }) => void;
    let entered!: () => void;
    const acquiring = new Promise<void>((resolve) => { entered = resolve; });
    await manager.attach({ ...target, leaseId: 'viewer', ttlMs: 1000 });
    const old = manager.setBackgroundFollowEnabled({ ...target, enabled: true, notificationGeneration: 'one',
      acquireFollowLease: () => new Promise((resolve) => { finishOld = resolve; entered(); }) });
    await acquiring;
    await manager.setBackgroundFollowEnabled({ ...target, enabled: false });
    await manager.setBackgroundFollowEnabled({ ...target, enabled: true, notificationGeneration: 'two',
      acquireFollowLease: async () => ({ release: currentRelease,
        getObservation: () => ({ v: 1, source: 'desktop', state: 'running', turnId: 'new' }) }) });
    finishOld({ release: oldRelease });
    await old;
    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(currentRelease).not.toHaveBeenCalled();
    expect(manager.getObservation(target)).toMatchObject({ state: 'running', turnId: 'new' });
    await expect(manager.attach({ ...target, leaseId: 'viewer', ttlMs: 1000 })).resolves.toMatchObject({ renewed: true });
    expect(manager.countActiveLeases('s')).toBe(1);
    await manager.dispose();
  });

  it('keeps background notification observation active while another device views the session and disposes it', async () => {
    const manager = createDirectSessionFollowLeaseManager();
    const viewerRelease = vi.fn(); const backgroundRelease = vi.fn();
    await manager.attach({ sessionId: 's', ttlMs: 1000, acquireFollowLease: async () => ({ release: viewerRelease }) });
    const acquire = vi.fn(async () => ({ release: backgroundRelease }));
    await manager.setBackgroundFollowEnabled({ sessionId: 's', enabled: true, acquireFollowLease: acquire });
    expect(manager.hasBackgroundFollowLease('s')).toBe(true);
    expect(viewerRelease).toHaveBeenCalledTimes(1);
    await manager.dispose();
    expect(backgroundRelease).toHaveBeenCalledTimes(1);
    expect(manager.countActiveLeases('s')).toBe(0);
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires one follow lease for a viewer lease, renews its expiry, and releases it on detach', async () => {
    let nowMs = 1_000;
    const release = vi.fn(async () => {});
    const acquireFollowLease = vi.fn(async () => ({ release }));

    const manager = createDirectSessionFollowLeaseManager({
      now: () => nowMs,
      randomId: () => 'lease-1',
    });

    const attached = await manager.attach({
      sessionId: 'session-1',
      ttlMs: 30_000,
      acquireFollowLease,
    });

    expect(attached).toEqual({
      leaseId: 'lease-1',
      expiresAtMs: 31_000,
      renewed: false,
    });
    expect(acquireFollowLease).toHaveBeenCalledTimes(1);

    nowMs = 10_000;
    const renewed = await manager.attach({
      sessionId: 'session-1',
      leaseId: 'lease-1',
      ttlMs: 30_000,
      acquireFollowLease,
    });

    expect(renewed).toEqual({
      leaseId: 'lease-1',
      expiresAtMs: 40_000,
      renewed: true,
    });
    expect(acquireFollowLease).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(release).not.toHaveBeenCalled();

    const detached = await manager.detach({
      sessionId: 'session-1',
      leaseId: 'lease-1',
    });

    expect(detached).toEqual({ detached: true });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases follow leases automatically when the viewer lease expires', async () => {
    let nowMs = 5_000;
    const release = vi.fn(async () => {});
    const manager = createDirectSessionFollowLeaseManager({
      now: () => nowMs,
      randomId: () => 'lease-expiring',
    });

    await manager.attach({
      sessionId: 'session-expiring',
      ttlMs: 2_000,
      acquireFollowLease: async () => ({ release }),
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(release).not.toHaveBeenCalled();

    nowMs = 7_100;
    await vi.advanceTimersByTimeAsync(1);

    expect(release).toHaveBeenCalledTimes(1);
    expect(manager.countActiveLeases('session-expiring')).toBe(0);
  });

  it('replaces viewer observation with background observation until disabled', async () => {
    let nowMs = 1_000;
    const attachedRelease = vi.fn(async () => {});
    const backgroundRelease = vi.fn(async () => {});
    const acquireAttachedFollowLease = vi.fn(async () => ({ release: attachedRelease }));
    const acquireBackgroundFollowLease = vi.fn(async () => ({ release: backgroundRelease }));
    const manager = createDirectSessionFollowLeaseManager({
      now: () => nowMs,
      randomId: () => 'lease-background',
    });

    await manager.attach({
      sessionId: 'session-background',
      ttlMs: 30_000,
      acquireFollowLease: acquireAttachedFollowLease,
    });
    expect(acquireAttachedFollowLease).toHaveBeenCalledTimes(1);

    const backgroundFollow = await manager.setBackgroundFollowEnabled({
      sessionId: 'session-background',
      enabled: true,
      acquireFollowLease: acquireBackgroundFollowLease,
    });

    expect(backgroundFollow).toEqual(expect.objectContaining({ enabled: true, leaseAcquired: true }));
    expect(acquireBackgroundFollowLease).toHaveBeenCalledTimes(1);

    const detached = await manager.detach({
      sessionId: 'session-background',
      leaseId: 'lease-background',
    });

    expect(detached).toEqual({ detached: true });
    expect(attachedRelease).toHaveBeenCalledTimes(1);
    expect(acquireBackgroundFollowLease).toHaveBeenCalledTimes(1);
    expect(backgroundRelease).toHaveBeenCalledTimes(0);
    expect(manager.countActiveLeases('session-background')).toBe(0);
    expect(manager.hasBackgroundFollowLease('session-background')).toBe(true);

    const disabled = await manager.setBackgroundFollowEnabled({
      sessionId: 'session-background',
      enabled: false,
    });

    expect(disabled).toEqual({ enabled: false, leaseAcquired: false });
    expect(backgroundRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps the shared background follow when the viewer lease expires', async () => {
    let nowMs = 1_000;
    const attachedRelease = vi.fn(async () => {});
    const backgroundRelease = vi.fn(async () => {});
    const acquireAttachedFollowLease = vi.fn(async () => ({ release: attachedRelease }));
    const acquireBackgroundFollowLease = vi.fn(async () => ({ release: backgroundRelease }));
    const manager = createDirectSessionFollowLeaseManager({
      now: () => nowMs,
      randomId: () => 'lease-expiry-background',
    });

    await manager.attach({
      sessionId: 'session-expiry-background',
      ttlMs: 2_000,
      acquireFollowLease: acquireAttachedFollowLease,
    });
    await manager.setBackgroundFollowEnabled({
      sessionId: 'session-expiry-background',
      enabled: true,
      acquireFollowLease: acquireBackgroundFollowLease,
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(attachedRelease).toHaveBeenCalledTimes(1);
    expect(acquireBackgroundFollowLease).toHaveBeenCalledTimes(1);

    nowMs = 3_100;
    await vi.advanceTimersByTimeAsync(1);

    expect(attachedRelease).toHaveBeenCalledTimes(1);
    expect(acquireBackgroundFollowLease).toHaveBeenCalledTimes(1);
    expect(manager.countActiveLeases('session-expiry-background')).toBe(0);
    expect(manager.hasBackgroundFollowLease('session-expiry-background')).toBe(true);

    await manager.setBackgroundFollowEnabled({
      sessionId: 'session-expiry-background',
      enabled: false,
    });
    expect(backgroundRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps a shared background follow lease alive until the last attached viewer detaches', async () => {
    const viewerRelease = vi.fn(async () => {});
    const backgroundRelease = vi.fn(async () => {});
    const acquireViewerFollowLease = vi.fn(async () => ({ release: viewerRelease }));
    const acquireBackgroundFollowLease = vi.fn(async () => ({ release: backgroundRelease }));
    const manager = createDirectSessionFollowLeaseManager({
      randomId: () => 'lease-shared-background',
    });

    const enabled = await manager.setBackgroundFollowEnabled({
      sessionId: 'session-shared-background',
      enabled: true,
      acquireFollowLease: acquireBackgroundFollowLease,
    });
    expect(enabled).toEqual(expect.objectContaining({ enabled: true, leaseAcquired: true }));
    expect(manager.hasBackgroundFollowLease('session-shared-background')).toBe(true);

    await manager.attach({
      sessionId: 'session-shared-background',
      ttlMs: 30_000,
      acquireFollowLease: acquireViewerFollowLease,
    });

    expect(acquireViewerFollowLease).not.toHaveBeenCalled();
    expect(manager.countActiveLeases('session-shared-background')).toBe(1);

    const disabled = await manager.setBackgroundFollowEnabled({
      sessionId: 'session-shared-background',
      enabled: false,
    });
    expect(disabled).toEqual({ enabled: false, leaseAcquired: false });
    expect(backgroundRelease).not.toHaveBeenCalled();

    await manager.detach({
      sessionId: 'session-shared-background',
      leaseId: 'lease-shared-background',
    });

    expect(backgroundRelease).toHaveBeenCalledTimes(1);
    expect(viewerRelease).not.toHaveBeenCalled();
  });
});
