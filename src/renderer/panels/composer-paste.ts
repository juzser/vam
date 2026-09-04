/**
 * Pasting an image into the prompt box.
 *
 * WHY THERE IS NO IPC HERE, and it is the first thing a reader of this repo
 * will ask. `navigator.clipboard` is broken under Electron's deny-all
 * permission policy, which is why reading the clipboard goes through main
 * (`src/main/clipboard/ipc.ts`). A PASTE EVENT IS NOT THAT. It carries its own
 * `DataTransfer`, handed over by the browser because the operator pressed the
 * keys; no permission is asked for and none is refused. So this is a pure
 * function over what the event already holds, and adding a channel for it
 * would be adding a channel to fetch something vam was given.
 *
 * WHAT HAPPENS TO THE IMAGE ON SEND, stated here because the placeholder must
 * not imply otherwise: nothing. vam's write to a session is text -- the tmux
 * pane is typed into, the CLI takes a `-p` string -- so only `[image #N]`
 * travels. The file is kept beside the draft so the composer can say what it
 * is holding and so a delivery path that can carry files has something to
 * carry; the box says the image is not sent, in as many words.
 */

/** One item of a `DataTransfer`, narrowed to what this reads. */
export type ClipboardItemLike = {
  readonly kind: string;
  readonly type: string;
  getAsFile(): File | null;
};

/** The paste event's own `DataTransfer`, narrowed the same way. */
export type ClipboardLike = {
  readonly items: ArrayLike<ClipboardItemLike>;
};

/** A pasted image, held beside the draft the placeholder went into. */
export type ComposerImage = {
  /** Exactly the text written into the draft, so removing one is a string search. */
  readonly placeholder: string;
  readonly type: string;
  readonly file: File;
};

/**
 * `text` means: this paste had no image in it, so let the browser do what it
 * always does. Any other answer would make vam responsible for reproducing
 * plain-text paste, including the parts of it nobody remembers.
 */
export type PasteOutcome =
  | { readonly kind: 'text' }
  | { readonly kind: 'images'; readonly text: string; readonly images: readonly ComposerImage[] };

export const placeholderFor = (index: number): string => `[image #${index}]`;

/**
 * The images in a paste, numbered from `startIndex` -- the count already in
 * this composition plus one, so `[image #2]` is the second image of THIS
 * prompt rather than the second one today.
 */
export function readPastedImages(data: ClipboardLike, startIndex: number): PasteOutcome {
  const images: ComposerImage[] = [];
  for (let at = 0; at < data.items.length; at += 1) {
    const item = data.items[at];
    if (item === undefined || item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    // An item can be advertised and still not be handed over. Skipping it
    // leaves the paste as text rather than writing a placeholder that stands
    // for nothing.
    const file = item.getAsFile();
    if (file === null) continue;
    images.push({ placeholder: placeholderFor(startIndex + images.length), type: item.type, file });
  }
  if (images.length === 0) return { kind: 'text' };
  return { kind: 'images', text: images.map((image) => image.placeholder).join(' '), images };
}

/** Put `text` where the cursor is, replacing whatever was selected. */
export function spliceDraft(draft: string, start: number, end: number, text: string): string {
  return `${draft.slice(0, start)}${text}${draft.slice(end)}`;
}
