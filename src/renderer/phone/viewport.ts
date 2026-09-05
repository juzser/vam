/**
 * Which shell the window is wide enough for.
 *
 * One media query, read the same way `SettingsOverlay.useWideNav` reads its
 * own, with one deliberate difference in the default -- see below.
 */

import { useEffect, useState } from 'react';
import { DETAIL_MIN, SIDEBAR_MIN } from '../prefs/panes.js';

/**
 * The widest viewport that gets the phone shell, DERIVED rather than picked.
 *
 * `SIDEBAR_MIN + DETAIL_MIN` is the narrowest window in which the desktop
 * layout can draw even two columns; one pixel under it, the columns do not
 * merely look bad, they cannot exist. Writing the sum rather than the 519 it
 * currently comes to means the line moves if either floor does, which is the
 * discipline `DETAIL_MAX` and `FOCUS_MIN_VIEWPORT` already follow.
 */
export const PHONE_MAX_WIDTH = SIDEBAR_MIN + DETAIL_MIN - 1;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/**
 * Is this a phone-sized viewport?
 *
 * `false` when `matchMedia` is missing, and that fallback is the whole reason
 * a second shell can land without touching a test file: jsdom and happy-dom
 * provide no `matchMedia` in the node environment most of this suite runs in,
 * so every existing test keeps rendering the columns it was written against.
 * `useWideNav` falls back the other way for the same reason both are stated as
 * reasons rather than defaults -- each falls back to the layout that already
 * ships, and here that is the desktop.
 *
 * Deliberately not `window.innerWidth`: `Canvas` already keeps a
 * `viewportWidth` state for the pane arithmetic, and a second reader of one
 * fact is how the two disagree.
 */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.(PHONE_QUERY).matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.(PHONE_QUERY);
    if (!query) return;
    const sync = () => setPhone(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return phone;
}
