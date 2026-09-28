/**
 * PROTECTS finding bf5198df's move: `src/shared/model.ts` must exist and
 * export the same types the renderer's `domain/model.ts` re-exports.
 *
 * This does not test behaviour -- the vocabulary is type-only -- so the
 * check is `expectTypeOf(...).toEqualTypeOf<...>()` on each pair, one type
 * imported from each path.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import * as RendererModel from '../../src/renderer/domain/model.js';
// Deliberately NOT `import type`: a type-only import (or one only ever used
// as a type argument) is elided by vitest's esbuild transform before it ever
// resolves the specifier, so the suite would pass vacuously under the null
// (no `src/shared/model.ts` yet). Forcing a real runtime read of the
// namespace object below (`expect(typeof SharedModel)...`) keeps the import
// live so vitest itself resolves the module and fails with a module-
// resolution error naming `src/shared/model.js` when it is missing.
import * as SharedModel from '../../src/shared/model.js';

describe('the renderer shim re-exports the same types src/shared/model.ts declares', () => {
  it('resolves both module paths at runtime', () => {
    expect(typeof SharedModel).toBe('object');
    expect(typeof RendererModel).toBe('object');
  });

  it('Project', () => {
    expectTypeOf<SharedModel.Project>().toEqualTypeOf<RendererModel.Project>();
  });

  it('Session', () => {
    expectTypeOf<SharedModel.Session>().toEqualTypeOf<RendererModel.Session>();
  });

  it('Decision', () => {
    expectTypeOf<SharedModel.Decision>().toEqualTypeOf<RendererModel.Decision>();
  });

  it('SlashCommand', () => {
    expectTypeOf<SharedModel.SlashCommand>().toEqualTypeOf<RendererModel.SlashCommand>();
  });

  it('AgentQuestion', () => {
    expectTypeOf<SharedModel.AgentQuestion>().toEqualTypeOf<RendererModel.AgentQuestion>();
  });

  it('SourceId', () => {
    expectTypeOf<SharedModel.SourceId>().toEqualTypeOf<RendererModel.SourceId>();
  });

  it('CanvasModel', () => {
    expectTypeOf<SharedModel.CanvasModel>().toEqualTypeOf<RendererModel.CanvasModel>();
  });

  it('SessionStatus', () => {
    expectTypeOf<SharedModel.SessionStatus>().toEqualTypeOf<RendererModel.SessionStatus>();
  });

  it('TurnStep', () => {
    expectTypeOf<SharedModel.TurnStep>().toEqualTypeOf<RendererModel.TurnStep>();
  });

  it('Command', () => {
    expectTypeOf<SharedModel.Command>().toEqualTypeOf<RendererModel.Command>();
  });

  it('SessionOrigin', () => {
    expectTypeOf<SharedModel.SessionOrigin>().toEqualTypeOf<RendererModel.SessionOrigin>();
  });

  it('SessionAgent', () => {
    expectTypeOf<SharedModel.SessionAgent>().toEqualTypeOf<RendererModel.SessionAgent>();
  });

  it('PullRequest', () => {
    expectTypeOf<SharedModel.PullRequest>().toEqualTypeOf<RendererModel.PullRequest>();
  });

  it('PullRequestChecks', () => {
    expectTypeOf<SharedModel.PullRequestChecks>().toEqualTypeOf<RendererModel.PullRequestChecks>();
  });

  it('PullRequestReview', () => {
    expectTypeOf<SharedModel.PullRequestReview>().toEqualTypeOf<RendererModel.PullRequestReview>();
  });

  it('PullRequestMergeable', () => {
    expectTypeOf<SharedModel.PullRequestMergeable>().toEqualTypeOf<RendererModel.PullRequestMergeable>();
  });

  it('PullRequestList', () => {
    expectTypeOf<SharedModel.PullRequestList>().toEqualTypeOf<RendererModel.PullRequestList>();
  });

  it('QuestionOption', () => {
    expectTypeOf<SharedModel.QuestionOption>().toEqualTypeOf<RendererModel.QuestionOption>();
  });

  it('Group', () => {
    expectTypeOf<SharedModel.Group>().toEqualTypeOf<RendererModel.Group>();
  });

  it('CanvasBudget', () => {
    expectTypeOf<SharedModel.CanvasBudget>().toEqualTypeOf<RendererModel.CanvasBudget>();
  });
});
