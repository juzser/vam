/**
 * Which questions were asked TOGETHER.
 *
 * One `AskUserQuestion` call can carry several questions: `collectQuestions`
 * (`main/sources/claude-code/questions.ts`) reads the tool_use's `questions`
 * array and gives each one an id of `<tool_use id>:<position>`, and one
 * `tool_result` closes all of them at once. The set is therefore already in
 * the model, and the pane was drawing ONE of them -- the newest open, which
 * for a two-question call is the SECOND. The first was not on screen at all.
 *
 * The tool_use id is the grouping key, taken back off the id rather than added
 * as a field: it is already there, and a second copy of the same fact is a
 * second thing to keep in step.
 */

import type { AgentQuestion } from '../domain/model.js';

/** The call an id belongs to -- everything before the position it ends with. */
export function toolUseOf(id: string): string {
  const at = id.lastIndexOf(':');
  return at === -1 ? id : id.slice(0, at);
}

/**
 * The set the card draws: the one holding the newest OPEN question, and only
 * if there is none, the one holding the newest answered question.
 *
 * The same rule the single card used, moved up a level -- what is still being
 * asked outranks what was already settled. The questions keep the order the
 * tool asked them in, which is the order the CLI walks them in and therefore
 * the order Submit answers them in.
 */
export function newestSet(questions: readonly AgentQuestion[]): readonly AgentQuestion[] {
  const newest = [...questions].reverse().find((one) => one.answer === null) ?? questions.at(-1);
  if (newest === undefined) return [];
  const call = toolUseOf(newest.id);
  return questions.filter((one) => toolUseOf(one.id) === call);
}
