/**
 * `VAM_USER_DATA_DIR`, read once: a throwaway `userData` directory for a
 * test/fixture launch, and ONLY that.
 *
 * A production launch (Finder, Dock, Spotlight, `pnpm run dev:app`) never
 * sets this, so `undefined` here is what "leave the default alone" means --
 * see `src/main/index.ts`'s own call site, which is why the default Electron
 * would have picked (derived from the OS user's real home directory, not
 * `process.env.HOME`, which Electron does not consult on macOS -- measured)
 * stays exactly what it was for every launch that never names this variable.
 *
 * Nothing this app exposes to a renderer or a remote peer can reach
 * `process.env` in the main process, so this is not settable by a web page
 * or a paired phone -- only by whatever spawned this process, which for a
 * production build is never anything this repo writes.
 */
export function resolveUserDataOverride(
  env: Record<string, string | undefined>,
): string | undefined {
  const value = env.VAM_USER_DATA_DIR;
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
