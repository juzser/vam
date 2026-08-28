# VAM — canvas layout & interaction spec

VAM = **VIM Agent Management**. Bản này chốt từ phiên phỏng vấn 2026-08-27.
Ràng buộc số một: **điều khiển bằng bàn phím, hạn chế chuột tối đa.**

## 1. Vam đứng ở đâu

App riêng, **không fork orca**. Orca (MIT, 19.146 file, `packages: []` — không
phải monorepo module hoá) đã có sẵn client thứ hai là `mobile/` nói chuyện với
backend qua RPC; vam là client thứ ba theo đúng đường đó.

```
vam (web · Vite + React + ReactFlow)
 ├─ adapter black-smith → http://127.0.0.1:4680/api/*   (đã tồn tại, cả đọc lẫn ghi)
 └─ adapter orca        → http://127.0.0.1:6768 RPC     (orchestration.* · terminal.*)
```

Web trước, Electron sau ⇒ **lớp truy cập dữ liệu phải tách khỏi component ngay
từ commit đầu**, nếu không việc bọc Electron sẽ phải viết lại UI.

### 1.1 Lệch chuẩn stack — ghi lại có lý do (bắt buộc)

`docs/standards/stack.md` của black-smith bắt buộc **Vue 3 + Vite**,
**`@vue-flow/core`** và **HDS**, và cho phép lệch *chỉ khi có justification viết
ra*. Vam lệch ở hai điểm. Operator quyết ngày 2026-08-27:

| điểm | chuẩn | vam | lý do |
|---|---|---|---|
| framework | Vue 3 | **React 19** | UI của vam tham chiếu trực tiếp từ orca, mà orca là app React. Cùng framework thì pattern chuyển thẳng sang; khác framework thì mọi thứ tham chiếu đều phải dịch lại bằng tay. |
| canvas | `@vue-flow/core` | **ReactFlow** | Hệ quả của dòng trên. Cùng một paradigm hiển thị, chỉ khác cổng. Orca **không** dùng thư viện canvas nào — phần này vam tự mang, nên không có gì để kế thừa từ orca ở đây. |
| styling | HDS + Tailwind v4 | **Tailwind v4 + shadcn/radix, không HDS** | Cùng lý do: lấy thẳng từ orca. |

Cái mất, nói rõ để sau này không ai tưởng là bỏ sót: HDS token và 57 file `.vue`
của `black-smith/ui/src` **không** dùng lại được, kể cả CSS đã viết sẵn cho
class `.vue-flow__`. Vam là repo đầu tiên trong hệ lệch khỏi chuẩn stack.

Cái được: orca (MIT) cho vam một tham chiếu chạy thật cho đúng những phần khó
nhất — xem §4.1.

### 1.2 Stack chốt

> **Sửa 2026-08-28.** Mục này từng là DANH SÁCH DỰ ĐỊNH chép từ `package.json`
> của orca ngày 2026-08-27, nhưng viết như thể đã cài. Bốn món chưa bao giờ
> được cài — `shadcn`, `radix-ui`, `class-variance-authority`, `sonner` — và
> một món có thật thì không được nhắc. Một phiên khác đã đọc mục này, tin nó,
> và suýt ghi "React + ReactFlow + shadcn/radix" thành justification chính thức
> của vam trong registry của black-smith. Dưới đây là thứ `package.json` thực
> sự khai, đối chiếu ngày 2026-08-28.

Đang cài thật:

- **React 19 + Vite** · **Tailwind CSS v4** — không có HDS, token riêng
  (`src/styles.css`, đọc từ mockup ADE; xem `docs/ade-redesign.md`)
- **`@xyflow/react`** cho canvas — phần duy nhất không có trong orca
- **`cmdk`** cho command palette (`Ctrl-K` ở §4) — orca dùng đúng thư viện này
  ở `QuickOpen.tsx` và `WorktreeJumpPalette.tsx`
- **`zustand`** cho state · **`lucide-react`** cho icon
- **`clsx`** + **`tailwind-merge`** cho class
- **`emoji-picker-react`** cho bảng icon (§4, lazy chunk 307kB)
- **Vitest** cho unit test (giữ nguyên, trùng chuẩn)

Lấy theo orca nhưng **không** lấy: `shadcn`, `radix-ui`,
`class-variance-authority`, `sonner`. vam chưa cần lớp component dựng sẵn nào —
mọi thành phần đều viết tay trên token của chính nó.

## 2. Mô hình chung cho hai nguồn

Không phải bịa ra — cả hai bên đều đã có "quyết định chờ người" là first-class:

| khái niệm chung | orca | black-smith |
|---|---|---|
| project | `worktree-catalog`, `repo`, `folder-workspace` | `tasks` + worktree |
| session | `orchestration.runList` / `runShow` | `sessions`, `epics` |
| agent đang chạy (`●`) | `orchestration.workerList`, `agent-status-*` | `agents`, `dispatches` |
| **decision** | `orchestration.gateList` / `gateResolve` | `waivers`, `gate-outcome`, plan sign-off |

## 3. Layout

Canvas ReactFlow. **Group lồng**: project là parent node, session là child.
**Không có mũi tên** giữa các session — canvas là bảng điều khiển, không phải sơ đồ.
Quy mô thiết kế: **3–5 repo × 1–3 session**.

```
┌─ VAM ─────────────────────────────────────────────────────── ⣾ 4 agents ─┐
│                                                                           │
│  ╔═ black-smith ═══════════════════════════╗  ╔═ vam ═════════════════╗   │
│  ║ ┌─ D-257 · epic-2 ─────────── ●3 ─┐     ║  ║ ┌─ epic-1 ──── ●1 ─┐  ║   │
│  ║ │ ⣾ coder · round 2 · sonnet · 4m │     ║  ║ │ ⣾ planner · 1m   │  ║   │
│  ║ ├─────────────────────────────────┤     ║  ║ ├──────────────────┤  ║   │
│  ║ │ ▸ reviewer                      │     ║  ║ │ ▸ plan draft     │  ║   │
│  ║ │   in : diff 340 dòng, 6 file    │     ║  ║ │   in : goal      │  ║   │
│  ║ │   out: 2 findings (1×S2)        │     ║  ║ │   out: 7 task    │  ║   │
│  ║ │ ▸ verifier                      │     ║  ║ │ ▸ spec-review    │  ║   │
│  ║ │   in : S2 "race in queue"       │     ║  ║ │   in : plan-v1   │  ║   │
│  ║ │   out: confirmed                │     ║  ║ │   out: 2×S2      │  ║   │
│  ║ │ ▸ gate                     ⏸    │     ║  ║ │ ▸ sign-off  ⏸    │  ║   │
│  ║ │   in : 1 S2 chưa fix            │     ║  ║ │   in : plan-v2   │  ║   │
│  ║ │   out: — chờ bạn duyệt —        │     ║  ║ │   out: — chờ —   │  ║   │
│  ║ └─────────────────────────────────┘     ║  ║ └──────────────────┘  ║   │
│  ║ ┌─ D-263 ─────────────────── ●0 ─┐      ║  ╚═══════════════════════╝   │
│  ║ │ ✓ merged · 2h trước             │      ║                              │
│  ║ └─────────────────────────────────┘      ║                              │
│  ╚═════════════════════════════════════════╝                              │
├───────────────────────────────────────────────────────────────────────────┤
│ NORMAL   black-smith/D-257   ⏸ 2 chờ bạn      hjkl f / gt  yy  ^K         │
└───────────────────────────────────────────────────────────────────────────┘
```

### Node session

- **Header**: id · epic · `●N` agent đang chạy.
- **Dòng activity** (1 dòng, truncate, có spinner khi live). Nguồn: worker
  heartbeat của black-smith (xem §5).
- **Đúng 3 decision gần nhất**, mỗi cái 2 dòng `in:` / `out:` tách riêng.
  Step = **điểm quyết định**, không phải mỗi lượt agent, không phải mỗi pha.
- Toàn bộ diễn tiến chi tiết của agent **không hiện ra ngoài** — Enter mới xem.

### Sắp xếp

Auto-layout mặc định (ưu tiên: đang-chờ-bạn → đang-chạy → mới nhất), **kéo được
và nhớ vị trí**. Vị trí lưu theo từng người dùng, không đi vào event log.

**Ghim là thứ bạn kéo, không phải mọi node.** Chỉ node bạn thật sự kéo mới được
ghi vào `localStorage` (`src/prefs/prefs.ts`); mọi node còn lại nhận vị trí mới
từ auto-layout ở mỗi lần model đổi. Hai thứ này nghe giống nhau nhưng không
phải: bản đầu giữ vị trí *hiện tại* của mọi node, nên auto-layout bị đóng băng ở
lần render đầu tiên — một session chuyển sang chờ-bạn trong lúc bạn đang nhìn
thì không bao giờ nổi lên đầu khung. Thứ tự ở §3 chỉ có nghĩa nếu nó còn xảy ra
được sau khi trang đã mở, mà đó là lúc duy nhất có người đang xem.

Kèm theo là đường ra: `gr` bỏ hết ghim. Một cái ghim sống qua reload mà không có
cách gỡ là một cái bẫy — kéo nhầm một lần là thẻ đó sai vĩnh viễn, và trên màn
hình không có gì giải thích vì sao nó không xếp cùng những thẻ khác.

**Icon cũng ở đây, cùng lý do.** black-smith không có route lưu icon, và đó
không phải là câu trả lời — không ai hỏi black-smith. Icon là chuyện bạn thích
nhìn việc thế nào, không phải chuyện của việc; nó thuộc về trình duyệt, và §3
đã nói sẵn: lưu theo từng người dùng, **không đi vào event log**.

## 4. Bàn phím

Không modal thật. Một nhúm chord kiểu vim + command palette.

| phím | việc |
|---|---|
| `h j k l` | đi giữa các node — **tính hình học tại thời điểm bấm**, nên kéo thả không phá |
| `f` | hiện nhãn nhảy trên mọi node, gõ nhãn là tới |
| `/` `n` `N` | tìm theo tên session/task |
| `gt` `gT` | sang project kế / trước |
| `gg` `G` | node đầu / cuối |
| `Enter` | mở detail (toàn bộ quá trình agent) |
| `yy` | **chép command cần chạy tay vào clipboard** |
| `Ctrl-K` | command palette |
| `Esc` | đóng lớp trên cùng |
| `I` | vào **action pane** (hàng chờ duyệt + prompt) |
| `i` | mở ô nhập của thứ con trỏ đang đứng — lý do waiver, ghi chú lesson, hoặc prompt |
| `H` | rời action pane, về danh sách session |
| `gr` | bỏ mọi vị trí đã ghim, trả canvas về auto-layout |

`hjkl` phải tính theo toạ độ thực tại thời điểm bấm, **không** theo chỉ số cố
định — đó là điều kiện để kéo-thả và điều hướng bằng phím sống chung được.

### 4.1 Orca cho lớp bàn phím những gì (đọc ngày 2026-08-27)

**Orca không có vim mode** — tìm cả cây `src/renderer` không ra file nào. Nên
lớp chord vim của vam là phần mới, không có gì để chép. Cái orca cho là *khung
đỡ* quanh nó, ở `src/shared/keybindings.ts` (2.432 dòng) và
`app-shell/use-global-keybindings.ts`:

| orca có sẵn | vam cần nó để làm gì |
|---|---|
| `KeybindingDefinition` registry — action id ↔ binding | Một chỗ duy nhất khai báo phím, thay vì rải `onKeyDown` khắp component |
| `KeybindingOverrides` + validate + diagnostics | Người dùng đổi phím được mà không sửa code |
| `findKeybindingConflicts` | `gt` và `g` không thể cùng tồn tại nếu không ai phát hiện xung đột |
| `isDoubleTapBinding` | Đúng cơ chế `gg` / `yy` cần |
| `keybindingIsActiveInContext` — `app` / `terminal` / `browser` | Gate theo lớp: đang mở detail thì `j` không được chạy về canvas |
| `TerminalShortcutPolicy` = `orca-first` \| `terminal-first` | Bài toán phân xử "ai được nhận phím" khi có terminal — vam sẽ gặp y hệt ở lớp detail |

Hai thứ vam **không** lấy từ orca vì orca không có: bộ chord vim, và điều hướng
`hjkl` theo hình học. Cả hai là logic thuần, không phụ thuộc nguồn dữ liệu, nên
dựng và test được ngay — trước cả hai epic black-smith ở §5.

### 4.2 Action pane: mỗi nút một điểm dừng

Hàng chờ duyệt là chỗ vam ghi lên record vĩnh viễn — waiver nhận một defect,
lesson được duyệt sẽ chèn vào mọi dispatch sau đó. Nên `j`/`k` dừng ở **từng
nút**, không phải từng hàng, và **nút bảo thủ đứng trước**: `bắt sửa` trước `bỏ
qua`, `bỏ` trước `duyệt`. Vòng ring quanh cái bạn sắp bấm *chính là* câu trả lời
cho "bấm xong thì gì xảy ra" — không cần biết phím nào là verdict "chính".

Hai lựa chọn bị loại: (a) một điểm dừng mỗi hàng + `y`/`n` cho hai verdict — cả
hai chữ đã có nghĩa trong grammar (`yy` chép, `n` đi tiếp match), và nghĩa theo
mode là đúng thứ §4 nói vam không có; (b) một điểm dừng mỗi hàng + `Enter` là
verdict chính — đòi người đọc biết verdict nào "chính" cho một quyết định nhận
defect vào record, mà không có gì trên màn hình nói được điều đó.

Ba chi tiết còn lại đều là chống-lỡ-tay:

- `Enter` **trong ô lý do** chỉ kết thúc gõ, không bắn verdict. Con trỏ vẫn đứng
  ở nút `j` vừa tới; bắn từ trong ô text nghĩa là grant một waiver bằng đúng
  phím cuối cùng của việc viết lời biện hộ cho nó.
- `Escape` trong ô lý do trả bàn phím lại pane. Listener cửa sổ bỏ qua phím gõ
  trong `INPUT` — đó là thứ giữ grammar không bắn giữa chừng — nên ô nào không
  tự bind thì con trỏ mắc kẹt trong đó.
- Trả lời xong thì con trỏ **về đầu danh sách**. Hàng vừa trả lời biến mất; giữ
  nguyên chỉ số là thả con trỏ xuống thứ vừa trượt lên chỗ đó — sau khi bỏ qua
  một waiver thì đó là nút `duyệt` của hàng kế.

### `yy` — bỏ hẳn thao tác copy bằng chuột

Black-smith **cố tình** trả command dạng dữ liệu có cấu trúc thay vì tự chạy
(guardrails: chỉ operator mới tạo remote / push / gửi ra ngoài). Ví dụ thật từ
`smith new vam`:

```json
"commands": {
  "ghRepoCreate": "gh repo create vam --private --source=… --remote=origin --push=false",
  "push":         "git -C … push -u origin setup"
}
```

Nên command chờ-bạn-chạy là **một field**, không phải text lẫn trong prose phải
bới ra. `yy` chép field đó. Vam **không tự chạy** — bước gật vẫn là của bạn.

## 5. Phụ thuộc ngược lên black-smith

Hai việc nằm ở black-smith, **không phải** ở vam, và vam epic 1 nên đợi chúng
thay vì dựng lớp polling rồi vứt đi:

- **epic A — SSE cho `ui/server`**: hiện `app.ts` chỉ có request-response.
- **epic B — worker heartbeat**: black-smith cố tình cấm worker trả prose
  (`{status, severity_counts, artifact_path}`) để khỏi ngập context orchestrator.
  Nên hôm nay *không có* text "agent đang làm gì". Heartbeat là một sự kiện mới
  mang một dòng mô tả ngắn — đụng vào return discipline, nên phải là epic riêng
  của black-smith, có spec-review đàng hoàng.

```
black-smith epic A (SSE)        ─┐
black-smith epic B (heartbeat)  ─┤→ vam epic 1: canvas đọc-only, một nguồn
                                 ┘
```

## 6. Phạm vi

Đích cuối là **điều khiển đầy đủ** (duyệt gate, tạo/dừng session, spawn agent,
gửi prompt). Nhưng ghi vào hai hệ thống có mô hình nhất quán khác nhau —
black-smith bắt mọi lệnh ghi mang envelope `--session/--plan-version/--causal-parent`
và từ chối nếu thiếu; orca `gateResolve` là RPC nội bộ không cam kết ổn định.
Ghi sai vào event log là làm hỏng trí nhớ của factory, không phải lỗi UI.

**Epic 1 dừng ở: canvas đọc-only, một nguồn black-smith.** Chưa ghi gì nên chưa
thể làm hỏng gì, và layout được nhìn tận mắt trước khi gắn vào luồng ghi.

### 6.1 Epic 2 — luồng ghi đã nối (2026-08-27)

Đọc **không** đợi SSE. `GET /api/overview` đã trả `runningSessions[]` từ trước,
nên adapter dựng được hàng thật ngay; §5 epic A chỉ đổi cách dữ liệu *tới*
(poll → push), không phải việc có dữ liệu hay không. Hôm nay là poll 4s
(`useCanvas`), và khi SSE về thì đúng một file đổi.

Ghi thì **bắt buộc** phải có đọc trước: `resolveContext` đòi `sessionId` thật và
tự nối `causalParent` từ event cuối của log đó. Không có session thật thì mọi
POST đều 400.

Ba việc ghi được nối, và chỉ ba:

| việc | đường | ghi chú |
|---|---|---|
| prompt | `POST /api/prompt` (mới) | **ghi lại, không gửi** — xem dưới |
| waiver S3/S4 | `POST /api/waivers/apply-batch` | theo fingerprint, bắt buộc có lý do |
| lesson candidate | `POST /api/lessons/:id/approve\|reject` | không bao giờ tự đặt `acceptDuplicate` |

**Prompt ghi lại chứ không gửi đi.** black-smith không có kênh nào vào một
session Claude Code đang chạy. Cái nó có là `user_prompt` — lưu nguyên văn để
`dispatch_decision` sau đó móc `parent_prompt_id` vào, và timeline đọc ra "việc
này xảy ra vì một người yêu cầu". UI phải nói đúng chữ đó; một ô prompt trông
như đã gửi sẽ để người dùng ngồi đợi câu trả lời không ai định đưa.

**Những thứ vẫn không nối, vì factory không có:** tạo session (làm từ CLI:
`smith event append session-start`), đổi tên session (id là thứ cả event log
móc vào), đóng session, lưu icon. Những chỗ này báo đúng lý do chứ không nói
"chưa nối".

**CORS:** không mở. vam proxy `/api/*` qua origin của chính nó
(`vite.config.ts`); mở CORS trên một server nhận lệnh ghi là nới rộng thứ mà
mọi trang trong trình duyệt với tới được.
