/**
 * WHICH SOURCE A ROW CAME FROM, AND THEREFORE WHAT MAY BE DRAWN ON IT.
 *
 * vam served one source for its whole life, so "what can the app do" and
 * "what can this row do" were the same question and the canvas asked the
 * first one. They stopped being the same the moment a second source arrived:
 *
 *   Claude Code   terminal: true    deliverPrompt: true   (types into a pane)
 *   Codex         terminal: false   deliverPrompt: true   (queues for a thread)
 *
 * Read off `SessionSource.capabilities` -- the OR of everything main serves --
 * a Codex row draws a Terminal tab that can only apologise, and a model picker
 * over a session vam has no keyboard into. Read off the MEMBER whose id is the
 * row's own `Session.source`, both are withdrawn with the Codex source's own
 * words attached.
 *
 * THE FALLBACK IS THE TOP LEVEL AND NOT AN EMPTY SET, and that is the whole
 * subtlety here. `members` is ABSENT when main serves exactly one source, and
 * then the source IS that member (`main/sources/combine.ts` returns a list of
 * one by reference). A reader that treated absence as "no capabilities" would
 * withdraw every affordance from every row on every single-source build --
 * which is every build vam has ever shipped.
 *
 * A row whose `source` names NOBODY falls back the same way, deliberately: a
 * fixture, a demo and a hand-built `Session` all have no `source`, and they
 * are the rows this app is tested with.
 */

import type { SourceId } from '../domain/model.js';
import type { SessionSource, SourceCapabilities, SourceDeclines, SourceMember } from './port.js';

/**
 * What the source serving THIS ROW can do, and its words for what it cannot.
 *
 * `sourceId` is `Session.source` (or `Project.source`), which the adapter
 * stamps on every row it produces.
 */
export function capabilitiesFor(
  source: SessionSource,
  sourceId: SourceId | undefined,
): { readonly capabilities: SourceCapabilities; readonly declines: SourceDeclines } {
  const member = memberFor(source, sourceId);
  return member === null
    ? { capabilities: source.capabilities, declines: source.declines }
    : { capabilities: member.capabilities, declines: member.declines };
}

/** The member serving a row, or `null` to mean "read the top level". */
export function memberFor(
  source: SessionSource,
  sourceId: SourceId | undefined,
): SourceMember | null {
  if (sourceId === undefined || source.members === undefined) return null;
  return source.members.find((member) => member.id === sourceId) ?? null;
}
