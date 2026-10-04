<div align="center">

<img src="build/icon.png" alt="vam" width="120" height="120" />

# vam

**vim for agent management. Keyboard-first, with Select and Insert modes, for every Claude Code and Codex session on this machine.**

[![Platform](https://img.shields.io/badge/platform-macOS%20(arm64)-black)](#-build-from-source)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Why](#why-vam) · [Keys](#modes-and-keys) · [Highlights](#highlights) · [Download](#-download) · [Build from source](#-build-from-source) · [License](#-license)

</div>

---

<div align="center">
  <img src="docs/assets/readme/hero.png" alt="vam, dark theme: three sessions open as tabs across two projects, the sidebar grouped by project, and a waiting session's Response view with its permission prompt on screen" width="900" />
</div>

## Why vam

You run several agents at once. Every one of them stops to ask something: a permission, a
choice, a next step. Mouse-driven dashboards make that a chore. vam makes it a key press.

vam is modal, like vim, with two modes:

- **Select** is for moving and acting. Walk the session list, jump, split, close, open a
  view, and answer nothing by accident.
- **Insert** is for talking to the agent. Type into the prompt, or answer a question card.

`i` goes in, and `Escape` comes back out. That holds in the prompt box and in the terminal
tab alike, and a binding you press by mistake never reaches the agent's pane.

Under the keys, each session is a **tmux pane vam starts and tags**. It types your prompts
into the pane as you would and reads the transcript back with `capture-pane`, because
Claude Code and Codex offer no API to watch a running session. vam only shows sessions it
started itself.

## Modes and keys

`Mod` is Cmd on macOS and Ctrl elsewhere.

| Key | Select mode | Insert mode |
| --- | --- | --- |
| `i` | Enter Insert, caret in the prompt | |
| `Escape` | Cancel whatever is half-typed | Back to Select (also from the terminal tab) |
| `j` `k` | Walk the session list | Walk a question's options |
| `h` `l` | Cycle the project's open tabs | `h` back to Select, `l` next step of a multi-question call |
| `Enter` | | Mark the option and send once every step is marked; opens the prompt if no question is on screen |
| `Space` | | Mark an option without sending |
| `1` ... `9` | Show a view (Response, PRs, Terminal, Agents, Files) | Text |
| `Mod-.` | Send a literal Escape into the session's pane (works in either mode) | |
| `Mod-k` | Command palette | |
| `/` | Search sessions, `n` / `N` next / previous match | Command suggestions at the start of a prompt line |
| `o` `x` | Start / close a session | |
| `f` `F` | Jump labels / filters | |
| `zs` `zv` | Split the focused tab, stacked or side by side | |
| `,` `.` | Settings / Remote | |
| `?` | Searchable sheet of every binding | |

Every binding is in [docs/keyboard.md](docs/keyboard.md), which a unit test holds against
the key tables.

## Highlights

<table>
<tr>
<td width="42%" valign="middle">

### Select option

An agent's question (`AskUserQuestion`, a permission prompt) lands as a card in the
transcript. Press `i`, walk the options with `j` / `k`, mark with `Space` or `Enter`, send
with `Enter` or `Mod-Enter`. A multi-question call is answered one `Enter` per question.
vam never answers for you.

</td>
<td><img src="docs/assets/readme/start-flow.png" alt="Starting a session: provider, permission mode, Start session" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Command suggestion

Type `/` at the start of a line in the prompt and vam lists the session's slash commands:
Claude Code's built-ins, plus your own from `~/.claude/commands` and the project's
`.claude/commands`. Move with the arrow keys, accept with `Enter`, close with `Escape`.


</td>
<td><img src="docs/assets/readme/keyboard-today.png" alt="The searchable shortcuts sheet, Select and Insert side by side" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Remote

Turn on phone access in **Settings → Remote** and vam runs `tailscale serve` for you. Pair
with a QR, and the phone drives the same live sessions over your own tailnet, with no relay
run by anyone else. A quick-key strip supplies the keys a touch screen lacks.

</td>
<td>
<img src="docs/assets/readme/phone-pairing.png" alt="Settings → Remote: the phone-access address and pairing QR" /><br/>
<img src="docs/assets/readme/phone-session.png" alt="The same question card, inline in the transcript on a 390px phone" width="220" />
</td>
</tr>
</table>

- **Terminal mode.** The Terminal view is a real terminal on the session's tmux pane.
  Arrow keys, Ctrl chords and typing go to the program, so you can walk a Claude Code
  picker from inside it. `Escape` or `Tab` leaves it, and `Mod-.` sends a literal Escape.
- **Apply skill.** **Settings → Skills** installs a bundled skill (`i-have-adhd`, pinned to
  a commit, no network) into Claude Code's `~/.claude/skills` and Codex's
  `~/.agents/skills`, and removes it again.
- **Connect repo PRs.** Sign in to GitHub or GitLab in **Settings** (through your own `gh`
  and `glab`). The PRs view then lists the session's pull requests and can merge one or
  delete its branch. Never with `--admin` or `--auto`.
- **Claude Code and Codex.** Pick a provider and a permission mode (**Manual** asks before
  every tool call, **Yolo** skips the provider's prompts) per session.
- **Splits and tabs.** `zs` / `zv` split a tab, `Mod-1` ... `Mod-9` pick a tab,
  `Mod-Shift-[` and `]` cycle them.
- **Focus view.** `zf` folds each turn's tool calls away, leaving prompts and answers.
- **Files tab.** Browse, edit and save a session's files with vim-style `j` `k` `h` `l` in
  the tree.
- **Usage and worktrees.** A usage popover for both providers' rate limits, and worktrees
  nested under their project.
- **Self-update.** Installed builds check for a newer release once a day (Settings → Update).

## 📦 Download

vam has no published releases yet. The release workflow drafts unsigned macOS, Windows and
Linux builds automatically from a tag — a maintainer still has to choose to publish one —
so for now the only install is [building from source](#-build-from-source).

Once a release is published, installed builds **update themselves**: vam checks the
releases once a day (switch it off in **Settings → Update**), offers a newer version in the
app, and installs it when you quit. On macOS keep vam in `/Applications`, not on the disk
image or in Downloads — an app that has not been moved cannot replace itself. How it works,
and what it does and does not protect against, is in [docs/signing.md](docs/signing.md#releases).

## 🛠 Build from source

Requires Node.js 22 (`.nvmrc` pins it) and `tmux` on `PATH` — every session is a real tmux
pane, and desktop mode also wants `claude` and/or `codex` on `PATH` for whichever provider
you start.

```bash
nvm use              # or install node 22 some other way
pnpm install
pnpm run dev          # browser build, on :5273
pnpm run dev:app      # the Electron shell, with renderer HMR
pnpm run build        # production browser build, into dist/
pnpm run build:app    # electron-vite build, into out/
pnpm run build:web    # the phone/web bundle, into dist-web/ (what Remote serves)
pnpm run dist         # build:app + build:web + electron-builder -> an unsigned local .dmg
```

`pnpm run dist` produces a `.dmg`/`.zip` on macOS, unsigned — right-click → **Open** on
first launch (Gatekeeper otherwise refuses it; there is no Apple Developer identity behind
these builds yet).

## 🤝 Contributing

There's no `CONTRIBUTING.md` yet — the real gate is what CI runs
(`.github/workflows/ci.yml`), so run the same commands locally before opening a PR:

```bash
pnpm run lint             # biome check . (e2e/ is intentionally excluded)
pnpm run typecheck        # src, with the DOM lib
pnpm run typecheck:node   # main + preload, no DOM lib
pnpm run typecheck:web    # renderer
pnpm run typecheck:test   # test/
pnpm test                 # vitest unit suite
pnpm run build            # production build
pnpm run test:app         # the Electron launch harness (spawns a real binary)
pnpm run test:e2e:web     # e2e/run-web-guards.mjs — the asserting e2e/*.mjs scripts
pnpm run test:e2e         # Playwright, desktop
pnpm run test:e2e:phone   # Playwright, 390px
pnpm run test:e2e:electron # Playwright against a packaged electron-builder --dir build
```

See [`e2e/README.md`](e2e/README.md) for what each e2e script actually checks (and the
handful that are screenshot-only and intentionally not gates).

## 📜 License

[MIT](LICENSE).
