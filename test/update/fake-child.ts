import { EventEmitter } from 'node:events';

/** A spawn() result stand-in: emits `spawn` (or `error`) on the next tick. */
export function fakeChild(
  opts: { unref?: () => void; error?: Error; silent?: boolean } = {},
): EventEmitter & { unref(): void } {
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  child.unref = opts.unref ?? (() => undefined);
  if (!opts.silent) {
    setImmediate(() => {
      if (opts.error) child.emit('error', opts.error);
      else child.emit('spawn');
    });
  }
  return child;
}
