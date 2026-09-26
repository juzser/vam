/**
 * The main-thread half of the stats scan: spawns `worker.ts` (a real
 * `node:worker_threads` `Worker` in production, so a full filesystem walk of
 * `~/.claude/projects` and `~/.codex/sessions` never blocks the process
 * drawing the window) and turns its one reply into a `ScanOutcome`.
 *
 * ONE WORKER PER SCAN, NOT A PERSISTENT ONE. The operator's own rule is
 * "compute only while the Stats screen is open, plus on an explicit
 * refresh" — there is no polling this needs to answer between scans, so a
 * fresh, short-lived thread per request is simpler than a pool with
 * nothing else to do between requests, and it is terminated the moment its
 * one message arrives.
 *
 * `createWorker` IS INJECTED so this file's OWN logic — the done/error/exit
 * protocol, and that a stale event after settling changes nothing — is
 * testable without a real OS thread (`scan-runner.test.ts`). The real
 * spawn, and that the built `.cjs` worker file actually loads and runs
 * inside a real Electron app, is what `test/electron/`'s app-level harness
 * proves instead — a real thread is not a unit, on the same reasoning
 * `test/electron/launch.test.ts` already states for the app itself.
 */

import { Worker } from 'node:worker_threads';
import type { StatsSnapshot } from '../../shared/stats.js';

export type WorkerLike = {
  once(event: 'message', listener: (message: unknown) => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number) => void): void;
  terminate(): Promise<number> | number;
};

export type ScanRunnerDeps = {
  readonly workerPath: string;
  readonly home: string;
  readonly timeZone: string;
  readonly cachePath: string;
  readonly now: () => number;
  readonly createWorker?: (path: string, workerData: unknown) => WorkerLike;
};

export type ScanOutcome =
  | { readonly kind: 'ok'; readonly snapshot: StatsSnapshot }
  | { readonly kind: 'error'; readonly message: string };

const defaultCreateWorker = (path: string, workerData: unknown): WorkerLike =>
  new Worker(path, { workerData }) as unknown as WorkerLike;

export async function runStatsScanInWorker(deps: ScanRunnerDeps): Promise<ScanOutcome> {
  const create = deps.createWorker ?? defaultCreateWorker;
  const worker = create(deps.workerPath, {
    home: deps.home,
    timeZone: deps.timeZone,
    cachePath: deps.cachePath,
    now: deps.now(),
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ScanOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
      // Fire-and-forget: the worker's whole job is done the moment it sent
      // its one message, and a termination failure has nothing left to
      // report to.
      Promise.resolve(worker.terminate()).catch(() => {});
    };
    worker.once('message', (message: unknown) => {
      const parsed = message as {
        readonly kind?: string;
        readonly snapshot?: StatsSnapshot;
        readonly message?: string;
      };
      if (parsed.kind === 'done' && parsed.snapshot !== undefined) {
        finish({ kind: 'ok', snapshot: parsed.snapshot });
      } else {
        finish({
          kind: 'error',
          message: parsed.message ?? 'the stats worker returned no snapshot',
        });
      }
    });
    worker.once('error', (error: Error) => {
      finish({ kind: 'error', message: error.message });
    });
    worker.once('exit', (code: number) => {
      // A NON-ZERO EXIT WITH NO PRIOR MESSAGE is the one case worth
      // reporting here; a clean exit (or one AFTER a message already
      // settled this promise) is the worker finishing normally.
      if (code !== 0)
        finish({ kind: 'error', message: `the stats worker exited with code ${code}` });
    });
  });
}
