/**
 * Slot-host manifest types (Studio V4 §14, Part I1/I2).
 *
 * A "slot-host" is any shell that lays out named regions and mounts each
 * one through `UISlotComponent` — e.g. a persona workspace declaring
 * `sidebar`/`main`/`drawer`/... A manifest is the declarative region → slot
 * binding for such a host: which compiler `UISlot` each region mounts, and
 * whether the host's own stock content is replaced by slot content or the
 * two are shown together (`UISlotComponent`'s `mode` prop). Substrate
 * (lives in `@almadar/ui`, re-exported by `@almadar/sdk`) so any host — the
 * studio's three persona shells or an embedding app — describes its
 * regions the same way.
 *
 * @packageDocumentation
 */

import type { UISlot } from "@almadar/core";

/**
 * One host region's binding to a compiler slot. Mirrors `UISlotComponent`'s
 * `mode` prop exactly — a manifest is just that prop's value, keyed by
 * region, declared as data instead of scattered across JSX call sites.
 */
export interface SlotHostRegion {
  slot: UISlot;
  mode: "replace" | "append";
}

/**
 * A host's full region map, keyed by the host's own region ids (e.g. a
 * persona shell's `activityBar`/`sidebar`/`main`/...). `RegionId` is left
 * generic so each host supplies its own literal union.
 */
export interface SlotHostManifest<RegionId extends string = string> {
  regions: Record<RegionId, SlotHostRegion>;
}

/**
 * Guards the invariant a slot-host manifest depends on: each `UISlot` may
 * be mounted by at most one region. Two regions sharing a slot would mount
 * `UISlotComponent` twice for the same slot — the second mount clears/reads
 * the same context entry the first one owns, so one of the two regions
 * silently loses its content (or, for a portal slot, double-portals it).
 * Throws naming the two offending regions so the host can find the
 * conflict without re-deriving it from the manifest.
 */
export function assertUniqueSlotsPerHost<RegionId extends string>(
  manifest: SlotHostManifest<RegionId>,
): void {
  const seenBySlot = new Map<UISlot, RegionId>();
  for (const [regionId, region] of Object.entries(manifest.regions) as Array<
    [RegionId, SlotHostRegion]
  >) {
    const existingRegionId = seenBySlot.get(region.slot);
    if (existingRegionId !== undefined) {
      throw new Error(
        `assertUniqueSlotsPerHost: regions "${existingRegionId}" and "${regionId}" both bind slot "${region.slot}" — a slot may be mounted by only one region per host.`,
      );
    }
    seenBySlot.set(region.slot, regionId);
  }
}
