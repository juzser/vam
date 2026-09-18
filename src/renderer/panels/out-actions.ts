/**
 * THE TWO THINGS A CONTROL INSIDE AN AGENT'S ANSWER CAN ASK FOR: open this
 * address in the operator's browser, open this file in the Files tab.
 *
 * A CONTEXT, AND THIS FILE OWES AN ARGUMENT FOR THAT, because vam's rule is
 * that a panel is handed what it needs AT THE CALL SITE -- "a member wired
 * invisibly is one refactor away from being dropped with nothing to notice"
 * (`DetailPanel.tsx`) -- and `history-reader.ts` states the one exception:
 * an APP-WIDE singleton nobody should prop-drill.
 *
 * The argument here is a third one, and it is about react-markdown rather
 * than about taste. `OUT_MARKDOWN` is a module-level constant because it is a
 * PROP: a component map rebuilt on every render is a new object every render,
 * and react-markdown re-renders every element of every answer in the column
 * when it changes. So the components in that map cannot be given anything at
 * a call site -- there is no call site, only a constant -- and a context is
 * the only seam into them that does not cost a re-render of the whole
 * transcript on every keystroke in the composer.
 *
 * THE PROVIDER IS PER PANE, WHICH IS WHERE THESE ACTS BELONG. `DetailPanel`
 * mounts one, closing over the session it is showing: `openFileRef` resolves a
 * relative path against THAT session's own working directory and opens THAT
 * pane's Files tab, so two split panes showing two sessions do not share one.
 * `openLink` has no session in it at all and rides along rather than earning a
 * second provider.
 *
 * THE DEFAULT IS A REFUSAL IN WORDS, NEVER A STUB THAT RESOLVES. A transcript
 * rendered with no provider -- the browser build, a phone, every test fixture
 * written before this existed -- gets a control that says why it cannot act
 * when it is pressed. That is the house rule (`FilesTab.tsx`'s `note`): a
 * control which can only refuse says so, because one that silently does
 * nothing is indistinguishable from a frozen application. A stub that answered
 * `{ok: true}` would be the same silence with a lie on top.
 */

import { createContext, useContext } from 'react';

/**
 * What an act answers: nothing to draw, or the sentence to draw. The same
 * shape `src/shared/link.ts` answers with, minus the URL -- the control
 * already has the address on screen beside it.
 */
export type OutActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type OutActions = {
  /**
   * Opens an address in the operator's own browser. The caller passes the
   * PARSED address (`checkLink`) so that what is opened is what was drawn --
   * and main parses and re-checks it anyway, which is where the guarantee is.
   */
  readonly openLink: (url: string) => Promise<OutActionResult>;
  /**
   * Opens `path:line` -- as the agent wrote it, unparsed -- in this pane's
   * Files tab. The reference is resolved and authorised in MAIN, against the
   * session's own working directory (`src/main/files/resolve-ipc.ts`); the
   * refusal for one that escapes the project or names nothing comes back as
   * the sentence to draw.
   */
  readonly openFileRef: (reference: string) => Promise<OutActionResult>;
};

const NO_BRIDGE: OutActionResult = {
  ok: false,
  reason: 'the vam desktop app is what opens this; this build has no bridge to it.',
};

const Actions = createContext<OutActions>({
  openLink: async () => NO_BRIDGE,
  openFileRef: async () => NO_BRIDGE,
});

/** Publishes one pane's acts to every control drawn inside its answers. */
export const OutActionsProvider = Actions.Provider;

/** The acts, or the refusing default. Never null: see this file's header. */
export function useOutActions(): OutActions {
  return useContext(Actions);
}
