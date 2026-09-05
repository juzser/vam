/**
 * The questions a session asked through Claude Code's `AskUserQuestion` tool,
 * read out of the transcript tail.
 *
 * WHY THIS EXISTS AT ALL. An earlier census concluded that no surface vam
 * reads records what a session is asking, and the pane was scoped to stop
 * claiming otherwise. That conclusion was too broad. A FREE-FORM question --
 * one written in prose inside an assistant turn -- genuinely has no structure
 * to read, and this file does not try. A question asked through the TOOL is
 * recorded in full: the text, a short `header`, whether several options may be
 * picked, and every option with its `label` and `description`.
 *
 * OPENNESS IS DERIVED, NEVER GUESSED. A `tool_use` block carries an id; the
 * operator's reply arrives later as a `tool_result` naming that id. So a
 * question is open exactly while no such result exists, and `answer` is that
 * result's text once it does. Nothing here reads mtime, status, or the shape
 * of the last message -- the mistakes the placeholder picker was built on.
 *
 * EVERY LINE IS UNTRUSTED DATA. It is JSON written by another program, read
 * from a byte suffix that can cut a record in half, and a session that asked
 * nothing is the common case. So each rule below drops what it cannot vouch
 * for and returns fewer questions rather than a malformed one, and the whole
 * module is pure: given lines, it returns data.
 */

import type { AgentQuestion, QuestionOption } from '../../../renderer/domain/model.js';

/** A pane draws a list, not a menu; a record offering more is malformed. */
const MAX_OPTIONS = 12;

type Line = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const obj = (v: unknown): Line | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : null;

/** The content parts of a `message`, or an empty list when there are none. */
function parts(line: Line): Line[] {
  const content = obj(line['message'])?.['content'];
  if (!Array.isArray(content)) return [];
  return content.map(obj).filter((part): part is Line => part !== null);
}

function readOption(value: unknown): QuestionOption | null {
  const option = obj(value);
  if (option === null) return null;
  const label = str(option['label']);
  if (label === null) return null;
  return {
    label,
    description: str(option['description']),
    // 127 of 917 options in the operator's own data carry one and it used to
    // be dropped here. NULL RATHER THAN ABSENT, like `description` beside it:
    // the field is always on the type, so a renderer reads one shape whatever
    // the record held, and `null` is "the tool offered none" rather than "vam
    // did not look".
    preview: str(option['preview']),
  };
}

/** One entry of a tool_use's `questions` array, or `null` if unusable. */
function readQuestion(value: unknown, id: string): AgentQuestion | null {
  const raw = obj(value);
  if (raw === null) return null;
  const question = str(raw['question']);
  if (question === null) return null;
  const options = (Array.isArray(raw['options']) ? raw['options'] : [])
    .map(readOption)
    .filter((option): option is QuestionOption => option !== null)
    .slice(0, MAX_OPTIONS);
  // A question with nothing to pick is not one this pane can draw, and vam
  // has no way to type an answer back, so it is dropped rather than shown as
  // an empty card.
  if (options.length === 0) return null;
  return {
    id,
    header: str(raw['header']),
    question,
    // Stated or absent, never inferred: a missing flag is single-select.
    multiSelect: raw['multiSelect'] === true,
    options,
    answer: null,
  };
}

/** The text of a `tool_result`, whichever of its two shapes it arrived in. */
function resultText(part: Line): string | null {
  const content = part['content'];
  if (typeof content === 'string') return str(content);
  if (!Array.isArray(content)) return null;
  const text = content
    .map(obj)
    .filter((block): block is Line => block !== null && block['type'] === 'text')
    .map((block) => str(block['text']) ?? '')
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/**
 * Every `AskUserQuestion` in these lines, oldest first, each carrying the
 * answer it has received or `null` while it is still open.
 */
export function collectQuestions(lines: readonly Line[]): readonly AgentQuestion[] {
  const asked: { toolUseId: string; question: AgentQuestion }[] = [];
  const answers = new Map<string, string | null>();

  for (const line of lines) {
    for (const part of parts(line)) {
      if (part['type'] === 'tool_use' && part['name'] === 'AskUserQuestion') {
        const toolUseId = str(part['id']);
        if (toolUseId === null) continue;
        const list = obj(part['input'])?.['questions'];
        if (!Array.isArray(list)) continue;
        list.forEach((value, index) => {
          // The id is the tool_use's own plus the position, so two questions
          // asked in one call are distinct while sharing that call's openness.
          const question = readQuestion(value, `${toolUseId}:${index}`);
          if (question !== null) asked.push({ toolUseId, question });
        });
      } else if (part['type'] === 'tool_result') {
        const toolUseId = str(part['tool_use_id']);
        // Present-but-unreadable still CLOSES the question: the answer was
        // given, and drawing it as still waiting is the worse error.
        if (toolUseId !== null) answers.set(toolUseId, resultText(part));
      }
    }
  }

  return asked.map(({ toolUseId, question }) =>
    answers.has(toolUseId) ? { ...question, answer: answers.get(toolUseId) ?? '' } : question,
  );
}
