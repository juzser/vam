/**
 * The command a NEW vam session runs: the operator's login shell.
 *
 * NOT THE PROVIDER'S COMMAND, and the difference is the whole of
 * `docs/design/vam-owns-the-session.md`'s Stage 2. A pane that starts by
 * running `claude` exists only for as long as `claude` does, and it has no
 * state in which the operator can choose what runs in it: the choice was
 * spent at spawn time by whoever pressed `+`. A pane that starts as a shell
 * is real from the first frame -- the Terminal view draws it before anything
 * has been decided -- and the provider is typed into it afterwards, by the
 * Start session button or by the operator's own hand. Both land in the same
 * pane and produce the same row.
 *
 * SPELLED OUT RATHER THAN LEFT TO TMUX. `new-session` with no command runs
 * `default-shell` as a login shell, which is exactly what this wants -- but
 * `newSessionArgv` (`argv.ts`) refuses an empty command on purpose, because
 * for every OTHER caller a missing command means an agent silently replaced
 * by a prompt. So the shell is named here, as an argv, and the guard keeps
 * guarding.
 *
 * `-l` IS THE LOGIN FLAG FOR EVERY SHELL THIS CAN NAME -- sh, bash, zsh, fish,
 * ksh -- and it matters: a login shell reads the profile that puts `claude`
 * and `codex` on PATH, which is what makes typing either by hand work in
 * this pane the way it works in the operator's own terminal. tmux does the
 * same for its default by prefixing `argv[0]` with `-`, which a caller
 * passing argv cannot do.
 *
 * `$SHELL` IS TRUSTED ONLY AS AN ABSOLUTE PATH. A bare word would be looked
 * up on the tmux SERVER's PATH, which is whatever environment first started
 * that server and not the operator's; a value beginning with `-` is what
 * `newSessionArgv` reads as an option. `/bin/sh` is the fallback because it
 * exists on every machine tmux does, and a GUI-launched vam may well carry no
 * `$SHELL` at all (`env/resolve-path.ts` measures that launch).
 */
import { PROVIDERS, type ProviderId } from '../../../shared/providers.js';

export function loginShellCommand(
  env: { readonly SHELL?: string } = process.env,
): readonly string[] {
  const shell = env.SHELL;
  const program = shell !== undefined && shell.startsWith('/') ? shell : '/bin/sh';
  return [program, '-l'];
}

/**
 * The shells a pane's foreground process can be, as `pane_current_command`
 * names them. Every one `loginShellCommand` could resolve to, plus the ones
 * a `default-shell` or an operator's `chsh` commonly is.
 */
const SHELLS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'ksh',
  'dash',
  'tcsh',
  'csh',
  'nu',
  'elvish',
  'xonsh',
]);

/**
 * Is what is in the foreground of a pane a SHELL -- meaning nothing has been
 * started in it -- rather than an agent or anything else?
 *
 * WHAT IT DECIDES. A vam pane begins as a shell (`loginShellCommand`) and
 * holds an agent only once one has been typed into it, so the foreground
 * command is the one fact that separates "a pane with nothing in it" from "a
 * pane with something in it that no source has paired yet". `paneForRow`
 * (`claude-code/reply.ts`) uses it as a VETO: a pane whose foreground is a
 * shell cannot be the pane an agent is running in, whatever the project tag
 * says. `pane-row.ts` uses it to draw the empty state, with the Start
 * session button, only where there is genuinely nothing running.
 *
 * ABSENCE IS NOT A SHELL. A listing that carried no command -- a stubbed
 * runner, a tmux too old for the format -- says nothing, and `false` here is
 * what lets every caller fall back to exactly what it did before the field
 * existed. So the veto never fires on silence, and the empty state is drawn
 * for such a pane by the older rule alone (unpaired means empty).
 *
 * A leading `-` is stripped: a login shell's `argv[0]` wears one, and whether
 * tmux reports the `comm` or the `argv[0]` is not a thing worth being wrong
 * about.
 */
export function isShellCommand(command: string | undefined): boolean {
  if (command === undefined || command === '') return false;
  return SHELLS.has(command.startsWith('-') ? command.slice(1) : command);
}

/**
 * WHICH PROVIDER (if any) IS RUNNING IN A PANE, from the exact same fact
 * `isShellCommand` above reads -- `pane_current_command` -- classified one
 * step further. Lives beside it rather than in either provider's own source
 * module because it is a SECOND question about the identical field, not a
 * new one: `isShellCommand` answers "is anything running here at all?",
 * this answers "if so, which of vam's two providers?" -- and both callers
 * (`sources/claude-code/pane-row.ts`, building a row's `runningProvider`;
 * `terminal/start-screen.ts`, aiming an ACTIVE wait's fast poll) need the
 * identical classifier, not two.
 *
 * THREE STATES, the same shape `isShellCommand`'s own "ABSENCE IS NOT A
 * SHELL" rule already established: `undefined` for a listing with no command
 * at all, OR a command `isShellCommand` recognises -- a shell is not a
 * provider either, and the two silences must read the same way to a caller
 * deciding whether to draw the ordinary empty-pane screen. `null` for a
 * foreground command that is neither shell nor provider -- confirmed
 * running, unidentified (an `htop`, an editor, anything the operator typed
 * by hand that names neither table entry). The `ProviderId` once the
 * command matches the table directly (`codex`'s own bare command) or
 * `claude`'s own measured quirk: its foreground command is a bare version
 * string (e.g. `2.1.282`), never the word `claude`, on its ready screen AND
 * its blocking dialogs alike (`sources/claude-code/start-screen.ts`'s own
 * header, measured against the real CLI).
 */
const CLAUDE_VERSION_COMMAND = /^\d+\.\d+\.\d+$/;

export function identifyRunningProvider(
  command: string | undefined,
): ProviderId | null | undefined {
  if (command === undefined || command === '') return undefined;
  if (isShellCommand(command)) return undefined;
  const bare = command.startsWith('-') ? command.slice(1) : command;
  const direct = PROVIDERS.find((provider) => provider.command[0] === bare);
  if (direct !== undefined) return direct.id;
  return CLAUDE_VERSION_COMMAND.test(bare) ? 'claude-code' : null;
}
