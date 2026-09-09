/**
 * What main needs from a source to answer the bridge.
 *
 * Deliberately smaller than the renderer's `SessionSource`: main never
 * assembles the port's shape -- that happens renderer-side, in
 * `createSourceFromPreload`, from the descriptor this carries. Main's job is
 * to hold the data and answer two questions, so this is exactly the two.
 *
 * Both imports are TYPE-ONLY. Nothing under `src/renderer/` may be a runtime
 * import from main (AC-16a): types are erased at build time, values are not.
 */

import type { Project } from '../../renderer/domain/model.js';
import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import type { SourceDescriptor } from '../../shared/preload-api.js';
import type { SourceError } from '../ipc/channels.js';

export type MainSource = {
  readonly descriptor: SourceDescriptor;
  load(): Promise<readonly Project[]>;
  /**
   * The write surface, present only on a source that can actually write.
   * Optional because most cannot: the descriptor's `recordPrompt` capability
   * is what a consumer reads, and this is what main calls once it is true.
   *
   * RESOLVES to a `SourceError`, never throws one. A thrown error reaches the
   * handler's catch-all and comes back as `unreachable/source-failed`, which
   * would flatten the one outcome that matters most here -- a refusal naming
   * the busy session and the command that frees it -- into a generic failure.
   * Returning the error keeps its `kind`, `code` and message intact.
   */
  recordPrompt?(sessionId: string, prompt: string): Promise<SourceError | null>;
  /**
   * Stop a session, present only on a source that really can. Same contract
   * as `recordPrompt`: it RESOLVES to the `SourceError`, so a refusal --
   * "this one is a terminal you are sitting in" -- keeps its code and its
   * words instead of being flattened into `unreachable/source-failed`.
   */
  /** `force` is the confirmed kill-anyway route -- see `SourceWrites.closeSession`. */
  closeSession?(sessionId: string, force?: boolean): Promise<SourceError | null>;
  /**
   * Start a new session in a project, present only on a source that really
   * can. Same contract again: it RESOLVES to the `SourceError`, so "vam
   * cannot tell which directory that project is" survives as its own code
   * instead of becoming `unreachable/source-failed`.
   */
  createSession?(projectId: string, title: string, provider?: string): Promise<SourceError | null>;
  /**
   * Start a session in a DIRECTORY the operator just chose, which no project
   * id names yet -- the "new project" path. Advertised by the same
   * `createSession` capability, and under the same resolve-never-throw
   * contract, so "that directory is gone" keeps its own code.
   */
  createSessionInDirectory?(
    cwd: string,
    title: string,
    provider?: string,
  ): Promise<SourceError | null>;
  /**
   * The turns BEFORE a point in a session -- scrolling back, which `load()`
   * deliberately cannot do: it reads a fixed tail per session so the poll stays
   * cheap, and the median session is three times that tail.
   *
   * NOT GATED BY A CAPABILITY BOOLEAN, and that is deliberate. `TranscriptPage`
   * already carries its own `unavailable` arm with the source's own words, so a
   * source without a surface says so in the answer -- the same shape `PaneView`
   * and `AgentsResult` use. Adding a thirteenth flag to `SourceCapabilities`
   * would gate an affordance the canvas does not yet draw, which that type's
   * own doc forbids.
   *
   * RESOLVES, never throws, like every member above: the reason a page could
   * not be read is the whole content of the failure, and a thrown error would
   * arrive as `unreachable/source-failed` with that reason rewritten.
   */
  readHistory?(sessionId: string, cursor: HistoryCursor | null): Promise<TranscriptPage>;
};
