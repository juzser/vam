// @vitest-environment happy-dom

/**
 * Two controls the phone treats as the opposite of what the desktop does, both
 * asked of the CASCADE on a rendered node -- `styles.css` is loaded into the
 * document, which is the only way to tell a rule that applies from a rule that
 * was merely typed. happy-dom lays nothing out, so nothing here is a box.
 *
 * The chord hint is suppressed: `InlineChord` prints its chord unconditionally
 * and two of its three call sites are the phone list screen's search and New
 * session controls. Suppressed, not deleted -- the keydown listener is not
 * phone-gated, so a folio keyboard at 390px still fires every chord.
 *
 * `data-add-to-group` is the inverse of the row's close `x`, and was found the
 * same way. It is `ProjectPicker`'s only opener, `opacity: 0` until its heading
 * is hovered, and #197 sized it to 44x44 without touching the opacity -- so a
 * touch-target sweep now passes over a control a finger cannot see or reveal.
 * There, an invisible control was hittable and had to become absent; here an
 * invisible control is a large passing target and has to become visible.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Group } from '../../src/renderer/domain/model.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession } from '../panels/session-list-props.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
});
afterEach(() => cleanup());

const PROJECT = makeProject({ id: 'p1', name: 'black-smith' }, []);
const GROUP: Group = { id: 'group:1', name: 'gamma', icon: null, projects: [PROJECT] };

/** The list as the shell hosts it, inside both hooks the phone rules use. */
function phoneList() {
  render(
    <div className="vam-phone">
      <div data-phone-shell="list">
        <SessionList
          {...baseProps([
            { project: PROJECT, session: makeSession({ id: 'a1', status: 'waiting' }), group: GROUP },
          ])}
          phone
          width={undefined}
          groups={[GROUP]}
          collapsedGroups={[]}
          onAddToGroup={() => {}}
        />
      </div>
    </div>,
  );
}

describe('what the phone hides and what it stops hiding', () => {
  it('suppresses the inline chord hints, which no finger can press', () => {
    phoneList();
    const chords = [...document.querySelectorAll('[data-inline-chord]')];
    expect(chords.length, 'the list screen draws two of these').toBeGreaterThan(0);
    for (const chord of chords) expect(getComputedStyle(chord).display).toBe('none');
  });

  it('reveals the only control that opens the project picker', () => {
    phoneList();
    const opener = document.querySelector('[data-add-to-group]');
    expect(opener, 'ProjectPicker has exactly one opener').not.toBeNull();
    expect(getComputedStyle(opener as Element).opacity).toBe('1');
  });
});
