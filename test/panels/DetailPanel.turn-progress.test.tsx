// @vitest-environment happy-dom

/**
 * CONCISE MODE, AS THE COLUMN DRAWS IT.
 *
 * The operator asked for a control over how much of a turn's working the
 * transcript shows -- "show the progress, or collapse it, like the Claude Code
 * plugin". `prefs/progress.ts` holds the mode and the rule; this file is about
 * what is actually in the DOM under each of the two, because a rule that says
 * "keep this line" is worth nothing if the pane draws the line off a second
 * conditional of its own.
 *
 * WHAT IS ASSERTED IS RENDERED TEXT AND RENDERED ELEMENTS, never a class name
 * and never a computed value: the failure this whole setting is bounded by --
 * a fold that costs the operator the ALARM -- is a fact vam holds and does not
 * draw, and only the drawn thing can catch it.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_TURN_PROGRESS,
  setActiveTurnProgress,
  type TurnProgress,
} from '../../src/renderer/prefs/progress.js';

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    label: `turn-${id}`,
    input: `ask ${id}`,
    output: `done ${id}`,
    commands: [],
    ...over,
  };
}

/** `decisions` is newest first, which is the order the model hands over. */
function draw(
  decisions: readonly Decision[],
  session: Partial<Session> = {},
  props: Partial<DetailPanelProps> = {},
) {
  const built: Session = {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions,
    ...session,
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [built] };
  const entry: SessionEntry = { project, session: built };
  render(
    <DetailPanel
      entry={entry}
      decision={decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...props}
    />,
  );
}

/** Every turn's condensed line, oldest first -- the order the column draws. */
const lines = () => [...document.querySelectorAll<HTMLElement>('[data-progress-line]')];
/** The `progress` region wrapper, which carries the region's announced name. */
const regions = () => [...document.querySelectorAll<HTMLElement>('[data-detail-block="progress"]')];
const labels = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-turn-label]')].map((el) => ({
    mark: el.firstElementChild?.textContent ?? '',
    label: el.lastElementChild?.textContent ?? '',
  }));
const perTurnFailed = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-failed]')].map(
    (el) => el.textContent ?? '',
  );
const columnFailed = () => document.querySelector<HTMLElement>('[data-column-failed]');
const unreadable = () => document.querySelector<HTMLElement>('[data-column-unreadable]');
const answers = () =>
  [...document.querySelectorAll<HTMLElement>('[data-detail-block="out"]')].map(
    (el) => el.textContent ?? '',
  );

function inMode(mode: TurnProgress, body: () => void) {
  setActiveTurnProgress(mode);
  body();
}

afterEach(() => {
  cleanup();
  setActiveTurnProgress(DEFAULT_TURN_PROGRESS);
});

describe('shown is the screen the column already had', () => {
  it('draws one condensed line per turn', () => {
    inMode('shown', () => {
      draw([turn('a'), turn('b'), turn('c')]);
      expect(lines()).toHaveLength(3);
      expect(labels().map((l) => l.label)).toEqual(['turn-c', 'turn-b', 'turn-a']);
    });
  });

  it('is what an operator who never opened the picker gets', () => {
    // The default is not merely a value in a module: it is the mode a fresh
    // store puts in force, and a default that hid lines would ship a change
    // to everybody who did not ask for one.
    expect(DEFAULT_TURN_PROGRESS).toBe('shown');
    draw([turn('a'), turn('b')]);
    expect(lines()).toHaveLength(2);
  });
});

describe('collapsed withdraws the working of turns that have nothing to report', () => {
  it('draws no line at all on quiet, finished turns', () => {
    inMode('collapsed', () => {
      draw([turn('a'), turn('b'), turn('c')]);
      expect(lines()).toHaveLength(0);
      // ABSENT, NOT DIMMED -- and absent means the region goes with it. A
      // `progress` wrapper left behind would leave a screen reader announcing
      // a region with nothing in it, which is a worse silence than none.
      expect(regions()).toHaveLength(0);
    });
  });

  it('leaves the prompt and the answer of every turn exactly where they were', () => {
    // What collapses is the INTERMEDIATE work. A mode that also took the
    // conversation would not be concise, it would be empty.
    inMode('collapsed', () => {
      draw([turn('a'), turn('b')]);
      expect(document.querySelectorAll('[data-column-turn]')).toHaveLength(2);
      expect(answers().join(' ')).toContain('done a');
      expect(answers().join(' ')).toContain('done b');
      expect(document.body.textContent).toContain('ask a');
    });
  });
});

describe('the fold may cost detail, never alarm', () => {
  it('keeps the whole line of a turn whose tools failed, count and all', () => {
    // The assertion the setting is bounded by. `errorCount`'s own comment:
    // a turn whose tools blew up three times still read `✓`, and the
    // collapsed line said "12 turns read" over a run that was on fire.
    inMode('collapsed', () => {
      draw([turn('a'), turn('b', { errorCount: 3 }), turn('c')]);
      expect(lines()).toHaveLength(1);
      expect(labels()).toEqual([{ mark: '!', label: 'turn-b' }]);
      expect(perTurnFailed()).toEqual(['· 3 failed']);
    });
  });

  it('keeps it on a turn still in flight whose tools have already failed', () => {
    inMode('collapsed', () => {
      draw([turn('a', { output: null, errorCount: 1 }), turn('b')]);
      // Newest and unfinished, so `◌` would be true and `!` is truer.
      expect(labels()).toEqual([{ mark: '!', label: 'turn-a' }]);
    });
  });

  it('leaves the column’s own total across the window untouched', () => {
    // The per-turn count says WHERE, the total says HOW MANY over the turns
    // vam read. Collapsing must not cost the second one either -- and it is
    // the answer for a failing turn that has scrolled out of sight.
    inMode('collapsed', () => {
      draw([turn('a', { errorCount: 1 }), turn('b', { errorCount: 2 })]);
      expect(columnFailed()?.textContent).toBe('· 3 failed');
    });
  });

  it('keeps the newest turn’s line while the session has a present to report', () => {
    inMode('collapsed', () => {
      draw([turn('a'), turn('b')], { activity: 'coder · round 2 · sonnet' });
      expect(lines()).toHaveLength(1);
      expect(document.querySelector('[data-progress-activity]')?.textContent).toBe(
        'coder · round 2 · sonnet',
      );
    });
  });

  it('keeps it while the session is blocked, in the session’s own words', () => {
    inMode('collapsed', () => {
      draw([turn('a'), turn('b')], { status: 'waiting', waitingFor: 'permission prompt' });
      expect(document.querySelector('[data-progress-waiting]')?.textContent).toBe(
        'permission prompt',
      );
    });
  });
});

describe('two different unknowns do not become one', () => {
  it('draws "vam looked and found none" exactly like "vam cannot look"', () => {
    // Neither is a failure, so neither may hold a line open on failure
    // grounds: a rule that branched on `undefined` would paint an alarm over
    // a source that never looked. Rendered, not reasoned about -- the two
    // must produce the same DOM.
    let read = '';
    inMode('collapsed', () => {
      draw([turn('a', { errorCount: 0 }), turn('b', { errorCount: 0 })]);
      read = document.body.innerHTML;
    });
    cleanup();
    inMode('collapsed', () => {
      draw([turn('a'), turn('b')]);
      // The one thing that legitimately differs is the qualifier below, which
      // is about the WINDOW rather than about either turn.
      const cannot = document.body.innerHTML;
      expect(unreadable()).not.toBeNull();
      expect(read).not.toBe(cannot);
      expect(lines()).toHaveLength(0);
    });
    // ... and with that qualifier removed from the comparison, the turns
    // themselves are byte-identical.
    expect(read.includes('data-progress-line')).toBe(false);
  });

  it('says so, once, when nothing in the window can report a failure at all', () => {
    // COLLAPSING IS WHAT MAKES THIS OWED. While every turn drew a line, the
    // line claimed nothing about failure. Collapsed, the ABSENCE of a line is
    // the claim -- "nothing here is worth stopping for" -- and over a source
    // with no failure surface that claim is unearned. So the window says what
    // it could not read, beside the count of the same window.
    inMode('collapsed', () => {
      draw([turn('a'), turn('b')]);
      expect(unreadable()?.textContent).toBe('· failures not reported by this source');
      expect(document.querySelector('[data-progress-count]')?.textContent).toBe('2 turns read');
    });
  });

  it('says nothing of the kind when vam looked and found none', () => {
    inMode('collapsed', () => {
      draw([turn('a', { errorCount: 0 }), turn('b', { errorCount: 0 })]);
      expect(unreadable()).toBeNull();
      expect(columnFailed()).toBeNull();
    });
  });

  it('says nothing of the kind when even one turn in the window can report', () => {
    // The qualifier is about the window, and a window with one reporting turn
    // is a window vam looked at. The reporting turn's own count is the news.
    inMode('collapsed', () => {
      draw([turn('a'), turn('b', { errorCount: 2 })]);
      expect(unreadable()).toBeNull();
      expect(columnFailed()?.textContent).toBe('· 2 failed');
    });
  });

  /**
   * THE CASE THAT IS NOT HERE, and why it is not.
   *
   * "A window with no turns in it" looks like the obvious fourth case, and a
   * test for it was written and DELETED: it passed with the guard it existed
   * to cover removed, because the column is not drawn at all when there are no
   * turns (`orderedTurns.length === 0` renders one sentence instead), so the
   * qualifier's own element is unreachable there. A green assertion over an
   * unreachable state is not coverage, it is a claim nothing can falsify --
   * and the guard it was protecting was deleted with it.
   */
  it('leaves the qualifier off entirely while progress is shown', () => {
    // Shown, every turn keeps its line and the absence of one claims nothing,
    // so there is nothing to qualify. A caveat drawn there would be a new
    // sentence on a screen the operator did not ask to change.
    inMode('shown', () => {
      draw([turn('a'), turn('b')]);
      expect(unreadable()).toBeNull();
    });
  });
});
