import logger from '@/utils/logger';
import { scanActivity } from '@/api/v1/shared/infrastructure/services/ScanActivityTracker';

interface ScanJob {
  libraryId: string;
  run: () => Promise<void>;
}

/**
 * Runs library scans one after another, never in parallel: a scan (manual, automatic or of a new
 * library) waits for the one in progress. A library that is already waiting or running is not
 * queued twice.
 */
export class ScanQueue {
  private readonly pending: ScanJob[] = [];
  private running: ScanJob | null = null;

  /** Whether the library is being scanned or waiting for its turn. */
  isScheduled(libraryId: string): boolean {
    return this.running?.libraryId === libraryId || this.pending.some((j) => j.libraryId === libraryId);
  }

  /**
   * Queues a scan. Returns false when that library is already scheduled.
   * The queue is started right away if nothing is running.
   */
  enqueue(libraryId: string, run: () => Promise<void>): boolean {
    if (this.isScheduled(libraryId)) {
      logger.warn({ libraryId }, 'Library scan already scheduled, ignoring request');
      return false;
    }

    this.pending.push({ libraryId, run });
    scanActivity.setQueued(this.pending.length);
    void this.pump();
    return true;
  }

  /** Resolves when nothing is running or waiting anymore. */
  async idle(): Promise<void> {
    while (this.running || this.pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;

    const job = this.pending.shift();
    if (!job) return;

    this.running = job;
    scanActivity.setQueued(this.pending.length);

    try {
      await job.run();
    } catch (error) {
      logger.error({ libraryId: job.libraryId, error }, 'Scan job failed');
    } finally {
      this.running = null;
      void this.pump();
    }
  }
}

export const scanQueue = new ScanQueue();
