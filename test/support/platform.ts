/**
 * PUTTING A PLATFORM IN FRONT OF A COMPONENT.
 *
 * `chordSymbols` renders ⌘ on a Mac and `Ctrl` everywhere else, and a React
 * component has no flag to pass it: it takes the default, which is
 * `applePlatform()` reading `navigator.platform` at the moment of the paint.
 * That makes the host platform the input to every surface that paints a chord
 * — and `chords.ts` says in as many words what that costs a test suite: CI
 * runs on ubuntu and the operator's machine is a Mac, so a test that read the
 * platform off its host would assert a different rendering in each place while
 * looking identical in both.
 *
 * So no test in this repo reads it. Every one that paints a chord renders
 * twice, inside this, once per platform.
 *
 * `navigator.platform` IS A PROTOTYPE GETTER in both of vam's unit
 * environments (happy-dom) and in node, and it is `configurable` in all of
 * them, so an own property on the instance shadows it and can be taken off
 * again. Restoring is not politeness: the module is a singleton and a leaked
 * `MacIntel` would decide the rendering of every file that ran afterwards.
 */

/** The strings the two platforms really report. */
export const MAC_PLATFORM = 'MacIntel';
export const PC_PLATFORM = 'Win32';

/** The two, paired with the flag each one means. */
const BOTH: readonly (readonly [string, boolean])[] = [
  [MAC_PLATFORM, true],
  [PC_PLATFORM, false],
];

/** Put a platform in front of the reader; the answer puts the old one back. */
function setPlatform(description: string): () => void {
  const target = globalThis.navigator as unknown as object;
  const had = Object.getOwnPropertyDescriptor(target, 'platform');
  Object.defineProperty(target, 'platform', { value: description, configurable: true });
  return () => {
    if (had === undefined) {
      Reflect.deleteProperty(target, 'platform');
    } else {
      Object.defineProperty(target, 'platform', had);
    }
  };
}

/** Run `body` with `navigator.platform` answering `description`. */
export function withPlatform<T>(description: string, body: () => T): T {
  const restore = setPlatform(description);
  try {
    return body();
  } finally {
    restore();
  }
}

/** Run `body` once per platform, with the flag that platform means. */
export function onBothPlatforms(body: (mac: boolean) => void): void {
  for (const [description, mac] of BOTH) {
    withPlatform(description, () => body(mac));
  }
}

/**
 * The same, for a case that awaits — the Files tab opens a file through the
 * bridge, and a synchronous wrapper would put the platform back while the
 * component was still mounting.
 */
export async function onBothPlatformsAsync(body: (mac: boolean) => Promise<void>): Promise<void> {
  for (const [description, mac] of BOTH) {
    const restore = setPlatform(description);
    try {
      await body(mac);
    } finally {
      restore();
    }
  }
}
