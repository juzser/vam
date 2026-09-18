/**
 * One way to copy, and one honest answer about whether it worked.
 *
 * Two routes, because vam has two builds. In the Electron shell the write
 * goes over the bridge to main's own `clipboard` module: the app denies every
 * Chromium permission, so `navigator.clipboard.writeText` there rejects with
 * `NotAllowedError` -- measured, not assumed -- and rejects again whenever the
 * document is unfocused. The browser build has no `window.api` at all and
 * `navigator.clipboard` is the only clipboard there is.
 *
 * The return value is the point. Every caller used to fire a floating promise
 * and print "copied" one statement later, so in the packaged app the operator
 * was told a copy had happened for a write that had already been refused.
 * Nothing here throws: a caller's job is to say what happened, and `false` is
 * that answer in the form a status line can use.
 */
export async function copyText(text: string): Promise<boolean> {
  const bridge = globalThis.window?.api?.clipboard;
  if (bridge !== undefined) {
    try {
      return await bridge.writeText(text);
    } catch {
      return false;
    }
  }
  const web = globalThis.navigator?.clipboard;
  if (web === undefined) {
    return false;
  }
  try {
    await web.writeText(text);
    return true;
  } catch {
    return false;
  }
}
