/**
 * The one source main serves today: a small bundled sample.
 *
 * It is a sample and it says so -- every capability is `false` and every
 * `false` carries a decline in the source's own words. That is a legal state
 * of the port, and it is the honest description of this shell: it can read,
 * it cannot write, and nothing pushes at it. A source that declared
 * `liveUpdates: true` here would be a source the canvas draws a live badge
 * for and no event ever arrives at.
 *
 * A real transport (main's own HTTP client, never the renderer's) is a later
 * task; what this task proves is that WHATEVER main holds crosses the bridge
 * with every field intact.
 */

import type { Project } from '../../renderer/domain/model.js';
import type { SourceDescriptor } from '../../shared/preload-api.js';
import type { MainSource } from './source.js';

const NOT_YET = 'the desktop shell reads only; no write path has been wired to this source yet';
const NO_BACKEND = 'the bundled sample has no backend to ask';

const DESCRIPTOR: SourceDescriptor = {
  id: 'bundled-sample',
  label: 'sample (bundled) -- fictional data, not a live CLI',
  capabilities: {
    liveUpdates: false,
    recordPrompt: false,
    deliverPrompt: false,
    promptAttachments: false,
    slashCommands: false,
    renameSession: false,
    closeSession: false,
    createSession: false,
    governance: false,
    pullRequests: false,
    terminal: false,
    agentRoster: false,
  },
  declines: {
    liveUpdates: 'the bundled sample never changes, and nothing pushes at it',
    recordPrompt: NOT_YET,
    deliverPrompt: NOT_YET,
    promptAttachments: NOT_YET,
    slashCommands: NO_BACKEND,
    renameSession: NOT_YET,
    closeSession: NOT_YET,
    createSession: NOT_YET,
    governance: NO_BACKEND,
    pullRequests: NO_BACKEND,
    terminal: 'the desktop shell holds no PTY',
    agentRoster: NO_BACKEND,
  },
  viewerScope: {
    kind: 'connection',
    note: 'the rows ship inside the application; there is no other viewer to leak to',
  },
};

const PROJECTS: readonly Project[] = [
  {
    id: 'vam',
    name: 'vam',
    source: 'bundled-sample',
    sessions: [
      {
        id: 'vam-electron-shell/task-4',
        title: 'task-4-load-ipc',
        icon: null,
        epic: 'vam-electron-shell',
        status: 'waiting',
        runningAgents: 0,
        activity: null,
        age: '2m',
        branch: null,
        decisions: [
          {
            id: 'd-1',
            label: 'coder',
            input: 'wire load() across the bridge',
            output: 'the descriptor governs which members exist',
            commands: [{ id: 'c-1', label: 'run the unit gates', command: 'pnpm test' }],
          },
        ],
      },
      {
        id: 'vam-electron-shell/task-5',
        title: 'task-5-push',
        icon: '○',
        epic: 'vam-electron-shell',
        status: 'running',
        runningAgents: 1,
        activity: 'waiting on task 4',
        age: null,
        branch: null,
        decisions: [
          { id: 'd-2', label: 'gate', input: 'is the shell live yet?', output: null, commands: [] },
        ],
      },
    ],
  },
];

export const FIXTURE_SOURCE: MainSource = {
  descriptor: DESCRIPTOR,
  load: () => Promise.resolve(PROJECTS),
};
