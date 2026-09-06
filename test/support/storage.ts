/**
 * A deterministic `localStorage`, installed for every test file regardless
 * of which Node version is running it.
 *
 * Node >=22 ships an experimental `localStorage` global. Without
 * `--localstorage-file` it is a getter that evaluates to `undefined`; inside
 * vitest's happy-dom environment that native getter wins over happy-dom's own
 * Storage. The result: `globalThis.localStorage` is `undefined` under one
 * Node major and a real `Storage` under another, so any test file that
 * installed its own `globalThis.localStorage ??= <stub>` took a DIFFERENT
 * branch depending on which Node ran it -- the stub only ever installed on
 * the Node where the native global was absent. Locally that was every recent
 * Node; on CI (pinned to Node 22) it never was, so CI always exercised
 * happy-dom's real Storage while a local run exercised the stub.
 *
 * This setup file makes that choice deterministic instead of Node-version
 * dependent: it forces one Storage implementation into every test file, at
 * module load (before that file's own `beforeAll` can read `localStorage`)
 * and again fresh before each test (so a value written in one test cannot
 * leak into the next, in ANY file, not just the ones that remembered to call
 * `localStorage.clear()` themselves).
 */

import { beforeEach } from 'vitest';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

function install(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: memoryStorage(),
  });
}

// Runs once per test file, as soon as this setup module loads -- before that
// file's own top-level code and `beforeAll` hooks, so nothing in that file can
// observe the native/absent global this is here to paper over.
install();

// A fresh instance before every test: no leakage across tests in one file.
beforeEach(install);
