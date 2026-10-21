/**
 * SlotHostManifest / assertUniqueSlotsPerHost (Studio V4 §14, Part I1/I2).
 * A manifest's regions each bind exactly one `UISlot`; the guard is the
 * only thing standing between two regions sharing a slot (which would
 * mount `UISlotComponent` twice for it — one region silently loses its
 * content, or a portal slot double-portals).
 */
import { describe, it, expect } from 'vitest';
import {
  assertUniqueSlotsPerHost,
  type SlotHostManifest,
  type SlotHostRegion,
} from '../../src/types/slot-host';

describe('assertUniqueSlotsPerHost', () => {
  it('passes a manifest whose regions each bind a distinct slot', () => {
    const manifest: SlotHostManifest<'sidebar' | 'main' | 'modal'> = {
      regions: {
        sidebar: { slot: 'sidebar', mode: 'replace' },
        main: { slot: 'main', mode: 'replace' },
        modal: { slot: 'modal', mode: 'append' },
      },
    };
    expect(() => assertUniqueSlotsPerHost(manifest)).not.toThrow();
  });

  it('throws listing the two regions that share a slot', () => {
    const manifest: SlotHostManifest<'chat' | 'sidebarContent'> = {
      regions: {
        chat: { slot: 'content', mode: 'replace' },
        sidebarContent: { slot: 'content', mode: 'replace' },
      },
    };
    expect(() => assertUniqueSlotsPerHost(manifest)).toThrowError(/chat/);
    expect(() => assertUniqueSlotsPerHost(manifest)).toThrowError(/sidebarContent/);
    expect(() => assertUniqueSlotsPerHost(manifest)).toThrowError(/"content"/);
  });

  it('does not throw on an empty manifest', () => {
    const manifest: SlotHostManifest = { regions: {} };
    expect(() => assertUniqueSlotsPerHost(manifest)).not.toThrow();
  });

  it('append and replace regions on different slots coexist', () => {
    const region: SlotHostRegion = { slot: 'toast', mode: 'append' };
    const manifest: SlotHostManifest<'toast' | 'overlay'> = {
      regions: {
        toast: region,
        overlay: { slot: 'overlay', mode: 'replace' },
      },
    };
    expect(() => assertUniqueSlotsPerHost(manifest)).not.toThrow();
  });
});
