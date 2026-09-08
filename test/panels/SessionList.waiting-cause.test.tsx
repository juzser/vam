// @vitest-environment happy-dom

/**
 * THE SIDEBAR SAYS WHAT A WAITING ROW WANTS, on the desktop too.
 *
 * The row's third line already existed and already drew `newestAsk`, but it
 * was gated on `phone &&`. The comment that justified suppressing it on the
 * desktop said the sidebar there "sits beside a canvas and a detail pane that
 * answer it" -- and the CANVAS WAS DELETED IN 0.2. The premise is gone, so the
 * gate is gone with it; what remains beside the list is one detail pane
 * showing one session, which is exactly the pane an operator has to open per
 * tab to find the row blocked on a Bash approval.
 *
 * WHY THE CAUSE COMES FIRST. `newestAsk` is the operator's OWN newest prompt
 * echoed back -- it says what the session was set going on, never what it is
 * stuck on, so a row blocked on a permission prompt reads identically to one
 * quietly working. `waitingFor` is the only surface that names the cause. Both
 * are drawn when both exist, cause first, because that is the one an eye
 * scanning four tabs is looking for.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, decision, entriesOf, makeSession } from './session-list-props.js';

afterEach(cleanup);

function mount(over: Partial<Session>, phone = false) {
  const session = makeSession({
    id: 's1',
    status: 'waiting',
    decisions: [decision('d1', 'done')],
    ...over,
  });
  render(<SessionList {...baseProps(entriesOf([session]))} phone={phone} />);
}

const third = () => document.querySelector<HTMLElement>('[data-row-question]');
const cause = () => document.querySelector<HTMLElement>('[data-row-waiting]');

describe('a waiting row names its cause in the desktop sidebar', () => {
  it('draws the cause on the desktop, where the gate used to suppress it', () => {
    mount({ waitingFor: 'permission prompt' });
    expect(cause()?.textContent).toBe('permission prompt');
  });

  it('prints an unfamiliar cause verbatim', () => {
    mount({ waitingFor: 'ratchet inspection' });
    expect(cause()?.textContent).toBe('ratchet inspection');
  });

  it('still draws the prompt the session is working from, beside the cause', () => {
    mount({ waitingFor: 'permission prompt' });
    expect(third()?.textContent).toContain('input');
    expect(third()?.textContent).toContain('permission prompt');
  });

  it('falls back to the prompt alone when the session named no cause', () => {
    mount({ waitingFor: null });
    expect(cause()).toBeNull();
    expect(third()?.textContent).toContain('input');
  });

  it('says nothing at all when a running row has a cause it cannot have', () => {
    // The line belongs to "somebody is blocked on you". A running session is
    // not blocked on anyone, whatever a stale per-process file says.
    mount({ waitingFor: 'permission prompt', status: 'running' });
    expect(cause()).toBeNull();
    expect(third()).toBeNull();
  });

  it('keeps drawing it on the phone, which never had the gate against it', () => {
    mount({ waitingFor: 'permission prompt' }, true);
    expect(cause()?.textContent).toBe('permission prompt');
  });
});
