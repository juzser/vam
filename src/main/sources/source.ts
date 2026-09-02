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

export type MainSource = {
  readonly descriptor: SourceDescriptor;
  load(): Promise<readonly Project[]>;
};
