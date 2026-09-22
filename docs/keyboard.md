# Keyboard reference

Every binding vam ships, and the one place they are written down in full. The
[README](../README.md#keyboard) keeps the ten most-used rows and links here for
the rest.

Bindings are defined in `src/renderer/keyboard/chords.ts`. The tables below are
hand-maintained, but not merely trusted: `test/keyboard/chords.keyboard-doc.test.ts`
reads `chords.ts`'s own binding tables and this file's `Key`/`Chord` columns and
fails `vitest run` the moment either side names something the other doesn't —
the same source the in-app `?` sheet is generated from. `hjkl` mean different
things in Select and Insert — the session list and the question card — and
`Mod` means **your platform's command modifier**: Cmd on macOS, Ctrl on Linux
and Windows.

**On macOS, Ctrl belongs to the terminal.** `Ctrl+K`, `Ctrl+W`, `Ctrl+U`,
`Ctrl+N` and `Ctrl+T` are readline's own chords, and vam answers none of them —
they reach the shell in the Terminal tab and the text box everywhere else.
`Ctrl+number` is bound to nothing either. The two exceptions are deliberate and
are named in the table: `Mod-d` / `Mod-u` also answer **Ctrl+D / Ctrl+U**,
because those are vim's gestures for reading a transcript rather than commands,
and `Ctrl-[` still leaves the prompt box, because that is vim's own Escape. On
Linux and Windows there is no Cmd key, so Ctrl is the command modifier and
every `Mod-` chord answers it as it always did.

| Key | Action |
|---|---|
| `h` `j` `k` `l` | **Select:** `j`/`k` walk the session list, one row at a time, stopping at the ends; `h`/`l` cycle the active project's open tabs, a ring that wraps. **Insert:** `j`/`k` walk an open question's options; `h` returns to Select, `l` steps a multi-question call's steps |
| `i` | Put the caret in the prompt box, aimed at the focused session |
| `I` | Move keyboard control into the right-hand action pane |
| `Mod-Shift-h` / `Mod-0` | Move keyboard control back to the session list. `Cmd+Shift+H` rather than `Cmd+H`, which is macOS's own Hide and is claimed by the application menu before the page ever sees it |
| `r` | Rename the focused session |
| `x` / `Mod-w` | Close the focused session |
| `o` / `Mod-n` | Start a new session, in the focused session's project |
| `Mod-t` | Start a new session as a tab of the FOCUSED PANE — the pane's own `+`, and it names the project on screen when that pane is empty |
| `Mod-Shift-p` | New project — choose a directory, and start a session in it. There is no stored project in vam: a project is live sessions grouped by their cwd, so this is the only thing creating one can mean. `Cmd+P` is a different gesture and is bound to nothing, so the browser build keeps its print dialog |
| `,` | Open settings |
| `.` | Open Remote — pair a phone, approve or deny it, unpair one, or revoke every device |
| `E` | Open the error log — every genuine failure this session hit, never vam's own intended refusals. Each row can Copy the raw event as text, or Report it: vam composes a pre-filled GitHub issue, scrubbed of anything private, and opens the form in your browser for you to read and submit yourself — it is never sent on vam's behalf |
| `?` | Open the in-app shortcut sheet (generated from these same bindings) |
| `f` | Jump (open the jump-label overlay) |
| `F` | Open the sidebar's filter popover |
| `G` | Jump to the last session |
| `/` | Search sessions |
| `n` / `N` | Next / previous search match |
| `p` | Reveal the focused session's project in the sidebar |
| `Enter` | **Select:** nothing to open — the whole detail is already in the right pane, and it says so. **Insert, on a question card:** marks the option under the cursor and, once every open step of the call carries a mark, sends it — otherwise it moves the cursor on to the next unmarked step, so a multi-question call is answered one Enter per question. `Space` marks (or un-marks a multi-select's pick) the same way it always has, but never sends. `Mod-Enter` sends the call from wherever the cursor is on the card, naming the first unmarked step instead of sending when one is still open. **Insert, with no question on screen:** opens the prompt box |
| `Mod-k` | Open the command palette |
| `Mod-1` `Mod-2` `Mod-3` `Mod-4` `Mod-5` `Mod-6` `Mod-7` `Mod-8` `Mod-9` | Select a session tab by position, counting ACROSS every pane on screen in the order the strips draw them — the same meaning wherever the keyboard is, and picking a tab another pane holds moves the keyboard there with it. `Mod-9` is always the last one. Past nine open tabs the digits stop covering everything: that is the price of counting one list rather than one per strip, and `Mod-Shift-[` / `]` is how you reach the rest. On macOS this row is **Cmd only**: Ctrl+number used to reach it too and is bound to nothing now, so the digit row means one thing and the view row below means another |
| `Mod-Shift-[` / `Mod-Shift-]` | Previous / next session tab, over that same across-panes list, wrapping at both ends — the browser's own tab gesture, and it fires from inside the prompt box |
| `Mod-Alt-[` / `Mod-Alt-]` | Previous / next pane — one modifier up from the tab pair, and the same act as `zw` / `zW` |
| `Ctrl-Alt-1` `Ctrl-Alt-2` `Ctrl-Alt-3` `Ctrl-Alt-4` `Ctrl-Alt-5` | Show a view in the focused pane — Response, PRs, Terminal, Agents, Files, in that fixed order. Ctrl+Option+number on macOS, Ctrl+Alt+number elsewhere: one three-key chord, the same physical keys on every platform. A digit always names the SAME view: if this source has no terminal, `Ctrl-Alt-3` says so rather than opening whatever sits third, and `Ctrl-Alt-5` says the same on a build without the desktop file bridge. Plain Alt+number used to do this and is bound to nothing now — switching a view is the three-key chord alone |
| `Ctrl-Alt-6` `Ctrl-Alt-7` `Ctrl-Alt-8` `Ctrl-Alt-9` | Nothing — bound only so they say there is no sixth view instead of reaching the browser |
| `1` `2` `3` `4` `5` `6` `7` `8` `9` | **Select only:** the same views on one key — `3` is Terminal because Terminal is view 3, exactly as `Ctrl-Alt-3` is, and a digit past the last view refuses aloud in the same words. **In Insert a digit is text** and goes to whatever holds the caret: the prompt box, the search line, a rename field, the Files filter, a question card's option marks, and the terminal, where it is typed into the session. That is the whole difference between the two spellings, and the reason the three-key chord is still here: `Ctrl-Alt-3` switches a view *while you are writing a prompt*, and a bare `3` cannot. Matched by the KEY'S POSITION, so an AZERTY digit row works unshifted; `Shift+number` is a different keystroke and is bound to nothing. A bare `0` is bound to nothing either — the zero is `z0`'s and `Mod-0`'s |
| `Mod-d` / `Mod-u` | Half a screen down / up the FOCUSED PANE's transcript — vim's own `Ctrl-D` / `Ctrl-U`. Half the column's visible height per press, instant, clamped at both ends; scrolling to the top is what reads earlier turns in, exactly as a trackpad scroll there does. **Select only:** with the caret in the prompt box, on a question card or in the terminal these two stay that surface's own, where `Ctrl-D` is delete-forward (and EOF) and `Ctrl-U` deletes to the start of the line. **The one letter pair that answers Ctrl as well as Cmd** — every other `Mod-<letter>` is the command modifier alone, and these two kept Control because that is where a vim user's hand goes |
| `<` / `>` | Narrow / widen the focused side pane |
| `Escape` | Cancel whatever is half-typed |

Chord prefixes — press the first key, then the second:

| Chord | Action |
|---|---|
| `gg` | Jump to the first session |
| `gt` / `gT` | Next / previous project |
| `gm` | Move the focused session's project into a folder, or out of one |
| `yy` | Copy this session's newest turn's proposed commands. Against a real session there usually are none yet — the factory has no event that carries one — and the chord says so ("no command to copy") rather than copying nothing |
| `z0` | Reset both panes to their default widths |
| `zs` / `zv` | Split the focused tab — `zs` horizontally (stacked), `zv` vertically (side by side); dragging a tab onto the detail pane does the same, and only within one project |
| `zc` | Close the focused split — the session keeps running |
| `zw` / `zW` | Move the keyboard to the next / previous split |
| `zf` | Focus view on or off — fold every turn's working away (the tool calls it made, listed under its progress line), leaving your prompts and the agent's answers. A folded turn keeps `···` where its working was; press that and the turn comes back on its own. Nothing is folded from a turn whose tools failed, or from the newest turn while the session is working or waiting. `z` is vim's fold prefix and vam's display prefix, and a bare chord is contested by no browser — see *In a browser tab* below |

## In the Files tab

The Files tab has a keyboard of its own: a file TREE on the right, an editor
in the middle, and these move between them. They are LOCAL to that tab — every
chord in the two tables above still works while the keyboard is in it, and
anything not named here falls straight through to them. A key that cannot act
says so, in the tab, rather than doing nothing.

| In the Files tab | Action |
|---|---|
| `Mod-Shift-e` | Move the keyboard between the editor and the tree — the same chord both ways, because it is one act rather than two. `Cmd+Shift+E` is what VS Code and orca both use to reach a file explorer; `Mod-e` is macOS's own "use selection for find" in every text view, so it is not free |
| `j` / `k` | Walk down / up the tree, one row at a time, stopping at the ends — the same thing they do to the session list in Select |
| `l` | Open the directory under the cursor; press it again to step into it. On a file, open it in the editor and leave the keyboard on the tree |
| `h` | Shut the directory under the cursor, or step out to the one holding it. At the top of the tree it says so rather than doing nothing |
| `Enter` | Open the file under the cursor AND put the caret in the editor. On a directory, open or shut it |
| `/` | Put the caret in the tree's filter box. `Enter` there hands the keyboard to the first matching row |
| `Mod-p` | Search the files — the same filter box, reached from ANYWHERE while this tab is the view on screen: the tree, the editor, the rendered markdown, either box, and Select mode with the keyboard on none of them (the view pill you just clicked, or nowhere at all after `Escape`). `/` cannot do that, because in the editor it is a character you are typing into a file. A second press selects what is already in the box, so it starts a new search rather than appending to a stale one. It is inert in every other view, so `Cmd+P` is still the browser's own key there. `Cmd+P` is "go to file" in VS Code and Sublime, and vam's own grammar leaves it unbound |
| `Tab` / `Shift-Tab` | Indent / outdent in the editor — trapped there, never a focus move, because `Escape` and `Mod-[` are both real ways out already |
| `Mod-s` | Save the open file. vam takes this before the browser's own "Save Page" |
| `Mod-Shift-f` | Format the open file — vam's own formatter, not the project's. It reformats only where it can prove it changed nothing but whitespace (`.json`, and the blank lines and comments of a `.env`/`.ini`) and names what it will not touch: pressing it on a `.ts` says so rather than doing nothing |
| `Mod-Shift-m` | Switch a markdown file between the rendered document and its raw text — the same act as the toggle beside Format. The rendered view is read-only, and unsaved edits survive the switch both ways. On any other file type it says so rather than doing nothing |
| `Mod-z` | Undo the last format, exactly, while the file is still what that format produced. Type one character and it is not vam's key any more: the browser's own undo of your typing gets it, as it always has |
| `Escape` / `Mod-[` | Hand the keyboard back to Select — from the editor, the tree, the filter box or the new-file box. Never a discard: unsaved text survives it, exactly as it survives switching files, tabs and sessions |

These are held against the code by `test/keyboard/files-tab.keyboard-doc.test.ts`,
which reads the `In the Files tab` column above and the two key lists
`src/renderer/panels/files-tree.ts` actually dispatches on — so a binding
added without a row, or a row left behind by a binding that went away, fails
`vitest run` rather than reaching an operator.

## In a browser tab

vam ships one keyboard two ways, and only one of them has the keyboard to
itself. In the **desktop app** nothing competes: vam builds its own Electron
menu and leaves out the four items whose key equivalents it wanted, so every
chord above reaches the page. Over **Tailscale Serve** the page is a tab in
Chrome or Safari, and fifteen of these are chords the browser keeps for
itself — zoom, tab selection, and the tab and window lifecycle:

`Mod-0` `Mod-1` `Mod-2` `Mod-3` `Mod-4` `Mod-5` `Mod-6` `Mod-7` `Mod-8`
`Mod-9` `Mod-n` `Mod-t` `Mod-w` `Mod-Shift-[` `Mod-Shift-]`

vam claims every keystroke it acts on, which is everything a page is allowed
to do; a browser is free to act anyway on these, and for zoom and tab
switching it does. Where one of them matters there is another way in:
`Cmd+Shift+H` reaches the session list as well as `Mod-0`, `x` closes a
session as well as `Mod-w`, `o` starts one as well as `Mod-n`, and the tab
ring is walkable with `zw` / `zW`. Leaving the prompt box is `Ctrl-[` — vim's
own Escape, and no browser binds it.

The digit row is the one place that list got HARDER rather than easier. It
used to answer Ctrl+number as well, which Chrome and Safari do not want on
macOS, so an operator in a browser tab had a spelling that got through; the
row is Cmd-only there now and the browser wins every one of the nine.
`Mod-Shift-[` / `]` is contested too, so `zw` / `zW` and `h` / `l` are the
ways to a tab in that deployment. Nothing changes in the desktop app.

This list is held against the grammar by
`test/keyboard/browser-contested-chords.test.ts`, so a new binding that lands
on one of these reddens rather than reaching an operator. Which chords a
browser really swallows is the one thing no test here can measure — keys
injected by Playwright go straight to the renderer and never through the
browser's own accelerators — so the right-hand side of that file is Chrome's
and Apple's documentation, not a measurement.
