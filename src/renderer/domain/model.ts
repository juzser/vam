/**
 * The domain vocabulary now lives in `src/shared/model.ts` -- it is a
 * cross-process contract, not something belonging to the renderer alone.
 * This path is kept as a type-only re-export so the renderer's own
 * importers, and the tests that import from here, keep compiling unchanged.
 */

export type {
  AgentQuestion,
  CanvasBudget,
  CanvasModel,
  Command,
  Decision,
  Group,
  Project,
  PullRequest,
  PullRequestChecks,
  PullRequestList,
  PullRequestMergeable,
  PullRequestReview,
  QuestionOption,
  Session,
  SessionAgent,
  SessionOrigin,
  SessionStatus,
  SlashCommand,
  SourceId,
  TurnStep,
} from '../../shared/model.js';
