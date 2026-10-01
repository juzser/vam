// @vitest-environment happy-dom

/**
 * THE SKILL ROW (Settings -> Skills): title, the repo link led by GitHub's
 * mark, the star count after lucide's `Star`, then the status pill; the
 * description clamped to two lines; and no "pinned to" sentence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdhdSkillApi } from '../../src/preload/api.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { AdhdSkillCard } from '../../src/renderer/settings/AdhdSkillCard.js';
import {
  ADHD_SKILL_PINNED_SHA,
  ADHD_SKILL_SOURCE_URL,
  type AdhdSkillStatus,
} from '../../src/shared/adhd-skill.js';

const INSTALLED: AdhdSkillStatus = {
  overall: 'installed',
  agents: [
    { agent: 'claude', state: 'installed', dir: '/home/op/.claude/skills/i-have-adhd' },
    { agent: 'codex', state: 'installed', dir: '/home/op/.agents/skills/i-have-adhd' },
  ],
};

function stubApi(stars: AdhdSkillApi['stars']): AdhdSkillApi {
  return {
    status: async () => INSTALLED,
    install: async () => ({ status: INSTALLED, agents: [] }),
    remove: async () => ({ status: INSTALLED, agents: [] }),
    stars,
  };
}

const openLink = vi.fn(async (_url: string) => true);

beforeEach(() => {
  openLink.mockClear();
  (globalThis.window as unknown as { api?: unknown }).api = { link: { open: openLink } };
});

afterEach(() => {
  cleanup();
  (globalThis.window as unknown as { api?: unknown }).api = undefined;
});

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

function follows(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('the skill row layout (EC-53)', () => {
  it('orders title, repo link, star count, status pill', async () => {
    render(
      <AdhdSkillCard
        prefs={EMPTY_PREFS}
        onChange={vi.fn()}
        api={stubApi(async () => ({ stars: 1234 }))}
      />,
    );
    await waitFor(() => expect(q('[data-skill-stars]')).not.toBeNull());
    await waitFor(() => expect(q('[data-adhd-skill-pill]')).not.toBeNull());
    const title = q('h4') as HTMLElement;
    const link = q('[data-skill-repo-link]') as HTMLElement;
    const stars = q('[data-skill-stars]') as HTMLElement;
    const pill = q('[data-adhd-skill-pill]') as HTMLElement;
    expect(follows(title, link)).toBe(true);
    expect(follows(link, stars)).toBe(true);
    expect(follows(stars, pill)).toBe(true);

    expect(link.firstElementChild?.hasAttribute('data-github-mark')).toBe(true);
    expect(link.textContent).toBe('ayghri/i-have-adhd (MIT)');

    expect(stars.getAttribute('aria-label')).toBe('1,234 stars on GitHub');
    expect(stars.textContent).toContain('1,234');
    const icon = stars.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('class')).toContain('lucide-star');
  });

  it('opens the repo through link.open, exactly once per click', async () => {
    render(
      <AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={stubApi(async () => null)} />,
    );
    fireEvent.click(q('[data-skill-repo-link]') as HTMLElement);
    expect(openLink).toHaveBeenCalledTimes(1);
    expect(openLink).toHaveBeenCalledWith(ADHD_SKILL_SOURCE_URL);
  });

  it('clamps the description to two lines', () => {
    render(<AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={undefined} />);
    const hint = Array.from(document.querySelectorAll('p')).find((p) =>
      /scannable answers/.test(p.textContent ?? ''),
    );
    expect(hint?.className).toContain('line-clamp-2');
  });

  it('a row with no repo draws no link, no mark and no stars', async () => {
    const stars = vi.fn(async () => ({ stars: 5 }));
    render(
      <AdhdSkillCard
        prefs={EMPTY_PREFS}
        onChange={vi.fn()}
        api={stubApi(stars)}
        repo={undefined}
      />,
    );
    await waitFor(() => expect(q('[data-adhd-skill-pill]')).not.toBeNull());
    expect(q('[data-skill-repo-link]')).toBeNull();
    expect(q('[data-github-mark]')).toBeNull();
    expect(q('[data-skill-stars]')).toBeNull();
  });
});

describe('"Pinned to" is gone (EC-54)', () => {
  it('the card text carries neither "pinned to" nor the sha prefix', async () => {
    render(
      <AdhdSkillCard
        prefs={EMPTY_PREFS}
        onChange={vi.fn()}
        api={stubApi(async () => ({ stars: 3 }))}
      />,
    );
    await waitFor(() => expect(q('[data-adhd-skill-pill]')).not.toBeNull());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/pinned to/i);
    expect(text).not.toContain(ADHD_SKILL_PINNED_SHA.slice(0, 7));
  });

  it('strings.ts no longer holds settings.behaviour.adhd.credit', () => {
    const src = readFileSync(join(process.cwd(), 'src/renderer/i18n/strings.ts'), 'utf8');
    expect(src).not.toMatch(/'settings\.behaviour\.adhd\.credit'/);
  });
});

describe('the star count is absent, never 0 (EC-55, renderer half)', () => {
  it('while the read is pending', () => {
    render(
      <AdhdSkillCard
        prefs={EMPTY_PREFS}
        onChange={vi.fn()}
        api={stubApi(() => new Promise(() => {}))}
      />,
    );
    expect(q('[data-skill-stars]')).toBeNull();
  });

  it('when the read answers null', async () => {
    const stars = vi.fn(async () => null);
    render(<AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={stubApi(stars)} />);
    await waitFor(() => expect(stars).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(q('[data-adhd-skill-pill]')).not.toBeNull());
    expect(q('[data-skill-stars]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0\b/);
  });

  it('when the read rejects', async () => {
    const stars = vi.fn(async () => Promise.reject(new Error('bridge')));
    render(<AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={stubApi(stars)} />);
    await waitFor(() => expect(stars).toHaveBeenCalledTimes(1));
    expect(q('[data-skill-stars]')).toBeNull();
  });

  it('when there is no bridge, and the link still shows', () => {
    render(<AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={undefined} />);
    expect(q('[data-skill-stars]')).toBeNull();
    expect(q('[data-skill-repo-link]')).not.toBeNull();
  });

  it('asks once when the row mounts', async () => {
    const stars = vi.fn(async () => ({ stars: 1 }));
    render(<AdhdSkillCard prefs={EMPTY_PREFS} onChange={vi.fn()} api={stubApi(stars)} />);
    await waitFor(() => expect(q('[data-skill-stars]')).not.toBeNull());
    expect(stars).toHaveBeenCalledTimes(1);
  });
});
