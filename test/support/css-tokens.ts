/**
 * Reading `styles.css` as data.
 *
 * Two guards now measure the palette rather than quoting it -- the text
 * contrast one and the surface elevation one -- and they were about to hold
 * two copies of the same parser. A second copy is how one of them quietly
 * stops matching the file: the rule-body scan below exists because the
 * stylesheet's own header comment NAMES both selectors in prose, and a naive
 * `indexOf(':root')` reads the comment instead of the rule.
 */

/**
 * The text between the braces of the rule whose selector is `selector`. The
 * selector is matched at the start of a line, so the prose in the file's
 * header comment -- which names both of these selectors -- is not mistaken
 * for the rule.
 */
export function ruleBody(css: string, selector: string): string {
  const at = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm').exec(css);
  if (!at) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', at.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

/** Every `--vam-*: <value>;` declaration in a block, by name. */
export function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--vam-[a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim());
  }
  return out;
}

/** The two theme blocks, by the selector that carries each. */
export const THEMES = [
  { name: 'dark', selector: ':root' },
  { name: 'light', selector: 'html.light' },
] as const;
