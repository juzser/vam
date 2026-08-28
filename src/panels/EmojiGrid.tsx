/**
 * The emoji grid itself, alone in its own module so it can be a lazy chunk.
 *
 * `emoji-picker-react` carries the whole emoji dataset — it took the main bundle
 * from 450kB to 759kB, tripling the cost of the first paint for a panel most
 * sessions never open. Splitting it here means the app loads without it and the
 * chunk arrives the first time somebody presses `s`.
 *
 * The split is at THIS boundary, not at `IconPicker`, on purpose: the picker's
 * own shell — its title, its "bỏ icon" button, its Escape handling — stays
 * synchronous, so pressing `s` puts a real panel on screen immediately rather
 * than nothing at all while a chunk is in flight.
 */

import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';

export type EmojiGridProps = {
  readonly onPick: (emoji: string) => void;
};

export default function EmojiGrid({ onPick }: EmojiGridProps) {
  return (
    <EmojiPicker
      onEmojiClick={(emoji) => onPick(emoji.emoji)}
      // NATIVE draws the system glyph. Every other style fetches sprite sheets
      // from a CDN, and a dashboard whose icons vanish with the network is worse
      // than one with no icons.
      emojiStyle={EmojiStyle.NATIVE}
      theme={Theme.DARK}
      autoFocusSearch
      lazyLoadEmojis
      width={340}
      height={380}
      previewConfig={{ showPreview: false }}
      searchPlaceholder="tìm icon…"
    />
  );
}
