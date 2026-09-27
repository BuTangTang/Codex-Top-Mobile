import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createPollingDirectSessionFollowLease } from './createPollingDirectSessionFollowLease';
import { logger } from '@/ui/logger';

describe('createPollingDirectSessionFollowLease', () => {
  it('joins an immediate poll through read and acknowledgement without racing the scheduled poll', async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    let finishRead!: (value: { items: []; nextCursor: string; truncated: false }) => void;
    const reading = new Promise<{ items: []; nextCursor: string; truncated: false }>((resolve) => { finishRead = resolve; });
    const readAfterTranscript = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-0', truncated: false })
      .mockReturnValueOnce(reading)
      .mockResolvedValue({ items: [], nextCursor: 'cursor-1', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0',
      env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '250' } });
    onTestFinished(() => lease.release());
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve; });
    const listener = vi.fn(() => acknowledgement);
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.advanceTimersByTimeAsync(0);

    const immediate = lease.pollNow();
    const joining = lease.pollNow();
    await vi.advanceTimersByTimeAsync(250);
    expect(readAfterTranscript).toHaveBeenCalledTimes(2);
    finishRead({ items: [], nextCursor: 'cursor-1', truncated: false });
    let settled = false;
    void joining.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(250);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(lease.getTailCursor?.()).toBe('cursor-0');
    expect(readAfterTranscript).toHaveBeenCalledTimes(2);
    acknowledge();
    await Promise.all([immediate, joining]);
    expect(lease.getTailCursor?.()).toBe('cursor-1');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(readAfterTranscript).toHaveBeenCalledTimes(3);
  });

  it('retries the pending batch on immediate poll without rereading or committing before acknowledgement', async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const readAfterTranscript = vi.fn().mockResolvedValue({ items: [{ id: 'once', createdAtMs: 1, raw: {} }],
      nextCursor: 'cursor-1', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0' });
    onTestFinished(() => lease.release());
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve; });
    const listener = vi.fn().mockRejectedValueOnce(new Error('checkpoint failed')).mockImplementation(() => acknowledgement);
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.advanceTimersByTimeAsync(0);
    const retry = lease.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toEqual(listener.mock.calls[0][0]);
    expect(readAfterTranscript).toHaveBeenCalledTimes(1);
    expect(lease.getTailCursor?.()).toBe('cursor-0');
    acknowledge();
    await retry;
    expect(lease.getTailCursor?.()).toBe('cursor-1');
  });

  it('settles immediate polls without reading when no listener remains or the lease was released', async () => {
    const readAfterTranscript = vi.fn().mockResolvedValue({ items: [], nextCursor: 'cursor-0', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0' });
    onTestFinished(() => lease.release());
    await lease.pollNow();
    expect(readAfterTranscript).not.toHaveBeenCalled();
    const unsubscribe = lease.subscribeToTranscriptUpdates!(() => {});
    await lease.pollNow();
    unsubscribe();
    await lease.pollNow();
    await lease.release();
    await lease.pollNow();
    expect(readAfterTranscript).toHaveBeenCalledTimes(1);
  });

  it('retries the same unacknowledged Desktop batch before reading the provider again', async () => {
    const observations = [{ observation: { v: 1 as const, source: 'desktop' as const, state: 'completed' as const, turnId: 'short-turn' }, continuity: 'event' as const }];
    const readAfterTranscript = vi.fn().mockResolvedValueOnce({ items: [{ id: 'stable-message', createdAtMs: 1, raw: {} }],
      nextCursor: 'cursor-1', observations, truncated: false }).mockResolvedValue({ items: [], nextCursor: 'cursor-1', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0', env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } });
    onTestFinished(() => lease.release());
    let acknowledge!: () => void;
    const ack = new Promise<void>((resolve) => { acknowledge = resolve; });
    const listener = vi.fn().mockRejectedValueOnce(new Error('metadata write failed')).mockImplementation(() => ack);
    const visibleMessageIds = new Set<string>();
    const successfulListener = vi.fn((update) => { for (const item of update.items) visibleMessageIds.add(item.id); });
    lease.subscribeToTranscriptUpdates?.(listener);
    lease.subscribeToTranscriptUpdates?.(successfulListener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(readAfterTranscript).toHaveBeenCalledTimes(1);
    expect(lease.getTailCursor?.()).toBe('cursor-0');
    expect(listener.mock.calls[1][0]).toEqual(listener.mock.calls[0][0]);
    expect(listener.mock.calls[1][0].observations).toEqual(observations);
    expect(successfulListener).toHaveBeenCalledTimes(2);
    expect([...visibleMessageIds]).toEqual(['stable-message']);
    acknowledge();
    await vi.waitFor(() => expect(lease.getTailCursor?.()).toBe('cursor-1'));
  });

  it('does not advance or schedule another read when released during listener acknowledgement', async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const readAfterTranscript = vi.fn().mockResolvedValue({ items: [], nextCursor: 'cursor-1', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0', env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } });
    onTestFinished(() => lease.release());
    let acknowledge!: () => void;
    const ack = new Promise<void>((resolve) => { acknowledge = resolve; });
    const listener = vi.fn().mockRejectedValueOnce(new Error('checkpoint failed')).mockImplementation(() => ack);
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    await lease.release();
    acknowledge();
    await ack;
    await vi.advanceTimersByTimeAsync(30);
    expect(lease.getTailCursor?.()).toBe('cursor-0');
    expect(readAfterTranscript).toHaveBeenCalledTimes(1);
  });

  it('retries an initial historical snapshot through the same acknowledgement pipeline', async () => {
    const observations = [{ observation: { v: 1 as const, source: 'desktop' as const, state: 'completed' as const, turnId: 'history' }, continuity: 'snapshot' as const }];
    const readAfterTranscript = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: 'initial-tail', observations, truncated: false })
      .mockResolvedValue({ items: [], nextCursor: 'initial-tail', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } });
    onTestFinished(() => lease.release());
    const listener = vi.fn().mockRejectedValueOnce(new Error('initial checkpoint failed')).mockImplementation(async (update) => {
      expect(readAfterTranscript).toHaveBeenCalledTimes(1);
      expect(update.observations).toEqual(observations);
      await lease.release();
    });
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(listener.mock.calls[1][0]).toEqual(listener.mock.calls[0][0]);
  });

  it('resumes the committed cursor and emits state-only provider updates', async () => {
    const readAfterTranscript = vi.fn().mockResolvedValue({ items: [], nextCursor: 'committed', truncated: false,
      observations: [{ observation: { v: 1, source: 'desktop', state: 'completed', turnId: 'turn-1' }, continuity: 'event' }] });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'committed' });
    onTestFinished(() => lease.release());
    const listener = vi.fn();
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      observations: [{ observation: { v: 1, source: 'desktop', state: 'completed', turnId: 'turn-1' }, continuity: 'event' }],
    })));
    expect(readAfterTranscript.mock.calls.every(([params]) => params.cursor === 'committed')).toBe(true);
  });
  it('reports a failed read episode and retries from the last accepted cursor', async () => {
    // The logger is the process console/file I/O boundary, not transcript domain logic.
    const infoFile = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    onTestFinished(() => infoFile.mockRestore());
    const error = new Error('complete transcript boundary unavailable');
    const laterError = new Error('transcript temporarily unavailable again');
    const readAfterTranscript = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'accepted-tail', truncated: false })
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        items: [{ id: 'recovered', createdAtMs: 2, raw: { role: 'user', content: { type: 'text', text: 'recovered' } } }],
        nextCursor: 'recovered-tail', truncated: false,
      })
      .mockRejectedValueOnce(laterError)
      .mockResolvedValue({ items: [], nextCursor: 'recovered-tail', truncated: false });
    const lease = await createPollingDirectSessionFollowLease({ readAfterTranscript, env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } });
    onTestFinished(() => lease.release());
    const listener = vi.fn();
    lease.subscribeToTranscriptUpdates?.(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ nextCursor: 'recovered-tail' })));
    await vi.waitFor(() => expect(infoFile).toHaveBeenCalledWith(expect.any(String), laterError));
    expect(infoFile).toHaveBeenCalledWith(expect.any(String), error);
    expect(infoFile).toHaveBeenCalledTimes(2);
    expect(readAfterTranscript.mock.calls.slice(1, 4).map(([params]) => params.cursor))
      .toEqual(['accepted-tail', 'accepted-tail', 'accepted-tail']);
  });

  it.each([true, false])('emits capped read progress with legacy truncated=%s, including empty pages', async (truncated) => {
    const readAfterTranscript = vi.fn()
      .mockResolvedValueOnce({
        items: [],
        nextCursor: 'cursor-1',
        truncated: false,
      })
      .mockResolvedValueOnce({
        items: truncated ? [
          {
            id: 'direct-msg-2',
            createdAtMs: 2,
            raw: { role: 'user', content: { type: 'text', text: 'followed direct' } },
          },
        ] : [],
        nextCursor: 'cursor-2',
        truncated,
        truncationReason: 'page_limit',
      });
    const listener = vi.fn();

    const lease = await createPollingDirectSessionFollowLease({
      readAfterTranscript,
      env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '1000' },
    });
    onTestFinished(() => lease.release());
    expect(lease.subscribeToTranscriptUpdates).toEqual(expect.any(Function));
    if (!lease.subscribeToTranscriptUpdates) {
      throw new Error('expected transcript subscription support');
    }
    const unsubscribe = lease.subscribeToTranscriptUpdates(listener);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1);
    });

    expect(readAfterTranscript).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cursor: 'tail',
    }));
    expect(readAfterTranscript).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: 'cursor-1',
    }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      truncated,
      truncationReason: 'page_limit',
    }));

    unsubscribe();
  });

  it('emits cursor-only progress when a complete read consumes non-renderable source records', async () => {
    const readAfterTranscript = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-1', truncated: false })
      .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-2', truncated: false });
    const listener = vi.fn();
    const lease = await createPollingDirectSessionFollowLease({
      readAfterTranscript,
      env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '1000' },
    });
    onTestFinished(() => lease.release());
    lease.subscribeToTranscriptUpdates?.(listener);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({
      items: [],
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      truncated: false,
    }));
  });
});
