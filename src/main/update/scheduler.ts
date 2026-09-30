/**
 * When the updater checks on its own: at most once every 24h (measured from
 * the persisted last attempt), and after the machine wakes if a check is due,
 * never more often than every hour.
 *
 * Pure: the clock and the timers are injected, so the tests drive it with
 * fake time and `index.ts` hands it the real ones.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_GAP_MS = 60 * 60 * 1000;

/** Milliseconds until the next check is due; 0 when due now (or never checked). */
export function nextCheckDelay(now: number, lastCheckAt: number | null): number {
  if (lastCheckAt === null) return 0;
  // A stamp from the future means the clock moved back; treat it as due.
  if (lastCheckAt > now) return 0;
  return Math.max(0, lastCheckAt + DAY_MS - now);
}

export type SchedulerDeps = {
  readonly clock: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  /** One automatic check. The scheduler never awaits it for anything but pacing. */
  readonly run: () => Promise<void>;
  readonly getAutoCheck: () => boolean;
  readonly getLastCheckAt: () => number | null;
};

export type Scheduler = {
  start(): void;
  onResume(): void;
  stop(): void;
};

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let handle: unknown = null;
  let stopped = true;
  let lastRunAt: number | null = null;
  let running = false;

  const clear = (): void => {
    if (handle !== null) deps.clearTimeout(handle);
    handle = null;
  };

  const arm = (ms: number): void => {
    clear();
    handle = deps.setTimeout(() => {
      handle = null;
      void tick();
    }, ms);
  };

  async function runNow(): Promise<void> {
    if (running) return;
    running = true;
    lastRunAt = deps.clock();
    try {
      await deps.run();
    } catch {
      // A failed check is the controller's to report; the schedule goes on.
    } finally {
      running = false;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (!deps.getAutoCheck()) {
      // Re-read soon, so turning the setting on does not wait out a day.
      arm(MIN_GAP_MS);
      return;
    }
    await runNow();
    if (stopped) return;
    // The floor keeps a run that recorded nothing from spinning.
    arm(Math.max(MIN_GAP_MS, nextCheckDelay(deps.clock(), deps.getLastCheckAt())));
  }

  return {
    start() {
      stopped = false;
      arm(nextCheckDelay(deps.clock(), deps.getLastCheckAt()));
    },
    onResume() {
      if (stopped || running || !deps.getAutoCheck()) return;
      const now = deps.clock();
      if (nextCheckDelay(now, deps.getLastCheckAt()) > 0) return;
      if (lastRunAt !== null && now - lastRunAt < MIN_GAP_MS) return;
      clear();
      void tick();
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
