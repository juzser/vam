/**
 * Provider marks: WHICH AGENT RAN THIS SESSION, as one glyph.
 *
 * Read by the sidebar row (`panels/SessionList.tsx`) and by the status bar
 * (`canvas/Canvas.tsx`, `SourceGlyph`). ONE table and ONE resolver, because
 * the worst outcome here is two surfaces of one application drawing two
 * different marks for one source -- an operator would reasonably read that as
 * two different sources.
 *
 * ── THREE REGISTERS, IN ORDER, AND THE ORDER IS THE POINT ─────────────────
 *
 *   brand   -- the provider's own mark, verbatim from a public icon set.
 *   native  -- a lucide glyph in vam's own visual language, for a source vam
 *              knows but whose mark it may not redistribute, and for vam's
 *              own non-company sources.
 *   neutral -- the generic box, for a source nobody here has drawn. NOT an
 *              error: a third source will arrive, and this is what it gets
 *              until somebody decides otherwise. Never blank, and never
 *              another provider's logo, which would be a confident claim
 *              about who ran the session.
 *
 * ── WHERE THE BRAND PATHS CAME FROM, and under what licence ───────────────
 *
 * Every path in `PROVIDER_MARKS` is an outline from Simple Icons
 * (https://github.com/simple-icons/simple-icons), file `icons/<slug>.svg`,
 * whose icon files are released under CC0 1.0 Universal -- a full waiver of
 * copyright, which is why the shapes can be carried here rather than pulled in
 * as a dependency. The path data is copied verbatim from that project; nothing
 * here is vam's own drawing, and claiming otherwise would be the actual
 * problem in a public repository.
 *
 * TWO TAGS, NOT ONE, and which mark came from which is written down because
 * the difference is the whole of the OpenAI argument below. Claude, GitHub
 * Copilot, Google Gemini and OpenCode are taken from **16.32.0**. OpenAI's is
 * taken from **15.0.0** -- `icons/openai.svg` is 200 at that tag and 404 at
 * 16.32.0, verified 2026-09-21 -- for the reason the next section gives in
 * full. The tags are pinned rather than remembered:
 * `test/sources/provider-marks.test.tsx` records the exact `d` string and the
 * tag each mark was taken with, so a hand edit to "make it fit" -- the one
 * thing that would turn a verbatim copy into an approximation -- fails the
 * suite.
 *
 * CC0 waives copyright, NOT trademark -- Simple Icons says so itself, and so
 * does clause 4(a) of CC0. Each mark is the trademark of its owner. That is
 * not a blocker here, and the reasoning is recorded so nobody has to re-open
 * it: vam draws a provider's mark to identify that provider's own product,
 * beside its own name, as the label on a session that really did come from
 * it. That is nominative use, the same thing every client application does.
 * vam does not use these marks as its own brand and does not imply any
 * endorsement.
 *
 * ── THE MARKS VAM DELIBERATELY DOES NOT CARRY ─────────────────────────────
 *
 * THIS SECTION USED TO OPEN WITH OPENAI'S, and the receipt it carried is kept
 * rather than deleted, because the facts did not change -- the decision did.
 *
 *   - OPENAI'S WAS HERE, AND IS NOW IN THE TABLE. What Simple Icons did is
 *     still true and still worth knowing: they REMOVED the OpenAI icon in
 *     their 16.0.0 release (2025-11-30), PR 13944, closing issue 12739,
 *     because the usage terms at https://openai.com/brand/ grant a
 *     NON-TRANSFERABLE permission and they therefore could not redistribute
 *     the mark under CC0. So vam's copy is taken from the pinned **15.0.0**
 *     tag, the last release that carried it, verbatim and digest-pinned.
 *
 *     WHY THAT IS NONETHELESS THE RIGHT CALL, since the previous version of
 *     this paragraph concluded the opposite. Simple Icons' problem was
 *     specific to Simple Icons: they are a REDISTRIBUTOR, shipping an icon set
 *     whose whole proposition is that everything in it is relicensed CC0, and
 *     a non-transferable permission is precisely the thing they cannot pass
 *     on. vam is not relicensing anything and is not an icon set. It draws
 *     this mark to identify OpenAI's own product, beside its own name, on a
 *     session that really came from it -- which is nominative use, and is
 *     exactly the argument the section above already accepts for the Claude
 *     mark. The two cases were never different; only the availability of the
 *     file was, and availability is not a licence question.
 *
 *     WHAT DOES NOT CHANGE is the risk the removal makes sharpest. The path
 *     is taken VERBATIM. Drawing a four-petal flower that looks about right
 *     would be worse than drawing nothing: an almost-correct logo is a wrong
 *     claim about a company, not a rough edge. The digest pin in
 *     `provider-marks.test.tsx` is what stops a well-meaning nudge, and the
 *     OpenAI path is under it like every other.
 *   - ORCA'S. Its repository is MIT, but MIT licenses Lovecast's CODE, not
 *     its logo, and a licence cannot pass on a brand its author does not own.
 *     The `orca` source gets the neutral glyph and its name in words.
 *   - VAM'S OWN SOURCES (`factory`, `bundled-sample`). These are concepts,
 *     not companies; they keep their lucide glyphs, which is the app's own
 *     visual language and the right register for them.
 *
 * ── COLOUR IS NEVER THE *ONLY* SIGNAL ─────────────────────────────────────
 *
 * The heading used to read "colour is never the signal", and the brand marks
 * carried none. The operator asked for colour in the provider icons. Of the
 * three reasons that were recorded here, two are still binding and shape what
 * was built; the third was the one being overridden, and it is restated rather
 * than dropped.
 *
 *   1. A BAKED BRAND COLOUR IS INVISIBLE IN ONE THEME. Still true, and it is
 *      the constraint the implementation is built around: OpenAI's published
 *      brand colour is a dark indigo that measures 1.46:1 on dark's sidebar --
 *      effectively unreadable. So a brand colour is not one value, it is TWO,
 *      one per theme. Each theme carries the brand's own colour where it
 *      clears the floor, and the same HUE at a different lightness where it
 *      does not: Claude's own in dark and a darkened one in light, OpenAI's
 *      own in light and a lifted one in dark. Hue and saturation are carried
 *      across unchanged in both cases, so what moves is LIGHTNESS alone and
 *      the mark stays recognisably the brand's colour --
 *      `token-contrast.test.ts` holds each token to its brand's hue rather
 *      than trusting that sentence. The four values, with their arguments,
 *      are at `--vam-brand-claude` in `styles.css`; they are deliberately not
 *      repeated here, because a hex in this file is what point 2 forbids and
 *      a second copy is how the two drift apart.
 *   2. NO LITERAL HEX UNDER `src/` OUTSIDE `styles.css` (constraint 13.1).
 *      Still binding, and not bent -- including in this comment, which is
 *      where the first draft of it broke the rule and `topology-constraints`
 *      said so. There is no hex anywhere in this file. A mark
 *      carries a CLASS NAME -- `text-brand-claude` -- and `styles.css` defines
 *      `--vam-brand-claude` per theme, exposes it as `--color-brand-claude` in
 *      the `@theme inline` block and Tailwind emits the utility. That is the
 *      pattern the eight icon tones already use, followed rather than
 *      reinvented. The paths still draw in `currentColor`; the only thing that
 *      changed is what `currentColor` resolves to.
 *   3. HUE IS THE CHANNEL THAT IS MISSING FOR SOMEBODY (WCAG 1.4.1). The rule
 *      SURVIVES, and this change does not break it, because colour was never
 *      asked to carry the distinction and still is not: the two marks differ
 *      in SHAPE -- a radial burst against a woven knot -- and the colour is
 *      ADDITIVE. The measurement makes that concrete rather than hopeful: in
 *      the dark theme the two brand values sit at 1.05:1 to each other, so a
 *      reader who receives no hue sees two marks of the SAME grey and is told
 *      them apart by their outlines exactly as before.
 *      `e2e/provider-mark-shots.mjs` keeps both halves honest -- it requires
 *      the two marks to be different colours AND different pictures, and a
 *      shape check that stopped distinguishing them would fail there.
 *
 * COLOUR IS FOR THE `brand` REGISTER ONLY. `native` and `neutral` keep the
 * row's own ink: `factory` and `bundled-sample` are vam's own concepts rather
 * than companies, and an invented colour for them would be the decoration
 * this module exists to prevent. A mark with no measured pair takes none
 * either -- see `PROVIDER_MARKS`.
 *
 * AND A BRAND MARK IS A NON-TEXT MARK, so it owes WCAG 1.4.11's 3:1 rather
 * than 1.4.3's 4.5:1, on every fill it is really drawn on -- the sidebar, a
 * selected row's `raised`, the tab strip's `pane` and an active tab's
 * `ground`, across all seven colour templates. The sidebar's meta line then
 * dims the whole lane with `opacity-[0.82]`, so the number that matters is the
 * COMPOSITED one: 3.51:1 at worst for Claude and 3.40:1 for OpenAI in dark,
 * 3.75:1 and 5.89:1 in light. `test/renderer/token-contrast.test.ts` computes
 * all of those rather than trusting this paragraph.
 */

import { Box, Factory, FlaskConical, type LucideIcon } from 'lucide-react';
import type { JSX } from 'react';

/** Every mark renders at the caller's size; the viewBox does the scaling. */
export type ProviderMarkProps = { readonly size?: number };

export type ProviderMark = {
  /** The brand this outline depicts, so attribution is data and not only prose. */
  readonly title: string;
  /**
   * The Tailwind class that carries this brand's colour, or `null` to inherit
   * whatever ink the row is drawn in.
   *
   * A CLASS AND NOT A VALUE, for the reason the header's second point gives:
   * no hex may appear under `src/` outside `styles.css`, and a per-theme
   * colour cannot be one value anyway. It must also be a LITERAL in this
   * file's source text -- Tailwind's scanner reads source, so a class
   * assembled from a constant (`text-brand-${slug}`) is one it never generates
   * and the mark would silently inherit. `SessionList.tsx` records that trap
   * twice under its own name.
   */
  readonly ink: string | null;
  readonly Glyph: (props: ProviderMarkProps) => JSX.Element;
};

/**
 * Simple Icons draws every outline on the same 24-unit square, so one viewBox
 * serves all of them and a mark is nothing but its path.
 *
 * `ink` is the last argument and defaults to `null`, so a mark without a
 * measured pair of theme values is uncoloured by CONSTRUCTION rather than by
 * somebody remembering.
 */
function markFrom(title: string, d: string, ink: string | null = null): ProviderMark {
  return {
    title,
    ink,
    Glyph: ({ size = 11 }: ProviderMarkProps) => (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
        // ON THE SVG, NOT ON THE LANE AROUND IT. The wrapper belongs to
        // whichever surface drew the mark -- the sidebar's `ProviderLane` also
        // holds the `GitBranch` beside it -- so a colour class there would
        // have painted the branch glyph too.
        {...(ink === null ? {} : { className: ink })}
      >
        <path fill="currentColor" d={d} />
      </svg>
    ),
  };
}

/**
 * Keyed by vam's own source id, not by the vendor's name: a source id is what
 * the adapter stamps on a row, and it is the only thing the status bar has to
 * look one up with. An id absent from this table is not an error -- it is the
 * normal case, and `SourceGlyph` answers it with the neutral glyph.
 */
export const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  'claude-code': markFrom(
    'Claude',
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    'text-brand-claude',
  ),
  /* OPENAI, FROM THE 15.0.0 TAG, NOT 16.32.0 — see the header. `icons/openai.svg`
     is 200 there and 404 at 16.32.0, and the argument for taking it anyway is
     recorded in full rather than left as a shrug. Keyed `codex` because the
     key is vam's source id and not the vendor's name; the `title` is what
     says which brand the outline depicts. */
  codex: markFrom(
    'OpenAI',
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
    'text-brand-openai',
  ),
  'github-copilot': markFrom(
    'GitHub Copilot',
    'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  ),
  gemini: markFrom(
    'Google Gemini',
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  ),
  opencode: markFrom('OpenCode', 'M22 24H2V0h20zM17 4.8H7v14.4h10z'),
};

/**
 * THE `native` REGISTER: vam's own glyph for a source that gets no brand mark.
 *
 * IT HOLDS ONE KIND OF THING NOW, WHERE IT HELD TWO. `codex` used to be here,
 * drawn as a `SquareTerminal` because the header then concluded vam may not
 * carry OpenAI's mark; that conclusion was reversed, `codex` is in
 * `PROVIDER_MARKS`, and `SquareTerminal` left this table with it rather than
 * being left behind as an unused import for somebody to wonder about.
 *
 * What is left is the situation that was always the cleaner half:
 *
 *   `factory`,
 *   `bundled-sample`
 *             -- concepts rather than companies, which have no brand to
 *                borrow and never wanted one. They are also why this register
 *                takes NO COLOUR: a tone here would be vam inventing a brand
 *                for one of its own ideas.
 *
 * The register itself is not vestigial -- it is what a future source whose
 * mark really cannot be carried would take, and the paragraph above is the
 * record of how that decision gets made.
 *
 * Moved here from `Canvas.tsx`, where it was module-private and therefore
 * invisible to the sidebar. That is not tidying: the day the sidebar drew its
 * own table, one source would have had two marks in one application.
 */
const NATIVE_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  factory: Factory,
  'bundled-sample': FlaskConical,
};

/** Which of the three registers answered. Recorded in the DOM by every caller
 *  (`data-source-mark`) so the fallback is an assertable outcome rather than
 *  an invisible default. */
export type MarkRegister = 'brand' | 'native' | 'neutral';

/**
 * The register for a source id, stated once for every surface that draws one.
 *
 * TOTAL over `string`, deliberately: `SourceId` is a free string that a source
 * adapter mints (`domain/model.ts`), so "an id nobody here has drawn" is the
 * normal case and not an error. It answers `neutral`.
 */
export function markRegisterOf(source: string): MarkRegister {
  if (PROVIDER_MARKS[source] !== undefined) return 'brand';
  if (NATIVE_GLYPHS[source] !== undefined) return 'native';
  return 'neutral';
}

/**
 * One source's mark, drawn -- the glyph alone, with no wrapper and no label.
 *
 * NO WRAPPER ON PURPOSE. The two callers need different boxes around the same
 * ink: the status bar's is a focusable, labelled `role="img"` with a tooltip,
 * because there it is ONE glyph standing for the one session the keyboard is
 * on; the sidebar's is an `aria-hidden` lane repeated down every row, where
 * the same label would be read aloud before every title. Sharing the wrapper
 * would have forced one of those two to be wrong. What IS shared is the thing
 * that must never differ: which glyph.
 *
 * `lane` IS THE BOX, NOT THE INK, and the two are not the same number for the
 * two registers -- which is the `HEADING_GLYPH_PX` lesson in `SessionList.tsx`
 * applied here rather than re-learnt: the eye reads the ink. A lucide glyph is
 * drawn on a 24-unit viewBox with about two units of margin inside it, so it
 * paints a little under its `size`; a Simple Icons path fills its 24 units
 * edge to edge, so it paints its `size` exactly. Handed the same number the
 * brand mark is the visibly bigger and heavier of the two. One pixel off the
 * brand mark is what puts the two inks on the same footing, and
 * `e2e/provider-mark-shots.mjs` measures the painted result rather than
 * trusting this paragraph.
 *
 * THE INK IS THE MARK'S OWN NOW for the brand register, and the wrapper's for
 * the other two. That is decided HERE, in one place, rather than at the three
 * call sites, for the same reason the table is: the sidebar row, the tab strip
 * and the status bar must not come to three different answers about one
 * source. A caller that wants a mark gets the mark, colour and all.
 */
export function SourceMark({
  source,
  lane = 12,
}: {
  readonly source: string;
  readonly lane?: number;
}): JSX.Element {
  const mark = PROVIDER_MARKS[source];
  if (mark !== undefined) {
    return <mark.Glyph size={lane - 1} />;
  }
  const Glyph = NATIVE_GLYPHS[source] ?? Box;
  return <Glyph size={lane} strokeWidth={1.6} aria-hidden="true" />;
}
