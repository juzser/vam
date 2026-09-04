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
  closeSession?(sessionId: string): Promise<SourceError | null>;
};
