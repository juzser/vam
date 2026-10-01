// @vitest-environment happy-dom

/**
 * THE ADHD SKILL CARD, replacing the old concise-output switch.
 *
 * Operator, translated: "turn Concise output in Settings into a card [an Orca
 * screenshot]. Talk about the ADHD skill" -- and the design decision that
 * followed: install the REAL `ayghri/i-have-adhd` skill into the agent's own
 * skills directory, rather than typing vam's own wording of it into a
 * session's first prompt.
 *
 * WHAT THIS FILE CAN AND CANNOT HOLD. It can hold that the card exists, what
 * it shows for each of the three states `readAdhdSkillStatus` can answer, that
 * Install/Remove call the bridge with no path -- only a boolean -- and the
 * migration note. It cannot hold that a byte actually moves on disk: that is
 * `test/main/skills/adhd-skill.test.ts`'s job, over a real temp filesystem.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdhdSkillApi } from '../../src/preload/api.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { AdhdSkillCard } from '../../src/renderer/settings/AdhdSkillCard.js';
import type { AdhdSkillActionResult, AdhdSkillStatus } from '../../src/shared/adhd-skill.js';

afterEach(() => {
  cleanup();
});

const NOT_INSTALLED: AdhdSkillStatus = {
  overall: 'not-installed',
  agents: [
    { agent: 'claude', state: 'not-installed', dir: '/home/op/.claude/skills/i-have-adhd' },
    { agent: 'codex', state: 'not-installed', dir: '/home/op/.agents/skills/i-have-adhd' },
  ],
};

const INSTALLED: AdhdSkillStatus = {
  overall: 'installed',
  agents: [
    { agent: 'claude', state: 'installed', dir: '/home/op/.claude/skills/i-have-adhd' },
    { agent: 'codex', state: 'installed', dir: '/home/op/.agents/skills/i-have-adhd' },
  ],
};

const OUTDATED: AdhdSkillStatus = {
  overall: 'outdated-modified',
  agents: [
    { agent: 'claude', state: 'outdated-modified', dir: '/home/op/.claude/skills/i-have-adhd' },
    { agent: 'codex', state: 'not-installed', dir: '/home/op/.agents/skills/i-have-adhd' },
  ],
};

function fakeApi(initial: AdhdSkillStatus): AdhdSkillApi & {
  installCalls: (boolean | undefined)[];
  removeCalls: number;
  setNext(status: AdhdSkillStatus): void;
} {
  let current = initial;
  const installCalls: (boolean | undefined)[] = [];
  let removeCalls = 0;
  return {
    status: async () => current,
    stars: async () => null,
    install: async (force?: boolean) => {
      installCalls.push(force);
      const result: AdhdSkillActionResult = { status: current, agents: [] };
      return result;
    },
    remove: async () => {
      removeCalls += 1;
      const result: AdhdSkillActionResult = { status: current, agents: [] };
      return result;
    },
    installCalls,
    get removeCalls() {
      return removeCalls;
    },
    setNext(status: AdhdSkillStatus) {
      current = status;
    },
  } as unknown as AdhdSkillApi & {
    installCalls: (boolean | undefined)[];
    removeCalls: number;
    setNext(status: AdhdSkillStatus): void;
  };
}

function open(props: {
  readonly prefs?: Prefs;
  readonly api?: AdhdSkillApi;
  readonly onChange?: (next: Prefs) => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <AdhdSkillCard prefs={props.prefs ?? EMPTY_PREFS} api={props.api} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

const pill = () => document.querySelector('[data-adhd-skill-pill]');
const install = () => document.querySelector<HTMLButtonElement>('[data-adhd-skill-install]');
const recheck = () => document.querySelector<HTMLButtonElement>('[data-adhd-skill-recheck]');
const remove = () => document.querySelector<HTMLButtonElement>('[data-adhd-skill-remove]');
const confirmYes = () => document.querySelector<HTMLButtonElement>('[data-adhd-skill-confirm-yes]');
const confirmNo = () => document.querySelector<HTMLButtonElement>('[data-adhd-skill-confirm-no]');
const migrationNote = () => document.querySelector('[data-adhd-skill-migration]');
const migrationDismiss = () =>
  document.querySelector<HTMLButtonElement>('[data-adhd-skill-migration-dismiss]');
const agentChip = (agent: string) => document.querySelector(`[data-adhd-skill-agent="${agent}"]`);
const browserNote = () => document.querySelector('[data-adhd-skill-browser]');

describe('no bridge — the browser build', () => {
  it('draws the title and hint, but no button, pill or chip', () => {
    open({ api: undefined });
    expect(document.querySelector('[data-settings-block="adhd-skill"]')).not.toBeNull();
    expect(install()).toBeNull();
    expect(recheck()).toBeNull();
    expect(remove()).toBeNull();
    expect(browserNote()?.textContent?.toLowerCase()).toMatch(/desktop app/);
  });
});

describe('status: not installed', () => {
  it('shows the pill, an Install button, and no Remove button', async () => {
    const api = fakeApi(NOT_INSTALLED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/not installed/i));
    expect(install()?.textContent).toMatch(/install/i);
    expect(remove()).toBeNull();
  });

  it('installs with no force, and refreshes to show both agents installed', async () => {
    const api = fakeApi(NOT_INSTALLED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/not installed/i));
    api.setNext(INSTALLED);
    fireEvent.click(install() as HTMLButtonElement);
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    expect(api.installCalls).toEqual([false]);
    expect(agentChip('claude')?.textContent).toMatch(/installed/i);
    expect(agentChip('codex')?.textContent).toMatch(/installed/i);
  });
});

describe('status: installed', () => {
  it('shows a Remove button, and remove() is called with nothing', async () => {
    const api = fakeApi(INSTALLED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    api.setNext(NOT_INSTALLED);
    fireEvent.click(remove() as HTMLButtonElement);
    await waitFor(() => expect(pill()?.textContent).toMatch(/not installed/i));
    expect(api.removeCalls).toBe(1);
  });

  it('re-check reads status again', async () => {
    const api = fakeApi(INSTALLED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    api.setNext(OUTDATED);
    fireEvent.click(recheck() as HTMLButtonElement);
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
  });

  // SETTINGS-VIEWS RESTRUCTURE, ITEM E: fully installed used to still read
  // "Install" -- only `outdated-modified` earned "Reinstall". An operator
  // with the skill already on disk pressing a button that still says
  // "Install" reads as "nothing happened yet", not as "do it again".
  it('reads Reinstall, not Install, now that both agents already have it', async () => {
    const api = fakeApi(INSTALLED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    expect(install()?.textContent).toMatch(/reinstall/i);
  });

  // REFRESHES IMMEDIATELY, THE OTHER HALF OF ITEM E: the button's own label
  // follows `status`, which `runInstall` sets from the bridge's own
  // response -- no second read, no stale "Install" surviving a successful
  // install. `NOT_INSTALLED -> INSTALLED` above (`describe('status: not
  // installed')`) already covers the pill; this covers the BUTTON, the
  // other place the same `status` value is read.
  it("the install button's own label refreshes immediately after installing, with no second read", async () => {
    const api = fakeApi(NOT_INSTALLED);
    open({ api });
    await waitFor(() => expect(install()?.textContent).toMatch(/install/i));
    expect(install()?.textContent).not.toMatch(/reinstall/i);
    api.setNext(INSTALLED);
    fireEvent.click(install() as HTMLButtonElement);
    await waitFor(() => expect(install()?.textContent).toMatch(/reinstall/i));
  });
});

const PARTIAL: AdhdSkillStatus = {
  overall: 'installed',
  agents: [
    { agent: 'claude', state: 'installed', dir: '/home/op/.claude/skills/i-have-adhd' },
    { agent: 'codex', state: 'not-installed', dir: '/home/op/.agents/skills/i-have-adhd' },
  ],
};

describe('status: partially installed', () => {
  it('labels the button Repair, and the coverage grid says which agent is missing', async () => {
    const api = fakeApi(PARTIAL);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    expect(install()?.textContent).toMatch(/repair/i);
    expect(agentChip('claude')?.textContent).toMatch(/installed/i);
    expect(agentChip('codex')?.textContent).toMatch(/missing/i);
  });

  it('reads Reinstall, not Repair, when the missing half is a content mismatch rather than an absence', async () => {
    // OUTDATED already carries one agent `outdated-modified` and the other
    // `not-installed` -- partial BY ABSENCE too, but a content mismatch
    // outranks it (`isAdhdSkillPartiallyInstalled`'s own header explains
    // why): "Reinstall" is the honest word for "vam found bytes it does not
    // trust", and "Repair" would undersell that this needs the confirm step
    // Reinstall still asks for below.
    const api = fakeApi(OUTDATED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    expect(install()?.textContent).toMatch(/reinstall/i);
    expect(install()?.textContent).not.toMatch(/repair/i);
  });

  it('repairs by calling install with no force, the same as a fresh install', async () => {
    const api = fakeApi(PARTIAL);
    open({ api });
    await waitFor(() => expect(install()?.textContent).toMatch(/repair/i));
    api.setNext(INSTALLED);
    fireEvent.click(install() as HTMLButtonElement);
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    expect(api.installCalls).toEqual([false]);
  });
});

describe('status: outdated or modified', () => {
  it('reads Reinstall, and asks for confirmation before overwriting', async () => {
    const api = fakeApi(OUTDATED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    expect(install()?.textContent).toMatch(/reinstall/i);
    fireEvent.click(install() as HTMLButtonElement);
    // NOT CALLED YET -- the confirm has to be answered first.
    expect(api.installCalls).toEqual([]);
    expect(confirmYes()).not.toBeNull();
  });

  it('cancelling the confirm calls nothing', async () => {
    const api = fakeApi(OUTDATED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    fireEvent.click(install() as HTMLButtonElement);
    fireEvent.click(confirmNo() as HTMLButtonElement);
    expect(api.installCalls).toEqual([]);
    expect(confirmYes()).toBeNull();
  });

  it('confirming calls install(true)', async () => {
    const api = fakeApi(OUTDATED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    api.setNext(INSTALLED);
    fireEvent.click(install() as HTMLButtonElement);
    fireEvent.click(confirmYes() as HTMLButtonElement);
    await waitFor(() => expect(pill()?.textContent).toMatch(/^installed$/i));
    expect(api.installCalls).toEqual([true]);
  });
});

describe('the migration note', () => {
  it('is drawn only for an operator who had the old switch on', async () => {
    const api = fakeApi(NOT_INSTALLED);
    open({ api, prefs: { ...EMPTY_PREFS, conciseOutput: false } });
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(migrationNote()).toBeNull();
  });

  it('is drawn, and dismissing it clears the preference without installing anything', async () => {
    const api = fakeApi(NOT_INSTALLED);
    const { onChange } = open({ api, prefs: { ...EMPTY_PREFS, conciseOutput: true } });
    await waitFor(() => expect(migrationNote()).not.toBeNull());
    expect(migrationNote()?.textContent?.toLowerCase()).toMatch(/adhd skill/);
    fireEvent.click(migrationDismiss() as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conciseOutput: false }));
    expect(api.installCalls).toEqual([]);
  });

  it('a successful install also clears the flag, on its own', async () => {
    const api = fakeApi(NOT_INSTALLED);
    const { onChange } = open({ api, prefs: { ...EMPTY_PREFS, conciseOutput: true } });
    await waitFor(() => expect(install()).not.toBeNull());
    api.setNext(INSTALLED);
    fireEvent.click(install() as HTMLButtonElement);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conciseOutput: false })),
    );
  });
});

describe('agent coverage', () => {
  it('names both agents and reads their state honestly', async () => {
    const api = fakeApi(OUTDATED);
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    expect(agentChip('claude')?.textContent).toMatch(/claude/i);
    expect(agentChip('claude')?.textContent).toMatch(/modified/i);
    expect(agentChip('codex')?.textContent).toMatch(/codex/i);
    expect(agentChip('codex')?.textContent).toMatch(/missing/i);
  });
});

describe('path confinement', () => {
  it('never calls install or remove with anything other than a boolean or nothing', async () => {
    const api = fakeApi(OUTDATED);
    const installSpy = vi.spyOn(api, 'install');
    const removeSpy = vi.spyOn(api, 'remove');
    open({ api });
    await waitFor(() => expect(pill()?.textContent).toMatch(/outdated/i));
    fireEvent.click(install() as HTMLButtonElement);
    fireEvent.click(confirmYes() as HTMLButtonElement);
    await waitFor(() => expect(installSpy).toHaveBeenCalled());
    for (const call of installSpy.mock.calls) {
      expect(call.length).toBeLessThanOrEqual(1);
      if (call.length === 1) expect(typeof call[0]).toBe('boolean');
    }
    for (const call of removeSpy.mock.calls) {
      expect(call.length).toBe(0);
    }
  });
});
