# vam — VIM Agent Management

A keyboard-first manager for Claude Code and Codex sessions — one list, coloured by which one needs you, driven with vim keys instead of a mouse.

![platform: macOS, Linux](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-262626)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-262626)](LICENSE)

![vam, dark theme: sessions as tabs, grouped by project in the sidebar, one session's IN/OUT on the right](docs/images/hero-dark.png)

Every session is a real tmux pane that starts as a shell. vam types into that pane and reads the transcript back — Ctrl+C drops you to the shell, never out of the session.

## Features

- **Claude Code and Codex, one list** — every session from both, each row marked which it came from
- **Sessions are tabs** — `zs` stacks a tab into a second pane, `zv` splits it side by side
- **Response vs. Terminal** — Response is a projection built from the transcript; Terminal is the literal tmux pane (`capture-pane`), scrollback and all
- **Subagents, on their own** — pick one and see its own IN/OUT and progress, not just the `●3` badge
- **Files beside the transcript** — edit a session's working directory inline; a stale write is refused, never overwritten
- **Survives the agent exiting** — once a session drops back to its shell, vam keeps the conversation and can resume it
- **Only what vam started, by default** — a session you launched by hand stays hidden until you ask to see it
- **`Mod-k` command palette** — jump to any session, grouped by who needs you
- **Your phone, too** — *Enable phone access* runs `tailscale serve`; pairing is a short code, any device can be revoked
- **Attach a file to a prompt** — a text file always, an image too from the desktop app's native picker

![the Terminal view: a real tmux pane, scrollback and all](docs/ui/terminal-scrollback-live.png)

## Install

Node >= 22, no published releases yet, so the only install is a build:

```bash
pnpm install
pnpm run dev    # browser build, on :5273 (pnpm run dev:app for the Electron shell)
pnpm run dist   # electron-vite build + the web build + electron-builder
```

`dist` produces a `.dmg`/`.zip` on macOS (arm64 + x64) and an AppImage on Linux, both unsigned — right-click → **Open** (macOS) or `chmod +x` (Linux) on first launch. Desktop mode needs `claude` and `tmux` on `PATH`: vam starts each session in its own tmux pane and types your prompts into it. `pnpm run test` runs the unit suite; `pnpm run lint` is `biome check .`.

## Keyboard

`Mod` is your platform's command modifier: Cmd on macOS, Ctrl elsewhere. The ten you'll use first:

| Key | Action |
|---|---|
| `j` `k` | Walk the session list |
| `h` `l` | Cycle the focused project's open tabs |
| `i` | Put the caret in the prompt box |
| `o` | Start a session in the focused project |
| `x` | Close the focused session |
| `/` | Search sessions |
| `Mod-k` | Open the command palette |
| `Ctrl-Alt-1` … `Ctrl-Alt-5` | Response, PRs, Terminal, Agents, Files |
| `zs` `zv` | Split the focused tab, stacked or side by side |
| `?` | The in-app sheet, generated from the same bindings |

**[docs/keyboard.md](docs/keyboard.md)** has every chord.

## Licence

[MIT](LICENSE).
