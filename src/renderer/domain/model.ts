/**
 * The domain vocabulary now lives in `src/shared/model.ts` -- it is a
 * cross-process contract, not something belonging to the renderer alone.
 * This path is kept as a type-only re-export so the renderer's own
 * importers, and the tests that import from here, keep compiling unchanged.
 */

export type {
  SourceId,
  SessionStatus,
  Decision,
  TurnStep,
  Command,
  SlashCommand,
  SessionOrigin,
  SessionAgent,
  PullRequestChecks,
  PullRequestReview,
  PullRequestMergeable,
  PullRequest,
  PullRequestList,
  QuestionOption,
  AgentQuestion,
  Session,
  Project,
  Group,
  CanvasBudget,
  CanvasModel,
} from '../../shared/model.js';
