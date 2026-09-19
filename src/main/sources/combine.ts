/**
 * MAIN HOLDS A LIST OF SOURCES, and this is what a list answers as.
 *
 * vam spoke to exactly one source, in three places -- `main/index.ts`,
 * `ipc/handlers.ts` and `remote/server.ts` -- and every one of them held a
 * single `MainSource`. `docs/design/a-second-source.md` calls that the blocker
 * and Stage 0 "nothing but turning that one into a list". This module is that
 * turn: the three sites now hold `readonly MainSource[]`, and this folds the
 * list back into the single object the bridge's shape still requires.
 *
 * ── A LIST OF ONE IS ITS MEMBER, IDENTICALLY ──────────────────────────────
 *
 * `combineSources([x]) === x`, by reference. That is not an optimisation; it
 * is how Stage 0 can be reviewed as an architecture change with no behaviour
 * in it. Anything this module does to a descriptor, a project list or a write
 * is unreachable while vam serves one source, so the commit that introduces
 * the list cannot also have changed what vam does.
 *
 * ── WHY IT FOLDS AT ALL, RATHER THAN THE BRIDGE CARRYING THE LIST ─────────
 *
 * `contextBridge.exposeInMainWorld` runs once, before any source is known
 * (`shared/preload-api.ts` explains at length), so the renderer's channel set
 * is fixed: one `describe`, one `load`, one `recordPrompt`. Carrying N sources
 * across it would mean a source id on every channel and a factory that builds
 * N ports -- a change to the preload contract, the HTTP transport, the remote
 * server and the phone, for no fact that cannot travel as data instead.
 *
 * So capability travels as data, the way it already does: the combined
 * descriptor is the OR of its members and carries every member's own
 * descriptor WHOLE, in `members`. A consumer that only ever asked "can this
 * app do X" reads the top level and is unaffected; a consumer that must ask
 * "can THIS ROW do X" -- the Terminal tab, the model control -- reads the
 * member whose id is the row's `Session.source`.
 *
 * ── ROUTING IS BY WHAT A SOURCE CLAIMED, NEVER BY THE SHAPE OF AN ID ──────
 *
 * Every `Project` and every `Session` already carries `source`, so `load()`
 * is the moment each source says which rows are its own. This remembers that
 * and routes each later write to the source that produced the row. It does NOT
 * sniff the id: Claude Code keys a row `<sessionId>#<pid>` and Codex keys one
 * on a bare UUID, and a router that told them apart by pattern would be one
 * CLI release away from delivering a prompt to the wrong agent.
 *
 * A session nobody has claimed is REFUSED, by name. Falling through to the
 * first source would be the same bug wearing a default's clothes.
 *
 * ── WHAT A PARTIAL FAILURE COSTS, NAMED, BECAUSE IT IS NOT NOTHING ────────
 *
 * `load()` resolves with whatever members answered and rejects only when NONE
 * did. One broken source must not blank a canvas the other source's rows are
 * on -- `useSourceModel` keeps no model at all until the first load succeeds,
 * so an all-or-nothing fold would mean a missing Codex store hid every Claude
 * Code session.
 *
 * The cost is that a partial failure is SILENT: the port gives `load()` one
 * channel for "vam could not read" -- a rejection -- and it is already spent
 * on the total case. `Session.pullRequests` and `TranscriptPage` both solved
 * this by putting an `unavailable` arm in the ANSWER, and that is what
 * `load()` needs too; it is a port change, not this module's, and it is not
 * pretended away here. What Stage 1 does instead is make the one source that
 * could plausibly be missing never reject: `codex/source.ts` states its own
 * absence in its DESCRIPTOR, at startup, in its own words.
 */

import type { Project } from '../../renderer/domain/model.js';
import type { SourceCapabilities, SourceDeclines } from '../../renderer/sources/port.js';
import type { AgentWork } from '../../shared/agent-work.js';
import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import type { SourceDescriptor } from '../../shared/preload-api.js';
import type { SourceError } from '../ipc/channels.js';
import type { MainSource } from './source.js';

/** Every capability, so a combined descriptor can never omit one silently. */
const CAPABILITIES: readonly (keyof SourceCapabilities)[] = [
  'liveUpdates',
  'recordPrompt',
  'deliverPrompt',
  'promptAttachments',
  'slashCommands',
  'renameSession',
  'closeSession',
  'createSession',
  'governance',
  'pullRequests',
  'terminal',
  'agentRoster',
];

const NO_SOURCES = 'vam was started with no sources at all, so there is nothing to ask';

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

const unknownSession = (sessionId: string): SourceError =>
  refused(
    'unknown-session',
    `no source has claimed the session "${sessionId}"; vam will not guess which one to ask`,
  );

/**
 * The descriptor of a list of none: every capability withdrawn, every
 * withdrawal explained. A legal state of the port and the honest description
 * of a vam with nothing wired -- never an empty project list on its own,
 * which would read as "you have no sessions".
 */
function emptyDescriptor(): SourceDescriptor {
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((key) => [key, false]),
  ) as unknown as SourceCapabilities;
  const declines = Object.fromEntries(
    CAPABILITIES.map((key) => [key, NO_SOURCES]),
  ) as SourceDeclines;
  return {
    id: 'none',
    label: 'no sources',
    capabilities,
    declines,
    viewerScope: { kind: 'connection', note: 'there is no source, so there is nothing to see' },
    members: [],
  };
}

/**
 * The OR of the members' capabilities, and the members themselves.
 *
 * A DECLINE IS WRITTEN ONLY WHERE THE COMBINATION REALLY CANNOT, which is the
 * rule `port.ts` states and the one a naive merge breaks: if one source has a
 * terminal and the other does not, the app HAS one, and copying the second
 * source's "no pane here" up to the top level would explain away an
 * affordance that exists. Where every member declines, every member's words
 * are kept and attributed -- two sources have two reasons and neither is the
 * other's.
 */
function combineDescriptors(sources: readonly MainSource[]): SourceDescriptor {
  const members = sources.map((s) => s.descriptor);
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((key) => [key, members.some((m) => m.capabilities[key])]),
  ) as unknown as SourceCapabilities;
  const declines: Record<string, string> = {};
  for (const key of CAPABILITIES) {
    if (capabilities[key]) continue;
    const words = members
      .map((m) => (m.declines[key] === undefined ? null : `${m.label}: ${m.declines[key]}`))
      .filter((w): w is string => w !== null);
    if (words.length > 0) declines[key] = words.join(' — ');
  }
  return {
    id: members.map((m) => m.id).join('+'),
    label: members.map((m) => m.label).join(' + '),
    capabilities,
    declines: declines as SourceDeclines,
    // `unscoped` is not a confession of a leak here -- each member states its
    // own scope in `members` -- but the COMBINATION cannot promise one
    // sentence about several backends, and inventing one would be exactly the
    // lie `ViewerScope`'s honesty clause is about.
    viewerScope: {
      kind: 'unscoped',
      warning: `vam is serving ${members.length} sources at once; each states its own scope, and this combination speaks for none of them`,
    },
    members,
  };
}

/**
 * One object over a list of sources: the descriptor is the OR, the projects
 * are the concatenation, and every write goes to the source that produced the
 * row it names.
 */
export function combineSources(sources: readonly MainSource[]): MainSource {
  // A list of one IS its member. See the header: this is what makes Stage 0
  // provably free of behaviour.
  if (sources.length === 1 && sources[0] !== undefined) return sources[0];
  if (sources.length === 0) {
    return { descriptor: emptyDescriptor(), load: () => Promise.resolve([]) };
  }

  const descriptor = combineDescriptors(sources);
  // Filled by `load()`, which is the only moment a source says what is its
  // own. Empty until then, and a write before then is refused rather than
  // sent somewhere plausible.
  const ownerOfSession = new Map<string, MainSource>();
  const ownerOfProject = new Map<string, MainSource>();

  const load = async (): Promise<readonly Project[]> => {
    const settled = await Promise.allSettled(sources.map((source) => source.load()));
    const projects: Project[] = [];
    const failures: string[] = [];
    ownerOfSession.clear();
    ownerOfProject.clear();
    settled.forEach((result, index) => {
      const source = sources[index];
      if (source === undefined) return;
      if (result.status === 'rejected') {
        const reason = result.reason;
        failures.push(
          `${source.descriptor.label}: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
        return;
      }
      for (const project of result.value) {
        projects.push(project);
        ownerOfProject.set(project.id, source);
        for (const s of project.sessions) ownerOfSession.set(s.id, source);
      }
    });
    // Rejects only when NOBODY answered: with one member still reading, its
    // rows are what the operator asked for and an error is not.
    if (failures.length === settled.length) {
      throw new Error(failures.join('; '));
    }
    return projects;
  };

  const routeWrite = async (
    sessionId: string,
    call: (source: MainSource) => Promise<SourceError | null> | undefined,
  ): Promise<SourceError | null> => {
    const owner = ownerOfSession.get(sessionId);
    if (owner === undefined) return unknownSession(sessionId);
    const performed = call(owner);
    if (performed === undefined) {
      return refused(
        'not-implemented',
        `${owner.descriptor.label} claims this but carries no member for it`,
      );
    }
    return await performed;
  };

  return {
    descriptor,
    load,
    recordPrompt: (sessionId, prompt) =>
      routeWrite(sessionId, (s) => s.recordPrompt?.(sessionId, prompt)),
    closeSession: (sessionId, force) =>
      routeWrite(sessionId, (s) => s.closeSession?.(sessionId, force)),
    createSession: async (projectId, title, provider) => {
      const owner = ownerOfProject.get(projectId);
      if (owner === undefined) {
        return refused(
          'unknown-project',
          `no source has claimed the project "${projectId}"; vam will not guess which one to ask`,
        );
      }
      return (await owner.createSession?.(projectId, title, provider)) ?? null;
    },
    // A DIRECTORY NAMES NO SOURCE, which is the one route with nothing to key
    // on: "new project" happens before any source has seen the place. It goes
    // to the first source that advertises `createSession`, in the order main
    // listed them -- an order that is written down in `main/index.ts` and is
    // therefore reviewable, rather than derived from something the operator
    // cannot see.
    createSessionInDirectory: async (cwd, title, provider) => {
      const owner = sources.find((s) => s.descriptor.capabilities.createSession);
      if (owner === undefined) {
        return refused('unsupported:createSession', 'no source here can start a session');
      }
      return (await owner.createSessionInDirectory?.(cwd, title, provider)) ?? null;
    },
    readHistory: async (
      sessionId: string,
      cursor: HistoryCursor | null,
    ): Promise<TranscriptPage> => {
      const owner = ownerOfSession.get(sessionId);
      const read = owner?.readHistory;
      if (owner === undefined || read === undefined) {
        return {
          kind: 'unavailable',
          error:
            owner === undefined
              ? unknownSession(sessionId)
              : refused(
                  'unsupported:history',
                  `${owner.descriptor.label} cannot read earlier parts of a session`,
                ),
        };
      }
      return await read(sessionId, cursor);
    },
    readAgentWork: async (sessionId: string, agentId: string): Promise<AgentWork> => {
      const owner = ownerOfSession.get(sessionId);
      const read = owner?.readAgentWork;
      if (owner === undefined || read === undefined) {
        return {
          kind: 'unavailable',
          error:
            owner === undefined
              ? unknownSession(sessionId)
              : refused(
                  'unsupported:agent-work',
                  `${owner.descriptor.label} cannot report what a session’s agents are doing`,
                ),
        };
      }
      return await read(sessionId, agentId);
    },
  };
}
