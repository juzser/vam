/**
 * ReactFlow's live node list → the rectangles `nextNode` navigates.
 *
 * This is the seam docs/design/canvas-layout.md §4 turns on. ReactFlow keeps a
 * child node's `position` **relative to its parent**, so a session dragged
 * inside its project reports coordinates that mean nothing on their own. Adding
 * the parent's offset here is what makes "compute the geometry at the moment the
 * key is pressed" true rather than merely intended: get this wrong and `l` still
 * returns a node, just the wrong one, on a canvas that looks correct.
 *
 * Typed structurally rather than against ReactFlow's `Node`, so the rule can be
 * tested with plain objects and no renderer.
 */

import type { NavNode } from '../keyboard/spatial-nav.js';

export type FlowNodeLike = {
  readonly id: string;
  readonly parentId?: string | undefined;
  readonly position: { readonly x: number; readonly y: number };
  /** What ReactFlow measured after layout; absent until the node has rendered. */
  readonly measured?: { readonly width?: number | undefined; readonly height?: number | undefined };
  /** What we asked for. Used as the fallback before the first measure. */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
};

/**
 * Absolute rectangles for `navigableIds`, in that argument's order.
 *
 * Nodes that are not navigable (the project groups) are still read, because
 * they are the parents whose offsets the sessions need — they are just never
 * returned as destinations.
 *
 * A node naming a parent that is not in the list is skipped rather than placed
 * at its relative coordinates: a rectangle in the wrong coordinate space would
 * navigate confidently to the wrong place, and dropping it merely makes the node
 * unreachable, which is visible.
 */
export function toNavNodes(
  nodes: readonly FlowNodeLike[],
  navigableIds: readonly string[],
): NavNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const result: NavNode[] = [];
  for (const id of navigableIds) {
    const node = byId.get(id);
    if (node === undefined) {
      continue;
    }

    let x = node.position.x;
    let y = node.position.y;
    if (node.parentId !== undefined) {
      const parent = byId.get(node.parentId);
      if (parent === undefined) {
        continue;
      }
      x += parent.position.x;
      y += parent.position.y;
    }

    result.push({
      id,
      rect: {
        x,
        y,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      },
    });
  }
  return result;
}
