/**
 * A real `AskUserQuestion` picker, captured from Claude Code 2.1.282 at a pane
 * width narrow enough to WRAP its own question line -- the screen behind the
 * operator's report (`docs/design/ref/question-card-report.png`): Submit
 * refused with "the session is not showing Xử lý lesson-raised-b07ef4b15fc4
 * thế nào?" even though that is exactly the question a real session was
 * asking.
 *
 * PROVENANCE, AND WHY IT COST NOTHING. The question and its four options are
 * copied verbatim off a real `~/.claude/projects` transcript that really asked
 * them (a `blacksmith` lesson-triage run). The SCREEN is not that transcript's
 * own, though -- capturing a live picker means a real model turn, and this one
 * was produced for free instead: a throwaway `claude` 2.1.282 process, on a
 * private tmux socket, with `ANTHROPIC_BASE_URL` pointed at a local HTTP stub
 * that answers `POST /v1/messages` with a canned `tool_use` block carrying
 * this exact `AskUserQuestion` call. No request ever reached Anthropic. The
 * operator's own session, tmux socket and pane were never touched.
 *
 * WHAT WAS MEASURED THIS WAY: at 100 columns (and at every width down to 41)
 * the question sits on ONE line and `readPrompt`/`answer.ts`'s own matching
 * already read it correctly -- so neither NFC/NFD normalisation nor the
 * header chip (`☐ Lesson`, new in this version, drawn on its OWN line above
 * the question) is what broke Submit. At 40 columns and narrower, the CLI
 * hard-wraps the question itself, mid-word, with no space inserted at the
 * break -- `LESSON_ASKED` below is that exact capture. vam resizes a
 * session's pane to the Terminal tab's own measured width only once that tab
 * is opened; a session answered purely from the Response view can still be
 * sitting at whatever width it was last left, which on a narrow window or the
 * phone view is well inside the range this reproduces.
 *
 * `LESSON_ON_2` is the same screen one `Down` later, captured from the same
 * live pane -- the cursor moved to option two and nothing else changed measure
 * for measure, which is what lets a test drive the probe-and-step machinery
 * `answer.ts` walks every picker with.
 */

const RULE = '─'.repeat(40);

/** The set opens on its one question, cursor on row one -- 40 columns, wrapped. */
export const LESSON_ASKED = [
  RULE,
  ' ☐ Lesson ',
  '',
  'Xử lý lesson-raised-b07ef4b15fc4 thế ',
  'nào?',
  '',
  '❯ 1. Reject (Khuyến nghị)',
  '     Bug đã được sửa ở #177/#180/#181; ',
  "     câu cảnh báo 'đừng chạy verb này…' ",
  '     giờ không còn đúng. Nguyên tắc ',
  '     chung đã có c617b525443e giữ.',
  '  2. Sửa rồi approve',
  "     Viết lại thành nguyên tắc: 'một ",
  '     default không được phân giải sang ',
  '     tên factory; project không xác định',
  "     phải fail closed'. Câu mới sẽ qua ",
  '     novelty gate.',
  '  3. Approve nguyên văn',
  '     Giữ bản gốc, dù nó mô tả code không',
  '     còn tồn tại.',
  '  4. Để sau',
  '     Không ghi gì, giữ trạng thái ',
  '     candidate.',
  '  5. Type something.',
  RULE,
  '  6. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc ',
  'to cancel',
].join('\n');

/** The same screen after one `Down`: the cursor alone moves to option two. */
export const LESSON_ON_2 = [
  RULE,
  ' ☐ Lesson ',
  '',
  'Xử lý lesson-raised-b07ef4b15fc4 thế ',
  'nào?',
  '',
  '  1. Reject (Khuyến nghị)',
  '     Bug đã được sửa ở #177/#180/#181; ',
  "     câu cảnh báo 'đừng chạy verb này…' ",
  '     giờ không còn đúng. Nguyên tắc ',
  '     chung đã có c617b525443e giữ.',
  '❯ 2. Sửa rồi approve',
  "     Viết lại thành nguyên tắc: 'một ",
  '     default không được phân giải sang ',
  '     tên factory; project không xác định',
  "     phải fail closed'. Câu mới sẽ qua ",
  '     novelty gate.',
  '  3. Approve nguyên văn',
  '     Giữ bản gốc, dù nó mô tả code không',
  '     còn tồn tại.',
  '  4. Để sau',
  '     Không ghi gì, giữ trạng thái ',
  '     candidate.',
  '  5. Type something.',
  RULE,
  '  6. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc ',
  'to cancel',
].join('\n');

/**
 * The screen once the CLI has taken the answer in and moved on -- no numbered
 * row left to parse. Not a live capture (the free stand-in model answers with
 * the same canned `AskUserQuestion` call every turn, so it cannot show vam a
 * real "closed" screen) but the shape a single single-select question's own
 * doc in `answer.ts` says to expect: gone rather than reviewed.
 */
export const LESSON_RESOLVED = [
  '⏺ User answered Claude questions:',
  '  ⎿  · Xử lý lesson-raised-b07ef4b15fc4 thế nào? → Sửa rồi approve',
  '',
].join('\n');
