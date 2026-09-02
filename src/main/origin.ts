/**
 * Is this navigation target the window's own origin?
 *
 * Lives in its own module, importing no electron, so it can be unit-tested
 * directly. The dev branch cannot be reached by the launch harness at all --
 * that runs the built app on a `file://` origin, where the check is strict
 * equality -- so a bug in the dev branch would have no test anywhere.
 */
export function isSameOrigin(target: string, allowedOrigin: string, isDev: boolean): boolean {
  if (!isDev) {
    return target === allowedOrigin;
  }
  // PARSED ORIGINS, never string prefixes. `startsWith` on
  // `http://localhost:5173` also accepts `http://localhost:5173.attacker
  // .example/` -- a different host that merely begins with the same
  // characters, which is exactly the navigation this refuses.
  try {
    return new URL(target).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}
