<div align="center">

<img src="build/icon.png" alt="vam" width="120" height="120" />

# vam

**A vim-like, keyboard-first session manager — every Claude Code and Codex session on this machine, in one place.**

[![Platform](https://img.shields.io/badge/platform-macOS%20(arm64)-black)](#-build-from-source)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Features](#-features) · [Download](#-download) · [Build from source](#-build-from-source) · [Keyboard](#️-keyboard-shortcuts) · [License](#-license)

</div>

---

<div align="center">
  <img src="docs/assets/readme/hero.png" alt="vam, dark theme: three sessions open as tabs across two projects, the sidebar grouped by project, and a waiting session's Response view with its permission prompt on screen" width="900" />
</div>

## Why vam

vam is modal, like vim. **Select** mode drives the session list with `hjkl`, vim-style
prefix chords and a command palette; **Insert** mode types into the prompt or answers an
agent's question. `i` goes in, and `Esc` comes back out, in the prompt and in the
streaming terminal alike, so your hands stay on the keyboard and never have to find the
mouse.

Under the keys, each session is a **tmux pane vam starts and tags**. It types your prompts
into the pane as you would and reads the transcript back with `capture-pane`, because
Claude Code and Codex offer no API to watch a running session. vam only shows sessions it
started itself. Every session lives in a real pane, so turn on phone access and the same
live session carries on in your pocket, over your own tailnet, with no relay run by anyone
else.

## ✨ Features

<table>
<tr>
<td width="42%" valign="middle">

### Modal keyboard — Select, Insert, chords, palette

Walk sessions with `hjkl`, split with `zs`/`zv`, jump with `f`, and open the palette with
`Mod-k`. `?` opens a searchable sheet of every binding, and Settings → Keyboard flags a
chord that two actions claim.

</td>
<td><img src="docs/assets/readme/keyboard-today.png" alt="The searchable shortcuts sheet, Select and Insert side by side" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Terminal-first sessions — Claude Code and Codex

Pick a provider and a permission mode (**Manual** asks before every tool call, **Yolo**
skips the provider's prompts for that session), then start. Questions and permission
prompts land as cards in the transcript, and vam never answers for you.

</td>
<td><img src="docs/assets/readme/start-flow.png" alt="Starting a session: provider, permission mode, Start session" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Your phone, too — over Tailscale Serve

Turn on phone access in **Settings → Remote** and vam runs `tailscale serve` for you. Pair
with a QR, and the phone drives the same live sessions, with a quick-key strip for the
keys a touch screen lacks.

</td>
<td>
<img src="docs/assets/readme/phone-pairing.png" alt="Settings → Remote: the phone-access address and pairing QR" /><br/>
<img src="docs/assets/readme/phone-session.png" alt="The same question card, inline in the transcript on a 390px phone" width="220" />
</td>
</tr>
<tr>
<td width="42%" valign="middle">

### Settings — one full-window overlay

`,` opens Settings as its own full-window screen, not a modal over the app — **Interface**
(theme, palette templates, zoom), **Stats & Usage**, **Terminal**, **Window & Sidebar**,
**Agents**, **Skills**, **Behaviour**, **Notifications**, **Integrations**, **Remote**,
**Keyboard**, and **Update**, each its own section behind one sidebar.

</td>
<td><img src="docs/assets/readme/settings-overlay.png" alt="The Settings overlay: a full-window screen with every section listed in its own sidebar, Interface open" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Integrations — GitHub and GitLab

Connect a GitHub account with the `gh` CLI, or a GitLab account with `glab` — vam stores no
token of its own, it shells out to whichever CLI you're already signed into, and shows pull
requests for the project's linked repo.

</td>
<td><img src="docs/assets/readme/integrations.png" alt="Integrations: GitHub and GitLab cards, both connected via gh and glab" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Keyboard — Insert mode, shortcuts, a conflict indicator

**Select** mode moves with `hjkl` and vim-style prefix chords (`gg`, `yy`, `zs`/`zv`…); `i`
drops you into **Insert**, where the same keys type into the prompt or answer a question
instead, and `Escape` leaves Insert and hands the keyboard straight back rather than
reaching the session's own pane. `Mod-.` is the dedicated way to send Escape into the
focused session's pane instead — interrupt it, drive Claude Code's own Esc-Esc rewind,
dismiss its menus, or leave vim — and it works whether that session is running, waiting, or
idle. `?` opens a searchable sheet generated from the same key tables that back every
binding, and in **Settings → Keyboard**, a chord two actions claim is flagged with a red
dot and a tooltip naming the other action — on both the row that kept the chord and the row
that lost it.

</td>
<td>
<img src="docs/assets/readme/keyboard-settings.png" alt="Settings → Keyboard: a contested chord's red conflict dot, its tooltip open (Also bound to: close this session), and the Mod-. interrupt binding" /><br/>
<img src="docs/assets/readme/keyboard-today.png" alt="The searchable shortcuts sheet, generated from vam's own key tables, Select and Insert side by side" />
</td>
</tr>
</table>

**Also:** usage popover for both providers' rate limits · workspace filters and worktrees
nested under their project · Settings as one full-window overlay · GitHub and GitLab pull
requests through your own `gh` and `glab` sign-in.

## 📦 Download

vam has no published releases yet. The release workflow drafts unsigned macOS, Windows and
Linux builds automatically from a tag — a maintainer still has to choose to publish one —
so for now the only install is [building from source](#-build-from-source).

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

## ⌨️ Keyboard shortcuts

`Mod` is Cmd on macOS and Ctrl elsewhere. The chords below are the most-used ones; every
one of them is listed in [docs/keyboard.md](docs/keyboard.md), which a unit test holds
against the key tables.

| Key | Action |
| --- | --- |
| `j` `k` | Select: walk the session list |
| `h` `l` | Select: cycle the focused project's open tabs |
| `i` | Enter Insert — type into the prompt, or answer a question |
| `Escape` | Leave Insert, back to Select — never into the session's pane; in the streaming terminal, Esc returns to Select mode too |
| `Mod-.` | Send Escape to the focused session's pane — interrupt, running or not |
| `Mod-Enter` | Start the session on a fresh pane, as the Start button does |
| `o` / `Mod-n` | Start a session in the focused project |
| `x` / `Mod-w` | Close the focused session |
| `Mod-Shift-p` | New project |
| `Mod-Shift-w` | New worktree |
| `/` | Search sessions · `n` / `N` next / previous match |
| `F` | Workspace options — group, sort, filters |
| `,` | Settings · `.` Remote (phone pairing) |
| `Mod-k` | Command palette |
| `Ctrl-Alt-1` … `Ctrl-Alt-9` | Show a view — Response, PRs, Terminal, Agents, Files |
| `zs` `zv` | Split the focused tab, stacked or side by side |
| `?` | The in-app shortcut sheet |

On a phone there is no physical keyboard, so a 24-chip strip (23 where the session has no terminal) above the composer taps the
keys for you: Keyboard, Paste, twenty keys, Terminal where the session has one, and More.

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
