/**
 * The main-thread half of the stats scan: spawns `worker.ts` (a real
 * `node:worker_threads` `Worker` in production, so a full filesystem walk of
 * `~/.claude/projects` and `~/.codex/sessions` never blocks the process
 * drawing the window) and turns its messages into a `ScanOutcome`.
 *
 * ONE WORKER PER SCAN, NOT A PERSISTENT ONE. The operator's own rule is
 * "compute only while the Stats screen is open, plus on an explicit
 * refresh" — there is no polling this needs to answer between scans, so a
 * fresh, short-lived thread per request is simpler than a pool with
 * nothing else to do between requests.
 *
 * TWO MESSAGES, NOT ONE — see `worker.ts`'s own header for why. This
 * module's job is turning that into TWO promises: the one it returns
 * settles the moment `'stats'` arrives (token stats, ready to render), and
 * `ScanOutcome.prsUpdate` is a SECOND promise the caller awaits separately
 * for the PR count that may still be in flight — `null` when `'stats'`
 * already carried a settled answer, so there is nothing further to wait
 * for. The worker is terminated once NOTHING more can arrive: right away
 * when `prsUpdate` is `null`, otherwise after the `'prs'` message lands (or
 * after the worker exits without ever sending one — `prsUpdate` still
 * resolves, to a safe `'unavailable'`, rather than hanging forever).
 *
 * `createWorker` IS INJECTED so this file's OWN logic — the protocol, and
 * that a stale event after settling changes nothing — is testable without a
 * real OS thread (`scan-runner.test.ts`). The real spawn, and that the
 * built `.cjs` worker file actually loads and runs inside a real Electron
 * app, is what `test/electron/`'s app-level harness proves instead — a real
 * thread is not a unit, on the same reasoning `test/electron/launch.test.ts`
 * already states for the app itself.
 */

import { Worker } from 'node:worker_threads';
import type { PrsCreated, StatsSnapshot } from '../../shared/stats.js';

export type WorkerLike = {
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  terminate(): Promise<number> | number;
};

export type ScanRunnerDeps = {
  readonly workerPath: string;
  readonly home: string;
  readonly timeZone: string;
  readonly cachePath: string;
  readonly now: () => number;
  /** Set by the explicit Refresh button alone — bypasses the PR count's own
   *  TTL (`pr-count-cache.ts`); `get()` on mount always passes `false`. */
  readonly forceRefresh?: boolean;
  readonly createWorker?: (path: string, workerData: unknown) => WorkerLike;
};

export type ScanOutcome =
  | {
      readonly kind: 'ok';
      readonly snapshot: StatsSnapshot;
      readonly prsUpdate: Promise<PrsCreated> | null;
    }
  | { readonly kind: 'error'; readonly message: string };

const FALLBACK_PRS: PrsCreated = {
  kind: 'unavailable',
  hint: 'connect GitHub in Settings → Integrations',
  reason: 'error',
};

const defaultCreateWorker = (path: string, workerData: unknown): WorkerLike =>
  new Worker(path, { workerData }) as unknown as WorkerLike;

export async function runStatsScanInWorker(deps: ScanRunnerDeps): Promise<ScanOutcome> {
  const create = deps.createWorker ?? defaultCreateWorker;
  const worker = create(deps.workerPath, {
    home: deps.home,
    timeZone: deps.timeZone,
    cachePath: deps.cachePath,
    now: deps.now(),
    forceRefresh: deps.forceRefresh === true,
  });

  return new Promise((resolve) => {
    let mainSettled = false;
    let prsResolve: ((prsCreated: PrsCreated) => void) | null = null;
    let done = false;

    const finishAndTerminate = (): void => {
      if (done) return;
      done = true;
      // Fire-and-forget: nothing more can arrive, and a termination
      // failure has nothing left to report to.
      Promise.resolve(worker.terminate()).catch(() => {});
    };

    const finishMain = (outcome: ScanOutcome): void => {
      if (mainSettled) return;
      mainSettled = true;
      resolve(outcome);
      if (outcome.kind === 'error' || outcome.prsUpdate === null) finishAndTerminate();
    };

    worker.on('message', (message: unknown) => {
      const parsed = message as {
        readonly kind?: string;
        readonly snapshot?: StatsSnapshot;
        readonly prsCreated?: PrsCreated;
        readonly message?: string;
      };
      if (parsed.kind === 'stats' && parsed.snapshot !== undefined) {
        const loading = parsed.snapshot.prsCreated.kind === 'loading';
        const prsUpdate = loading
          ? new Promise<PrsCreated>((res) => {
              prsResolve = res;
            })
          : null;
        finishMain({ kind: 'ok', snapshot: parsed.snapshot, prsUpdate });
        return;
      }
      if (parsed.kind === 'prs' && parsed.prsCreated !== undefined) {
        prsResolve?.(parsed.prsCreated);
        prsResolve = null;
        finishAndTerminate();
        return;
      }
      finishMain({
        kind: 'error',
        message: parsed.message ?? 'the stats worker returned no snapshot',
      });
    });
    worker.on('error', (error: Error) => {
      finishMain({ kind: 'error', message: error.message });
      prsResolve?.(FALLBACK_PRS);
      prsResolve = null;
    });
    worker.on('exit', (code: number) => {
      // A NON-ZERO EXIT WITH NO PRIOR MESSAGE is the one case worth
      // reporting here; a clean exit (or one AFTER a message already
      // settled this promise) is the worker finishing normally.
      if (code !== 0 && !mainSettled) {
        finishMain({ kind: 'error', message: `the stats worker exited with code ${code}` });
      }
      // Died (or exited for any reason) before ever sending its 'prs'
      // follow-up — that promise must still settle, never hang the Stats
      // screen's own PR card forever.
      prsResolve?.(FALLBACK_PRS);
      prsResolve = null;
      finishAndTerminate();
    });
  });
}
