/**
 * CAN THE ERROR LOG'S TEXT BE SELECTED? Measured in a real browser, because
 * this is a question about computed style and nothing else can answer it.
 *
 * `src/renderer/styles.css` sets `body { user-select: none }` for the whole
 * app -- deliberately, it is a keyboard tool -- and exactly one subtree opts
 * back in with Tailwind's `select-text` (`DetailPanel.tsx`). `ErrorLogPanel`
 * is mounted from `Canvas.tsx` as a sibling overlay, so it inherits the `none`
 * and nothing in it can be dragged over: not a failure message, and not the
 * prefilled GitHub URL the panel prints when the clipboard write is refused.
 *
 * A UNIT TEST CANNOT SHOW THIS. happy-dom applies no stylesheet, so the class
 * list is all a unit test can read, and a class list only proves the rule was
 * typed. `getComputedStyle` in a page that has actually loaded the built CSS
 * is the measurement. `test/errors/ErrorLogPanel.copy.test.tsx` pins the
 * mechanism so a regression is caught cheaply; this pins the effect.
 *
 * Runs against `?demo=1` only -- the fixture, never a real session.
 */

import { expect, test } from '@playwright/test';

test('the error log is selectable text', async ({ page }) => {
  await page.goto('/?demo=1');
  // `E` is the chord table's binding for the error log
  // (`src/renderer/keyboard/chords.ts`). The demo records no failures, so the
  // status bar cell is hidden and the key is the only way in -- which is
  // itself the reason the binding exists.
  await page.keyboard.press('E');
  const dialog = page.locator('[data-error-log]');
  await expect(dialog).toBeVisible();

  const empty = page.getByTestId('error-log-empty');
  await expect(empty).toBeVisible();

  const userSelect = await empty.evaluate((node) => getComputedStyle(node).userSelect);
  expect(
    userSelect,
    'text in the error log inherits body { user-select: none }, so it cannot be drag-selected and copied',
  ).not.toBe('none');
});
