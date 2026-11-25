jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() },
}));

import { ScanQueue } from '@/api/v1/libraries/application/services/ScanQueue';
import {
  SMART_SCAN_INTERVALS_MS,
  SmartScanScheduler,
} from '@/api/v1/libraries/application/services/SmartScanScheduler';
import { ScanActivityTracker } from '@/api/v1/shared/infrastructure/services/ScanActivityTracker';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('ScanQueue', () => {
  it('runs scans one at a time, in order, never in parallel', async () => {
    const queue = new ScanQueue();
    const events: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const job = (name: string) => async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      events.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, 15));
      events.push(`end ${name}`);
      concurrent -= 1;
    };

    queue.enqueue('a', job('a'));
    queue.enqueue('b', job('b'));
    queue.enqueue('c', job('c'));
    await queue.idle();

    expect(maxConcurrent).toBe(1);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('does not queue a library twice while it runs or waits', async () => {
    const queue = new ScanQueue();
    const gate = deferred();
    const run = jest.fn(() => gate.promise);

    expect(queue.enqueue('a', run)).toBe(true);
    expect(queue.enqueue('b', async () => {})).toBe(true);
    expect(queue.enqueue('a', run)).toBe(false); // running
    expect(queue.enqueue('b', run)).toBe(false); // waiting
    expect(queue.isScheduled('a')).toBe(true);

    gate.resolve();
    await queue.idle();

    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.isScheduled('a')).toBe(false);
    expect(queue.enqueue('a', async () => {})).toBe(true);
    await queue.idle();
  });

  it('keeps going when a scan fails', async () => {
    const queue = new ScanQueue();
    const second = jest.fn(async () => {});

    queue.enqueue('a', async () => {
      throw new Error('boom');
    });
    queue.enqueue('b', second);
    await queue.idle();

    expect(second).toHaveBeenCalled();
  });
});

describe('ScanActivityTracker', () => {
  it('reports the scan progress and clears it when done', () => {
    const tracker = new ScanActivityTracker();
    const seen: unknown[] = [];
    tracker.subscribe((a) => seen.push(a));

    tracker.startScan('lib', 'Movies');
    tracker.setScanTotal(3);
    tracker.advanceScan();
    expect(tracker.snapshot().scan).toEqual({
      libraryId: 'lib',
      libraryName: 'Movies',
      processed: 1,
      total: 3,
    });

    tracker.finishScan();
    expect(tracker.snapshot().scan).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
  });

  it('counts the music downloads of a library and forgets them when all finished', () => {
    const tracker = new ScanActivityTracker();

    tracker.musicQueued('lib', 'Shows');
    tracker.musicQueued('lib', 'Shows');
    tracker.musicSettled('lib');
    expect(tracker.snapshot().music).toEqual({
      libraryId: 'lib',
      libraryName: 'Shows',
      completed: 1,
      total: 2,
    });

    tracker.musicSettled('lib');
    expect(tracker.snapshot().music).toBeNull();
  });

  it('throttles progress updates but sends transitions right away', () => {
    jest.useFakeTimers();
    const tracker = new ScanActivityTracker();
    const listener = jest.fn();
    tracker.subscribe(listener);

    tracker.startScan('lib', 'Movies');
    tracker.setScanTotal(100);
    listener.mockClear();

    for (let i = 0; i < 50; i++) tracker.advanceScan();
    expect(listener).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].scan.processed).toBe(50);
    jest.useRealTimers();
  });
});

describe('SmartScanScheduler', () => {
  const build = (settings: { enabled: boolean; period: string }, clock: { t: number }) => {
    const scanAllLibraries = jest.fn(async () => {});
    const scheduler = new SmartScanScheduler({
      getSettings: () => settings,
      scanAllLibraries,
      now: () => clock.t,
    });
    return { scheduler, scanAllLibraries };
  };

  it('scans everything on the first check (server start)', async () => {
    const { scheduler, scanAllLibraries } = build({ enabled: true, period: 'daily' }, { t: 0 });
    expect(await scheduler.tick()).toBe(true);
    expect(scanAllLibraries).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the smart scan is off', async () => {
    const { scheduler, scanAllLibraries } = build({ enabled: false, period: 'daily' }, { t: 0 });
    expect(await scheduler.tick()).toBe(false);
    expect(scanAllLibraries).not.toHaveBeenCalled();
  });

  it.each(['daily', 'weekly', 'monthly'] as const)('repeats every %s period', async (period) => {
    const clock = { t: 1_000 };
    const { scheduler, scanAllLibraries } = build({ enabled: true, period }, clock);
    const interval = SMART_SCAN_INTERVALS_MS[period];

    await scheduler.tick();
    clock.t += interval - 1;
    expect(await scheduler.tick()).toBe(false);
    clock.t += 1;
    expect(await scheduler.tick()).toBe(true);
    expect(scanAllLibraries).toHaveBeenCalledTimes(2);
  });

  it('falls back to daily for an unknown period and survives a failing scan', async () => {
    const clock = { t: 0 };
    const scanAllLibraries = jest.fn().mockRejectedValue(new Error('db down'));
    const scheduler = new SmartScanScheduler({
      getSettings: () => ({ enabled: true, period: 'min15' }),
      scanAllLibraries,
      now: () => clock.t,
    });

    expect(await scheduler.tick()).toBe(false);
    clock.t += SMART_SCAN_INTERVALS_MS.daily - 1;
    expect(await scheduler.tick()).toBe(false);
  });
});
