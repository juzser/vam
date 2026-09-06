// @vitest-environment happy-dom

/**
 * The desktop image-attach control.
 *
 * `pickImageAttachment` does the picking AND the validation in one main-side
 * round trip (`main/dialog/attach-image.ts`) -- outside the session's own
 * directory, or content that is not really an image, both come back as a
 * REJECTION, before the draft this pane holds is ever touched. So every
 * refusal test here asserts two things together: the draft is unchanged, and
 * `onSubmit` was never called -- a test that only read the error message
 * would pass even if the turn had already been sent.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
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

afterEach(cleanup);

describe('the image-attach control is absent unless a source can reach main for it', () => {
  it('draws no button when pickImageAttachment is undefined -- the browser build and a declining source both read this way', () => {
    draw({ pickImageAttachment: undefined });
    expect(q('[data-attach-image]')).toBeNull();
  });

  it('draws the button once a source hands over a real picker', () => {
    draw({ pickImageAttachment: async () => null });
    expect(q<HTMLButtonElement>('[data-attach-image]')?.tagName).toBe('BUTTON');
  });
});

describe('picking a valid image inside the session directory', () => {
  it('appends the resolved path to the draft and shows no error', async () => {
    let draft = 'take a look';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    const onSubmit = vi.fn();
    const pickImageAttachment = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe('s1');
      return '/work/session/pic.png';
    });
    draw({ draft, onDraftChange, onSubmit, pickImageAttachment });

    await act(async () => {
      q<HTMLButtonElement>('[data-attach-image]')?.click();
      await Promise.resolve();
    });

    expect(draft).toBe('take a look\n/work/session/pic.png');
    expect(q('[data-attach-error]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cancelling the dialog changes nothing', async () => {
    let draft = 'ask';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft, onDraftChange, pickImageAttachment: async () => null });

    await act(async () => {
      q<HTMLButtonElement>('[data-attach-image]')?.click();
      await Promise.resolve();
    });

    expect(draft).toBe('ask');
    expect(q('[data-attach-error]')).toBeNull();
  });

  it('the remove chip takes the path back off, keeping the rest of the draft', async () => {
    let draft = 'take a look';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft, onDraftChange, pickImageAttachment: async () => '/work/session/pic.png' });

    await act(async () => {
      q<HTMLButtonElement>('[data-attach-image]')?.click();
      await Promise.resolve();
    });
    expect(q<HTMLElement>('[data-attach-image-chip]')?.textContent).toContain(
      '/work/session/pic.png',
    );

    act(() => q<HTMLButtonElement>('[data-attach-image-remove]')?.click());
    expect(draft).toBe('take a look');
  });
});

describe('a refusal from pickImageAttachment sends nothing', () => {
  it('a path outside the session directory: draft unchanged, no send', async () => {
    let draft = 'ask';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    const onSubmit = vi.fn();
    const pickImageAttachment = vi.fn(async () => {
      throw {
        kind: 'refused',
        code: 'outside-directory',
        message: '/etc/passwd is outside this session’s own working directory',
      };
    });
    draw({ draft, onDraftChange, onSubmit, pickImageAttachment });

    await act(async () => {
      q<HTMLButtonElement>('[data-attach-image]')?.click();
      await Promise.resolve();
    });

    expect(draft).toBe('ask');
    expect(q<HTMLElement>('[data-attach-error]')?.textContent).toContain('outside');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a text file behind a .png name: draft unchanged, no send', async () => {
    let draft = 'ask';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    const onSubmit = vi.fn();
    const pickImageAttachment = vi.fn(async () => {
      throw {
        kind: 'refused',
        code: 'not-an-image',
        message: 'note.png is not a PNG, JPEG, GIF or WEBP file',
      };
    });
    draw({ draft, onDraftChange, onSubmit, pickImageAttachment });

    await act(async () => {
      q<HTMLButtonElement>('[data-attach-image]')?.click();
      await Promise.resolve();
    });

    expect(draft).toBe('ask');
    expect(q<HTMLElement>('[data-attach-error]')?.textContent).toContain('not a PNG');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
