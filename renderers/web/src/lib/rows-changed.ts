/**
 * rows-changed (EXEC-RENDER-3): the kernel repaints a slot holding a row-set reference with the unchanged marker
 * and flags the entry `repaint: "rows-changed"`; the renderer re-resolves every reference of the entity types
 * that content holds.
 *
 * @packageDocumentation
 */
import { isRowSetMarker } from '@almadar/core';
import type { SlotPropValue } from '../providers/UISlotContext';
import type { RowSetResolver } from './row-set-resolver';

function collect(value: SlotPropValue, out: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (isRowSetMarker(value)) {
    out.add(value.ref.entityType);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item as SlotPropValue, out);
    return;
  }
  if (value instanceof Date) return;
  for (const item of Object.values(value)) collect(item as SlotPropValue, out);
}

/** The entity types of every row-set reference held in `props`. */
export function rowSetEntityTypes(props: SlotPropValue): ReadonlySet<string> {
  const out = new Set<string>();
  collect(props, out);
  return out;
}

export function notifyRowsChanged(resolver: RowSetResolver | undefined, props: SlotPropValue): void {
  if (resolver === undefined) return;
  for (const entityType of rowSetEntityTypes(props)) resolver.rowsChanged(entityType);
}
