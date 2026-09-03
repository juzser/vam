// @vitest-environment happy-dom

/**
 * The right-hand detail pane: what it collapses, what it colours, and what it
 * refuses to claim.
 *
 * Every assertion here is one of five operator requests read off the ADE
 * mockup's right pane (artboards 1a/1b, the `width:408px` column). The one that
 * is NOT a fidelity question is the composer's button: the mockup draws a send
 * arrow, black-smith has no channel into a running agent session, and the whole
 * point of the tests below is that the button says `record` in every place a
 * reader or a screen reader can find it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  ATTACH_LIMIT_BYTES,
  type AttachedFile,
  attachIntoDraft,
  DetailPanel,
  type DetailPanelProps,
  detachFromDraft,
  readAttachedName,
  readModelRequest,
  readModeRequest,
  setModelRequest,
  setModeRequest,
  splitAnswers,
} from '../../src/renderer/panels/DetailPanel.js';
import {
  hasContentAbove,
  hasContentBelow,
  isAtBottom,
} from '../../src/renderer/panels/stick-to-bottom.js';

/** `attachIntoDraft` for the cases a test knows will be accepted. */
function attachOk(draft: string, file: AttachedFile): string {
  const result = attachIntoDraft(draft, file);
  if (!result.ok) throw new Error(result.message);
  return result.draft;
}

function decision(id: string, output: string | null = 'answered'): Decision {
  return { id, label: `step ${id}`, input: `ask ${id}`, output, commands: [] };
}

// Five, so "the newest three" and "all of them" are different lists: with
// three turns a collapsed region and an expanded one look identical and the
// test proves nothing.
const DECISIONS = [
  decision('d5', null),
  decision('d4'),
  decision('d3'),
  decision('d2'),
  decision('d1'),
];

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: 'board',
  status: 'waiting',
  runningAgents: 2,
  activity: 'just now',
  age: '12m',
  decisions: DECISIONS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    // The newest turn, which is the one the canvas focuses by default.
    decision: DECISIONS[0] as Decision,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    onPickCommand: () => {},
    onCopyCommand: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const progress = () => q<HTMLElement>('[data-detail-block="progress"]');
const turns = () => all('[data-progress-turn]');
const toggle = () => q<HTMLButtonElement>('[data-progress-toggle]');

afterEach(cleanup);

describe('the progress region shows nothing until it is opened', () => {
  // Seven turns, so "the newest five" and "all of them" are different lists.
  const MANY = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map((id) => decision(id));
  const manyEntry: SessionEntry = {
    project: PROJECT,
    session: { ...SESSION, decisions: MANY },
  };

  it('draws no turn collapsed, the newest five expanded, and says which it is', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    // Zero, per the operator: collapsed, `progress` is its rule and its toggle
    // and nothing else, so the height it costs goes to `out`.
    expect(turns()).toHaveLength(0);
    // And no empty box either — the list is not rendered at all, so the
    // section cannot leave a bordered gap where its content would be.
    expect(progress()?.querySelector('ul')).toBeNull();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle()?.click());
    // The five most RECENT, not all seven, and ordered oldest-first like the
    // ribbon: the last line is the newest turn.
    expect(turns()).toHaveLength(5);
    expect(turns()[4]?.textContent).toContain('step d7');
    expect(turns()[0]?.textContent).toContain('step d3');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

    act(() => toggle()?.click());
    expect(turns()).toHaveLength(0);
  });

  it('keeps the three-region structure the pane already earned', () => {
    draw();
    // A real <button>, so Enter and Space work with no new global binding and
    // no key stolen from the modal keymap.
    expect(toggle()?.tagName).toBe('BUTTON');
    // Regressions guarded elsewhere, restated here because this change is the
    // one most likely to eat them: still flex-none, and once open the list is
    // its own scroller rather than growing the pane.
    expect(progress()?.className).toContain('flex-none');
    act(() => toggle()?.click());
    expect(progress()?.querySelector('.vam-no-scrollbar')?.className).toContain('overflow-y-auto');
  });
});

describe('the pane drops the status line under the tab bar', () => {
  it('says nothing in prose, and still says it with the status dot', () => {
    draw();
    // The operator asked for the banner under the tabs to go. Nothing is lost
    // with it: the same `waiting` status is what makes the header dot amber
    // and breathe, two lines above where the sentence used to be.
    expect(document.body.textContent).not.toContain('waiting on you');
    expect(q<HTMLElement>('.vam-breathe.bg-waiting')).not.toBeNull();

    cleanup();
    draw({ entry: { project: PROJECT, session: { ...SESSION, status: 'running' } } });
    expect(q<HTMLElement>('.vam-breathe.bg-waiting')).toBeNull();
  });
});

describe('the pane wears the mockup’s own background', () => {
  it('uses the sidebar token, the pane colour measured off both artboards', () => {
    draw();
    // #171717 dark / #f0eeea light in the mockup — exactly `--vam-sidebar`,
    // so this is an existing token rather than a new one.
    const aside = q<HTMLElement>('[data-action-pane]');
    expect(aside?.className).toContain('bg-sidebar');
    expect(aside?.className).not.toContain('bg-sunken');
  });
});

describe('the composer is multiline, and honest about what its button does', () => {
  it('is a textarea with a record button, and no i / I notes', () => {
    draw();
    const box = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(box).not.toBeNull();
    expect(document.querySelector('input[aria-label="prompt to session"]')).toBeNull();

    // The button exists and never uses the word `send`: black-smith records a
    // prompt into the session log, it cannot hand it to a running agent.
    const button = q<HTMLButtonElement>('[data-prompt-record]');
    expect(button?.tagName).toBe('BUTTON');
    const claims = `${button?.getAttribute('aria-label')} ${button?.getAttribute('title')} ${button?.textContent}`;
    expect(claims.toLowerCase()).toContain('record');
    expect(claims.toLowerCase()).not.toContain('send');

    // The two hint notes the operator asked to lose.
    const footer = q<HTMLElement>('[data-action-pane]')?.textContent ?? '';
    expect(footer).not.toContain('i type · I pane');
    expect(footer).not.toContain('i reason · Enter act');
  });

  it('records on Enter and takes a newline on Shift+Enter', () => {
    let submitted = 0;
    draw({
      composing: true,
      onSubmit: () => {
        submitted += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(submitted).toBe(1);

    // Shift+Enter is the newline the box became multiline to allow, so it must
    // not also be the key that files the prompt.
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(submitted).toBe(1);
  });

  it('clicking record files the draft', () => {
    let submitted = 0;
    draw({
      draft: 'do it again',
      onSubmit: () => {
        submitted += 1;
      },
    });
    act(() => q<HTMLButtonElement>('[data-prompt-record]')?.click());
    expect(submitted).toBe(1);
  });
});

describe('the row under the composer is the mockup’s mode row', () => {
  it('replaces the slash tags with mode pills and a shift+Tab tag', () => {
    draw();
    const row = q<HTMLElement>('[data-mode-row]');
    expect(row).not.toBeNull();
    expect(all('[data-mode-pill]').map((el) => el.textContent)).toEqual(['Auto', 'Manual', 'Plan']);
    // The slash tags this row replaced.
    expect(row?.textContent).not.toContain('/diff');
    expect(document.querySelector('[data-placeholder="slash-diff"]')).toBeNull();

    // At the right-hand end of the same row, per the operator's request; the
    // mockup carries a `Tab / cycle mode` tag in the same slot.
    const tag = q<HTMLElement>('[data-mode-cycle]');
    expect(tag).not.toBeNull();
    expect(row?.contains(tag as Node)).toBe(true);
    expect(tag?.textContent).toContain('Tab');
    // A shift glyph is an image, and an aria-label on a bare <span> is dropped
    // in silence — `role="img"` is what makes it announced at all.
    expect(tag?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('shift');
  });
});

describe('there is a way out of the prompt box without a mouse', () => {
  it('Escape gives the keyboard back, and does not leave DOM focus behind', () => {
    let left = 0;
    draw({
      composing: true,
      onStopComposing: () => {
        left += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    // `composing` focuses the box, which is the state the operator gets stuck
    // in: while it holds DOM focus the window listener returns early on every
    // key, so no navigation key reaches the sidebar at all.
    expect(document.activeElement).toBe(box);

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(left).toBe(1);
    // Clearing `composing` alone is not enough: it only makes the box
    // read-only. Until it is blurred the keys still land on it and vanish.
    expect(document.activeElement).not.toBe(box);
  });

  it('says how to get out, in the box, while you are in it', () => {
    draw({ composing: true });
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('Esc');
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('sidebar');
    // Not clutter the rest of the time: the way out only matters once you are
    // in, and this row is already carrying four things at 408px.
    cleanup();
    draw({ composing: false });
    expect(q<HTMLElement>('[data-prompt-escape]')).toBeNull();
  });
});

describe('the regions are capped in lines, and `out` gets what they give up', () => {
  it('caps `in` at two rendered lines of its own body text', () => {
    draw();
    const box = q<HTMLElement>('[data-detail-scroll="in"]');
    expect(box).not.toBeNull();
    // Two lines of 12px/1.55 plus the box's own 10px padding and 1px border.
    // A number, not a percentage: "two lines" is a promise about the text,
    // and a percentage of the pane is a promise about the window.
    expect(box?.style.maxHeight).toBe('59px');
    // Still a scroller — capped, not clipped: the rest is one drag away.
    expect(box?.className).toContain('overflow-y-auto');
  });

  it('gives `out` the height the other two gave up', () => {
    draw();
    const out = q<HTMLElement>('[data-detail-block="out"]');
    expect(out?.className).toContain('flex-1');
    expect(q<HTMLElement>('[data-detail-scroll="out"]')).not.toBeNull();
  });
});

describe('the out text is formatted, not a flat wall', () => {
  it('splits the adapter’s newline-joined answers into one block each', () => {
    // What `toDecisions` actually produces: one summarised answer per line,
    // each `eventType · taskId · detail`.
    draw({
      decision: {
        id: 'd5',
        label: 'step d5',
        input: 'ask',
        output: 'task.completed · t-4 · wrote the migration\nnote.added · t-4 · needs review',
        commands: [],
      },
    });
    const lines = all('[data-out-line]');
    expect(lines).toHaveLength(2);
    // The machine-ish head is monospace and carries the mockup's emphasis
    // colour (#ededed dark / #18181b light = `ink`); the prose stays at the
    // measured body colour (#a1a1a1 / #52525b = `ink-dim`).
    const head = lines[0]?.querySelector('[data-out-head]');
    expect(head?.textContent).toBe('task.completed · t-4');
    expect(head?.className).toContain('font-mono');
    expect(head?.className).toContain('text-ink');
    expect(lines[0]?.querySelector('[data-out-body] p')?.className).toContain('text-ink-dim');
    expect(lines[1]?.textContent).toContain('needs review');
  });

  it('leaves an output with no separator as a single readable block', () => {
    draw({
      decision: { id: 'd5', label: 'l', input: 'i', output: 'just words', commands: [] },
    });
    const lines = all('[data-out-line]');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe('just words');
    expect(lines[0]?.querySelector('[data-out-head]')).toBeNull();
  });
});

/**
 * The `out` region renders GitHub-flavoured markdown, per the operator.
 *
 * Two things are being asserted at once here and they pull in opposite
 * directions: an agent's answer should READ like the markdown it was written
 * as, and an agent's answer is untrusted text that must not be able to run
 * anything or fetch anything. `react-markdown` with no `rehype-raw` is what
 * buys both, and the tests below hold that line rather than assuming it.
 */
describe('the out region renders the agent’s markdown', () => {
  const withOutput = (output: string) =>
    draw({ decision: { id: 'd5', label: 'l', input: 'i', output, commands: [] } });

  it('keeps a multi-line answer whole instead of one block per newline', () => {
    // The adapter joins summarised answers with a newline, so a newline is
    // AMBIGUOUS: it separates two answers, and it is also every line break
    // inside one answer's own text. A fence or a table would be shredded by
    // splitting on it, so a block breaks only where a new answer's head sits.
    expect(
      splitAnswers('task.done · t-1 · here:\n```\nrun me\n```\nnote.added · t-1 · done'),
    ).toEqual(['task.done · t-1 · here:\n```\nrun me\n```', 'note.added · t-1 · done']);
    // Prose that merely mentions the separator mid-sentence is not a new
    // answer: a head is one bare token and then the separator.
    expect(splitAnswers('one\nand two · three')).toEqual(['one\nand two · three']);
    expect(splitAnswers('  \n\n')).toEqual([]);
  });

  it('renders headings, emphasis, lists and gfm tables', () => {
    withOutput(
      '## heading\n\n**bold** and ~~struck~~\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |',
    );
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('h2')?.textContent).toBe('heading');
    expect(out.querySelector('strong')?.textContent).toBe('bold');
    // Strikethrough is gfm, not core markdown: it is the cheapest proof that
    // `remark-gfm` is actually plugged in and not merely installed.
    expect(out.querySelector('del')?.textContent).toBe('struck');
    expect(out.querySelectorAll('li')).toHaveLength(2);
    // The pane is resizable and 408px by default, so the two elements that
    // have no width of their own scroll inside their own box rather than
    // widening the pane.
    const table = out.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
  });

  it('scrolls a fenced block sideways rather than widening the pane', () => {
    withOutput('```sh\necho a-very-long-command-that-does-not-wrap\n```');
    const pre = q<HTMLElement>('[data-detail-scroll="out"] pre');
    expect(pre).not.toBeNull();
    expect(pre?.className).toContain('overflow-x-auto');
    // Wrapping a fence is worse than scrolling it: a wrapped command line
    // reads as two commands.
    expect(pre?.className).not.toContain('whitespace-pre-wrap');
  });

  it('renders none of the raw HTML an untrusted answer may carry', () => {
    // This is the reason the library was chosen: it parses markdown into
    // React elements and drops embedded HTML unless `rehype-raw` is added,
    // which it is not and must not be. `out` is an agent's text and vam has
    // no way to know what produced it.
    withOutput('before <img src="x" onerror="boom"> <script>bad()</script> after');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('img')).toBeNull();
    expect(out.querySelector('script')).toBeNull();
    // It is not dropped, it is defused: the tags arrive as escaped TEXT, so
    // the markup carries `&lt;img` and no element and no attribute. This is
    // the assertion that would fail the day someone adds `rehype-raw` — it
    // cannot fail against a plain-text renderer, which is the point: it is a
    // standing guard, not a claim that today's rendering changed anything.
    expect(out.innerHTML).toContain('&lt;img');
    expect(out.textContent).toContain('before');
    expect(out.textContent).toContain('after');
  });

  it('shows a markdown image as its words, and never fetches it', () => {
    // An image URL in an agent's answer is a remote fetch that would tell
    // whoever wrote the answer that this pane opened, and when.
    withOutput('![a chart](https://example.com/pixel.png)');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('img')).toBeNull();
    expect(out.textContent).toContain('a chart');
    // And the syntax itself is consumed rather than printed: without this the
    // assertions above pass on any renderer that shows the source text.
    expect(out.textContent).not.toContain('![');
  });

  it('prints a link’s address instead of offering a click that goes nowhere', () => {
    // The shell denies `window.open` and every off-origin navigation
    // (src/main/index.ts), which is the right policy and makes an <a> here a
    // control that silently does nothing. The address is shown instead, in a
    // pane where text is selectable, so it can be copied and opened by hand.
    withOutput('see [the docs](https://example.com/x) for more');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('a')).toBeNull();
    expect(out.textContent).toContain('the docs');
    expect(out.textContent).toContain('https://example.com/x');
    // Same guard: the brackets are gone, so this cannot pass on raw text.
    expect(out.textContent).not.toContain('](');
  });
});

describe('the in and out rules wear the mockup’s own glyphs', () => {
  it('is a user for in and a bot for out, announced rather than drawn only', () => {
    draw();
    // Measured off the Response artboards: `in` is a head-and-shoulders glyph,
    // `out` is a bot (antenna, two eyes, a mouth) — not the arrows vam had.
    // `role="img"` is what makes the label announced at all; on a bare <span>
    // aria-label is dropped in silence.
    const inIcon = q<HTMLElement>('[data-detail-block="in"] [role="img"]');
    const outIcon = q<HTMLElement>('[data-detail-block="out"] [role="img"]');
    expect(inIcon?.getAttribute('aria-label')).toContain('you');
    expect(outIcon?.getAttribute('aria-label')).toContain('agent');
  });
});

describe('the attachment button inlines a file into the text that gets recorded', () => {
  const file = (over: Partial<AttachedFile> = {}): AttachedFile => ({
    name: 'notes.md',
    size: 12,
    text: 'hello\nthere',
    ...over,
  });

  it('wraps the contents in a named block appended to the draft', () => {
    const result = attachIntoDraft('please read this', file());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toContain('please read this');
    expect(result.draft).toContain('--- attached: notes.md ---');
    expect(result.draft).toContain('hello\nthere');
    expect(result.draft).toContain('--- end attached ---');
    // And the block is what the chip and the remove button read back.
    expect(readAttachedName(result.draft)).toBe('notes.md');
    expect(detachFromDraft(result.draft)).toBe('please read this');
  });

  it('refuses a file bigger than the inline limit, and says the limit', () => {
    const result = attachIntoDraft('', file({ size: ATTACH_LIMIT_BYTES + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('64 KB');
    expect(result.message).toContain('notes.md');
  });

  it('refuses a file it could not decode rather than inlining the wreckage', () => {
    // What `File.text()` hands back for bytes that are not UTF-8: the
    // replacement character. Inlining that writes noise into a log that is
    // append-only, so it is refused with a sentence instead.
    const result = attachIntoDraft('', file({ text: 'PK��' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('text');
  });

  it('takes one file at a time, and says which one is in the way', () => {
    const first = attachIntoDraft('ask', file());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = attachIntoDraft(first.draft, file({ name: 'other.txt' }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toContain('notes.md');
  });

  it('reads nothing back out of a draft that merely mentions the words', () => {
    expect(readAttachedName('I attached: nothing at all')).toBeNull();
    expect(detachFromDraft('plain text')).toBe('plain text');
  });
});

describe('the model field writes the request into the prompt, and claims nothing more', () => {
  it('puts the request on its own leading line, and round-trips it', () => {
    const withModel = setModelRequest('redo the gate', 'opus');
    expect(withModel.startsWith('model: opus\n')).toBe(true);
    expect(withModel).toContain('redo the gate');
    expect(readModelRequest(withModel)).toBe('opus');
  });

  it('replaces rather than stacks, and clears away cleanly', () => {
    const once = setModelRequest('redo the gate', 'opus');
    const twice = setModelRequest(once, 'sonnet');
    expect(readModelRequest(twice)).toBe('sonnet');
    expect(twice).not.toContain('opus');
    expect(setModelRequest(twice, '')).toBe('redo the gate');
    expect(readModelRequest('redo the gate')).toBe('');
  });
});

describe('the composer draws both controls, and both do something', () => {
  it('opens a real file input, shows the name, and takes it back off', () => {
    let draft = '';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft: 'ask', onDraftChange });
    const button = q<HTMLButtonElement>('[data-attach]');
    expect(button?.tagName).toBe('BUTTON');
    expect(q<HTMLInputElement>('input[type="file"]')).not.toBeNull();
    // The note is no longer a `title`: a title never appears on keyboard focus,
    // and this is a keyboard-first tool.
    expect(button?.getAttribute('title')).toBeNull();
    expect(button?.getAttribute('data-note')).toContain('into the prompt text');

    cleanup();
    // With a file already inlined, the chip names it and offers it back.
    draw({ draft: attachOk('ask', { name: 'plan.md', size: 4, text: 'x' }), onDraftChange });
    expect(q<HTMLElement>('[data-attach-chip]')?.textContent).toContain('plan.md');
    act(() => q<HTMLButtonElement>('[data-attach-remove]')?.click());
    expect(draft).toBe('ask');
  });

  it('drives the model request off the draft itself, not a second copy', () => {
    let draft = 'model: opus\nredo it';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft, onDraftChange });
    const field = q<HTMLInputElement>('[data-model-request]');
    expect(field?.value).toBe('opus');
    expect(field?.getAttribute('data-note')).toContain('cannot');
    // `fireEvent.change`, not a hand-built event: React tracks an input's last
    // value and swallows an event whose value it set itself.
    if (field !== null) fireEvent.change(field, { target: { value: 'sonnet' } });
    expect(draft).toBe('model: sonnet\nredo it');
  });
});

describe('the out region offers the two jumps that would do something', () => {
  it('offers `to top` only with content above and `to bottom` only with content below', () => {
    expect(hasContentAbove({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 })).toBe(false);
    expect(hasContentAbove({ scrollTop: 40, scrollHeight: 900, clientHeight: 300 })).toBe(true);
    expect(hasContentBelow({ scrollTop: 40, scrollHeight: 900, clientHeight: 300 })).toBe(true);
    expect(hasContentBelow({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 })).toBe(false);
    // A region shorter than its own box offers neither: a control that scrolls
    // nowhere is worse than no control.
    const short = { scrollTop: 0, scrollHeight: 200, clientHeight: 300 };
    expect(hasContentAbove(short)).toBe(false);
    expect(hasContentBelow(short)).toBe(false);
  });

  it('uses the same slack as the stick rule, so `to bottom` and stuck agree', () => {
    const nearly = { scrollTop: 590, scrollHeight: 900, clientHeight: 300 };
    expect(isAtBottom(nearly)).toBe(true);
    expect(hasContentBelow(nearly)).toBe(false);
  });
});

/**
 * The mode pills, and the composer's missing caret.
 *
 * The pills were inert `<span>`s. They are buttons now, and what they change
 * is the prompt text — black-smith has no per-session mode to switch, so a
 * control that only moved vam's own highlight would look like it worked and
 * do nothing.
 */
describe('the mode pills select, and what they select gets recorded', () => {
  const pill = (name: string) => q<HTMLButtonElement>(`[data-mode-pill="${name}"]`);

  it('writes the chosen mode into the draft as a leading line', () => {
    const seen: string[] = [];
    draw({ draft: 'ship it', onDraftChange: (next) => seen.push(next) });
    act(() => {
      pill('plan')?.click();
    });
    expect(seen).toEqual(['mode: Plan\nship it']);
  });

  it('clears the line when the default mode is chosen, rather than writing "unchanged"', () => {
    const seen: string[] = [];
    draw({ draft: 'mode: Plan\nship it', onDraftChange: (next) => seen.push(next) });
    act(() => {
      pill('auto')?.click();
    });
    expect(seen).toEqual(['ship it']);
  });

  it('shows the selection from the draft, not from a copy of it', () => {
    draw({ draft: 'mode: Manual\nship it' });
    expect(pill('manual')?.getAttribute('aria-pressed')).toBe('true');
    expect(pill('auto')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads Auto for a draft with no mode line at all', () => {
    draw({ draft: 'ship it' });
    expect(pill('auto')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets a model request and a mode request coexist', () => {
    // The hazard this pins: both readers were anchored at offset 0, so
    // whichever header was written SECOND sat on top and hid the first from
    // its own regex. Two headers is the only input that shows it.
    const both = setModeRequest(setModelRequest('ship it', 'opus'), 'Plan');
    expect(readModelRequest(both)).toBe('opus');
    expect(readModeRequest(both)).toBe('Plan');
    expect(both).toContain('ship it');
  });

  it('drops the caret that used to sit in front of the composer', () => {
    draw({ draft: '' });
    const composer = q<HTMLElement>('[aria-label="prompt to session"]')?.parentElement;
    expect(composer).not.toBeNull();
    expect(composer?.textContent).not.toContain('\u276f');
  });
});

describe('the empty tabs carry no tooltip, and the other notes stay', () => {
  it('drops the tab note without touching the mode, attach or model notes', () => {
    draw();
    const tabs = all('[data-placeholder^="tab-"]');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      // No note, and therefore no reason to be a focus stop either: a button
      // that does nothing and explains nothing is a keyboard trap with a hover
      // state.
      expect(tab.closest('[data-note]')).toBeNull();
      expect(tab.closest('button')).toBeNull();
    }
    // The three the operator asked to KEEP.
    expect(q<HTMLElement>('[data-attach]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-model-request]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-mode-row] [data-note]')).not.toBeNull();
  });
});

/**
 * The option picker the mockup draws above the composer (artboard 1a dark,
 * `ADE Session Canvas.dc.html` lines 1515-1554).
 *
 * Read the component's own doc before reading these: nothing in
 * `domain/model.ts` expresses "the agent asked a question with numbered
 * options", so what is under test is a LAYOUT fed by a declared placeholder.
 * The assertions are therefore about geometry, marking and keyboard reach —
 * never about a value having come from a session.
 */
describe('the option picker is the mockup layout over a declared placeholder', () => {
  const box = () => q<HTMLElement>('[data-approval]');
  const options = () => all('[data-approval-option]');

  it('draws the header, three option cards and the pick hint, marked as a placeholder', () => {
    draw();
    // Marked in the markup, exactly like the tab bar's unbacked tabs: a reader
    // of the DOM can tell this holds no session data.
    expect(box()?.getAttribute('data-placeholder')).toBe('approval-options');
    // `waiting <age>` is the one real value in the header — the session's own.
    expect(box()?.textContent).toContain('waiting 12m');

    expect(options()).toHaveLength(3);
    // The badges count from one, which is what the hint promises.
    expect(options().map((o) => o.querySelector('[data-approval-number]')?.textContent)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(box()?.textContent).toContain('1–3 to pick');

    // The suggested card carries the pill; the others carry the enter glyph.
    expect(options()[0]?.getAttribute('data-suggested')).toBe('true');
    expect(options()[0]?.textContent).toContain('SUGGESTED');
    expect(options()[1]?.getAttribute('data-suggested')).toBeNull();
    expect(options()[2]?.textContent).toContain('↵');
  });

  it('marks the cursor separately from the suggestion — two facts, two treatments', () => {
    draw();
    const [first, second] = options();
    // The cursor opens on the first card, which is also the suggested one, so
    // the two markings are proved apart by MOVING it.
    fireEvent.focus(second as Element);
    expect(second?.getAttribute('data-focused')).toBe('true');
    expect(first?.getAttribute('data-focused')).toBeNull();
    // And the suggestion did not move with it.
    expect(first?.getAttribute('data-suggested')).toBe('true');
    expect(second?.getAttribute('data-suggested')).toBeNull();
    // The two treatments are not the same class either: a shared one would
    // make "the agent suggests this" and "your cursor is here" one signal.
    expect(second?.className).not.toBe(first?.className);
  });

  it('is reachable and activatable without a mouse, and a digit picks directly', () => {
    const drafts: string[] = [];
    draw({ onDraftChange: (value) => drafts.push(value) });
    // Real buttons, so Tab reaches them and Enter/Space activate them without
    // a single new key binding.
    expect(options().every((o) => o.tagName === 'BUTTON')).toBe(true);

    act(() => (options()[1] as HTMLButtonElement).click());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toBe(options()[1]?.querySelector('[data-approval-title]')?.textContent);

    // The mockup's own hint is `1-3 to pick`, so a digit typed while the
    // picker holds the keyboard picks that card.
    fireEvent.keyDown(options()[0] as Element, { key: '3' });
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toBe(options()[2]?.querySelector('[data-approval-title]')?.textContent);

    // A digit past the end of the list does nothing rather than wrapping.
    fireEvent.keyDown(options()[0] as Element, { key: '7' });
    expect(drafts).toHaveLength(2);
  });

  it('appears only while the session is the one waiting on you', () => {
    draw({ entry: { project: PROJECT, session: { ...SESSION, status: 'running' } } });
    expect(box()).toBeNull();
  });
});

describe('the composer says what the session’s source actually does', () => {
  const claims = () => {
    const button = q<HTMLButtonElement>('[data-prompt-record]');
    return `${button?.getAttribute('aria-label')} ${button?.getAttribute('title')}`.toLowerCase();
  };

  it('says send, not record, once the source delivers into a running agent', () => {
    draw({ delivers: true });
    expect(claims()).toContain('send');
    expect(claims()).not.toContain('record');
  });

  it('keeps the recording wording when the source only records, and when nothing said', () => {
    draw({ delivers: false });
    expect(claims()).toContain('record');
    expect(claims()).not.toContain('send');
    cleanup();
    draw();
    expect(claims()).toContain('record');
    expect(claims()).not.toContain('send');
  });
});

describe('the surface the picker sits on is a token pair, not a dark-only hex', () => {
  it('defines --vam-lifted in both themes', () => {
    // `import.meta.url` is not a file URL under happy-dom, so the path is
    // resolved from the runner's own root instead.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const dark = css.slice(css.indexOf(':root {'), css.indexOf('html.light {'));
    const light = css.slice(css.indexOf('html.light {'));
    expect(dark).toContain('--vam-lifted:');
    expect(light).toContain('--vam-lifted:');
  });
});

/*
 * The `x/y` step counter and its expandable note had tests here.
 *
 * The whole row above the tabs — counter, note and age — was removed at the
 * operator's request, after the per-turn tick strip that preceded it. Nothing
 * it showed lives only there: the focused step is named at the right of the
 * title row, the turn count is the `progress` section's own counter, and the
 * age is on the sidebar card and the canvas. There is no element left to
 * assert against, so the tests go with the row rather than being rewritten
 * into assertions about its absence.
 */
