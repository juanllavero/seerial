import type { MusicDownloadProgress, ScanActivity, ScanProgress } from '@seerial/domain';

type ActivityListener = (activity: ScanActivity) => void;

/** Progress is reported at most this often while it moves (transitions are sent right away). */
const EMIT_INTERVAL_MS = 250;

interface MusicEntry {
  libraryName: string;
  completed: number;
  total: number;
}

/**
 * Keeps what the server is doing in the background (the library scan in progress and the music
 * downloads of the libraries) and tells the subscribers whenever it changes, so clients can show it.
 */
export class ScanActivityTracker {
  private scan: ScanProgress | null = null;
  private queued = 0;
  private readonly music = new Map<string, MusicEntry>();
  private readonly listeners = new Set<ActivityListener>();
  private timer: NodeJS.Timeout | null = null;

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ScanActivity {
    const first = this.music.entries().next();
    let music: MusicDownloadProgress | null = null;
    if (!first.done) {
      const [libraryId, entry] = first.value;
      music = { libraryId, ...entry };
    }

    return { scan: this.scan ? { ...this.scan } : null, music, queued: this.queued };
  }

  setQueued(queued: number): void {
    if (queued === this.queued) return;
    this.queued = queued;
    this.emit(true);
  }

  startScan(libraryId: string, libraryName: string): void {
    this.scan = { libraryId, libraryName, processed: 0, total: 0 };
    this.emit(true);
  }

  setScanTotal(total: number): void {
    if (!this.scan) return;
    this.scan.total = total;
    this.emit(true);
  }

  advanceScan(): void {
    if (!this.scan) return;
    this.scan.processed += 1;
    this.emit(false);
  }

  finishScan(): void {
    this.scan = null;
    this.emit(true);
  }

  /** A music download was queued for the library. */
  musicQueued(libraryId: string, libraryName: string): void {
    const entry = this.music.get(libraryId);
    if (entry) {
      entry.total += 1;
    } else {
      this.music.set(libraryId, { libraryName, completed: 0, total: 1 });
    }
    this.emit(true);
  }

  /** A queued music download finished (or failed): it is not pending anymore. */
  musicSettled(libraryId: string): void {
    const entry = this.music.get(libraryId);
    if (!entry) return;

    entry.completed += 1;
    if (entry.completed >= entry.total) {
      this.music.delete(libraryId);
      this.emit(true);
    } else {
      this.emit(false);
    }
  }

  private emit(immediate: boolean): void {
    if (immediate) {
      this.flush();
      return;
    }
    if (this.timer) return;

    this.timer = setTimeout(() => this.flush(), EMIT_INTERVAL_MS);
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const activity = this.snapshot();
    for (const listener of this.listeners) listener(activity);
  }
}

/** Shared by the scan queue, the downloader and the notifications. */
export const scanActivity = new ScanActivityTracker();
