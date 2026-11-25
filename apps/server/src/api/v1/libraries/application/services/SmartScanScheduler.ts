import type { SmartScanPeriod } from '@seerial/domain';
import logger from '@/utils/logger';

const HOUR_MS = 60 * 60 * 1000;

/** Time between two smart scans for each period setting. */
export const SMART_SCAN_INTERVALS_MS: Record<SmartScanPeriod, number> = {
  daily: 24 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
  monthly: 30 * 24 * HOUR_MS,
};

/** How often the scheduler checks whether a scan is due (settings are read again each time). */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface SmartScanSettings {
  enabled: boolean;
  period: string;
}

interface SmartScanDeps {
  getSettings: () => SmartScanSettings;
  /** Queues a scan of every library. */
  scanAllLibraries: () => Promise<void>;
  now?: () => number;
}

export function resolveSmartScanInterval(period: string): number {
  return SMART_SCAN_INTERVALS_MS[period as SmartScanPeriod] ?? SMART_SCAN_INTERVALS_MS.daily;
}

/**
 * Smart scan: scans all the libraries when the server starts and then again every day, week or
 * month (the setting is read each time, so changes apply without restarting). The scans themselves
 * go through the scan queue, so they never overlap with each other or with manual scans.
 */
export class SmartScanScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: number | null = null;

  constructor(private readonly deps: SmartScanDeps) {}

  start(): void {
    if (this.timer) return;

    void this.tick();
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Scans everything when the smart scan is on and it is the first check or the period passed. */
  async tick(): Promise<boolean> {
    const now = (this.deps.now ?? Date.now)();

    try {
      const { enabled, period } = this.deps.getSettings();
      if (!enabled) return false;

      const due =
        this.lastScanAt === null || now - this.lastScanAt >= resolveSmartScanInterval(period);
      if (!due) return false;

      this.lastScanAt = now;
      logger.info({ period }, 'Smart scan: scanning all libraries');
      await this.deps.scanAllLibraries();
      return true;
    } catch (error) {
      logger.error({ error }, 'Smart scan failed to start');
      return false;
    }
  }
}
