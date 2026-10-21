'use client';
/**
 * Shared DnD primitives — sensor config + collision waterfall.
 *
 * Both the row-reorder primitive (`useDataDnd` in DataList/DataGrid) and the
 * canvas-insert primitive (`useCanvasDnd` in AVL OrbPreviewNode) need
 * identical pointer activation behavior and the same multi-container
 * collision strategy. Centralizing them here keeps the two hooks from
 * drifting and gives a single tunable spot when DnD ergonomics need a tweak.
 *
 * Activation: `distance: 5` on the PointerSensor so a small accidental
 * tremor doesn't fire a drag — matches the threshold dnd-kit's own examples
 * use for grab-and-drag interactions.
 *
 * Collision waterfall (run in order, first non-empty wins):
 *   1. pointerWithin     — catches the empty zones + clean hover-over-zone case (innermost zone first)
 *   2. rectIntersection  — falls back when the pointer is in margin/padding
 *   3. closestCorners    — last resort over the items in whichever zone won
 */

import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  closestCorners,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  type UniqueIdentifier,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export const ALMADAR_DND_ACTIVATION_DISTANCE = 5;

/**
 * Returns the canonical sensor stack used by every Almadar DnD primitive.
 *
 * @param withSortableKeyboard - when true, the KeyboardSensor uses
 *   `sortableKeyboardCoordinates` (correct for sortable lists). Defaults to
 *   true so `useDataDnd` keeps its current behavior; `useCanvasDnd` doesn't
 *   need it (no sortable rows) so it can pass false.
 */
export function useAlmadarDndSensors(withSortableKeyboard = true): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: ALMADAR_DND_ACTIVATION_DISTANCE },
    }),
    useSensor(
      KeyboardSensor,
      withSortableKeyboard ? { coordinateGetter: sortableKeyboardCoordinates } : undefined,
    ),
  );
}

/**
 * Multi-container collision waterfall.
 * pointerWithin → rectIntersection → closestCorners.
 */
/**
 * The zones under the pointer, innermost first: a zone whose node sits inside
 * another colliding zone's node comes before it. `pointerWithin` alone ranks
 * by distance to rect corners, which favours the smaller rectangle — so a
 * zoomed canvas card (larger than the canvas wrapper holding it) lost to the
 * wrapper. Zones not nested in each other keep dnd-kit's order.
 */
function innermostFirst(collisions: Collision[], containers: ReadonlyArray<DroppableContainer>): Collision[] {
  const nodeOf = new Map(containers.map((c) => [c.id, c.node.current]));
  const depth = (id: UniqueIdentifier): number => {
    const node = nodeOf.get(id);
    return node ? collisions.filter((other) => other.id !== id && nodeOf.get(other.id)?.contains(node)).length : 0;
  };
  const depths = new Map(collisions.map((c) => [c.id, depth(c.id)]));
  return [...collisions].sort((a, b) => (depths.get(b.id) ?? 0) - (depths.get(a.id) ?? 0));
}

export const almadarDndCollisionDetection: CollisionDetection = (args) => {
  const pw = pointerWithin(args);
  if (pw.length > 0) return innermostFirst(pw, args.droppableContainers);
  const ri = rectIntersection(args);
  if (ri.length > 0) return ri;
  return closestCorners(args);
};
