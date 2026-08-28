/**
 * The canvas from docs/design/canvas-layout.md §3, as data.
 *
 * This exists because §5 says vam's real feed waits on two black-smith epics
 * (SSE, worker heartbeat) that have not landed. Waiting for them to look at the
 * layout would mean designing the hardest part of the UI blind. So the shape is
 * fixed here and the adapters fill it later — and because the canvas only ever
 * sees `CanvasModel`, swapping this for a live adapter changes no component.
 *
 * Three rules keep it honest, and all three are load-bearing for a fixture whose
 * job is to be looked at:
 *
 *  - **A session is one you started.** `factory-sse-1`, `vam-build-1` — the
 *    things you opened and can type into. The agents those sessions run inside
 *    themselves (reviewer, coder, verifier) are NOT rows: they are the `●N` and
 *    the activity line on the session that owns them. An earlier draft used
 *    black-smith task ids like `D-257` as rows, which put a subagent's work on
 *    the canvas as if it were something you had opened.
 *  - **`input` is what YOU said** — the prompt you typed, verbatim, never the
 *    agent's paraphrase. `output` is the session's final answer, never its
 *    working, and `null` means it is still writing one.
 *  - Nothing is invented that the sources cannot produce. black-smith cannot
 *    emit an activity line until §5 epic B lands, so `vam-build-1` reads `null`
 *    rather than a plausible-looking string.
 *
 * Note where `waiting` sits and where it does not. `crosscheck-2` has an
 * unanswered turn and is `running`: it is working, and it wants nothing from
 * you. `factory-sse-1` answered and stopped — that is what puts the ball in your
 * court, and what the halo is for.
 *
 * The text runs long on purpose: `in`/`out` clamp at two lines, and a fixture of
 * short strings would let a one-line bug ship looking fine.
 *
 * Not shipped: `dev` renders it, the real app will not.
 */

import type { CanvasModel } from '../domain/model.js';

export const DEMO_MODEL: CanvasModel = {
  projects: [
    {
      id: 'black-smith',
      name: 'black-smith',
      source: 'black-smith',
      sessions: [
        {
          id: 'factory-sse-1',
          title: 'factory-sse-1',
          icon: '🔨',
          epic: 'ui-server-sse',
          status: 'waiting',
          runningAgents: 3,
          activity: 'coder · round 2 · sonnet',
          age: '4m',
          // Newest first — the model's order, not the reading order. The canvas
          // reverses it so the newest lands at the bottom of the node.
          decisions: [
            {
              id: 'd-r5',
              label: 'R-5',
              input:
                'Cross-origin EventSource có thật sự tới được server 127.0.0.1 không? Đo đi, đừng đoán.',
              output:
                'Tới được — Origin có, handler chạy, subscribe + heartbeat khởi động. Nhưng Chrome cắt ở ~5.0s (5004/5008/5010ms), còn same-origin thì không giới hạn. Sửa câu chữ R-5 hay thêm CORS?',
              commands: [
                {
                  id: 'c-raise',
                  label: 'raise finding sửa câu chữ R-5',
                  command:
                    'smith findings raise --evidence state/results/f-ui-server-sse.json --found-by reviewer --session factory-sse-1',
                },
              ],
            },
            {
              id: 'd-signoff',
              label: 'sign-off',
              input: 'Ký plan-v2 chưa? Còn finding nào chưa đóng thì đừng ký.',
              output:
                'Chưa ký. Còn 1×S2 mở ở task-4 (race in queue) — verifier đã confirm, coder đang sửa vòng 2.',
              commands: [],
            },
            {
              id: 'd-task4',
              label: 'task-4',
              input: 'Chạy task-4 theo plan-v2, TDD trước, đừng waive nhánh queue rỗng.',
              output:
                'Xong vòng 1: 340 dòng diff, 6 file, suite xanh. Reviewer trả về 2 finding (1×S2, 1×S3).',
              commands: [],
            },
            // Everything below here is older than the three the canvas draws. It
            // is in the fixture precisely so the elided link has something to
            // count: a demo where nothing is ever skipped would let `+N` ship
            // untested and unseen.
            {
              id: 'd-plan',
              label: 'plan',
              input: 'Lên plan cho epic ui-server-sse, chia wave theo claim graph.',
              output:
                'plan-v2: 5 task, 41 AC, 3 wave. task-2 giữ claims của task-1 qua claim-order.',
              commands: [],
            },
            {
              id: 'd-scope',
              label: 'scope',
              input: 'Epic này chỉ đọc thôi, chưa ghi gì. Ghi rõ vào spec giúp tôi.',
              output: 'Đã ghi §6: epic 1 read-only, luồng ghi để epic 2.',
              commands: [],
            },
            {
              id: 'd-start',
              label: 'start',
              input: 'Mở session cho epic ui-server-sse.',
              output: 'session-start factory-sse-1, plan_version 1.',
              commands: [],
            },
            {
              id: 'd-hello',
              label: 'hello',
              input: 'Trạng thái factory đang thế nào?',
              output: '2 epic mở, 1 merge queue trống, không có gate nào đang chờ.',
              commands: [],
            },
          ],
        },
        {
          id: 'crosscheck-2',
          title: 'crosscheck-2',
          icon: '🧪',
          epic: 'cross-provider',
          status: 'running',
          runningAgents: 2,
          activity: 'quorum · codex + deepseek · round 3',
          age: '26m',
          decisions: [
            {
              id: 'd-active',
              label: 'active mode',
              input: 'Sửa lại deepseek và active mode cho cả deepseek và codex.',
              // Still writing. `running`, not `waiting`: it wants nothing yet.
              output: null,
              commands: [],
            },
            {
              id: 'd-shadow',
              label: 'shadow',
              input: 'Hai provider đang shadow phải không? Đọc crosscheck.yml xem.',
              output:
                'Đúng, cả hai đều mode: shadow. Header file còn ghi sai là đã promote — tôi sửa lại luôn.',
              commands: [],
            },
          ],
        },
        {
          id: 'dogfood-4',
          title: 'dogfood-4',
          icon: '📦',
          epic: 'd257-verdict',
          status: 'done',
          runningAgents: 0,
          activity: 'merged',
          age: '2h',
          decisions: [
            {
              id: 'd-merge',
              label: 'merge',
              input: 'Rebase rồi merge, đừng squash — tôi muốn giữ từng commit của task-4.',
              output: 'Rebase sạch, không conflict. Đã merge vào main, 7 commit giữ nguyên.',
              commands: [],
            },
          ],
        },
      ],
    },
    {
      id: 'vam',
      name: 'vam',
      source: 'orca',
      sessions: [
        {
          id: 'vam-build-1',
          title: 'vam-build-1',
          icon: '📐',
          epic: 'canvas-epic-1',
          status: 'waiting',
          runningAgents: 1,
          activity: null,
          age: '8m',
          decisions: [
            {
              id: 'd-icons',
              label: 'icon',
              input: 'Rename và chọn được icon cho session giống orca.',
              output:
                'Orca dùng emoji-picker-react (class .repo-icon-emoji-picker), không phải danh sách cố định. Đã đổi bảng chọn sang picker có search. Bấm s trên một hàng để thử.',
              commands: [],
            },
            {
              id: 'd-group',
              label: 'group',
              input:
                'Ở sidebar bên trái có thể group session theo project. Trong canvas có wrapper dashed line quanh các session thuộc project, label project.',
              output:
                'Xong. Heading là <div> thường nên j không bao giờ dừng ở đó; khung chỉ bọc được các hàng liền nhau, nên project được xếp theo session gấp nhất của nó.',
              commands: [],
            },
            {
              id: 'd-stack',
              label: 'stack',
              input: 'Dùng React và ReactFlow, nhưng không dùng HDS, tham khảo từ chính orca.',
              output:
                'Đã ghi §1.1 lệch chuẩn: Vue→React, vue-flow→ReactFlow, HDS→Tailwind. Mất 57 file .vue và token HDS; vam là repo đầu tiên ra khỏi chuẩn.',
              commands: [
                {
                  id: 'c-check',
                  label: 'chạy lại gate UI',
                  command: 'pnpm -s lint && pnpm -s typecheck && pnpm -s test && pnpm -s build',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
