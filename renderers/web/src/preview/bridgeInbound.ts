/**
 * The inbound rows a bridged embed gets: each event its bridge listens for, routed to every
 * trait of the embedded program whose state machine handles it. Read off the program; no
 * names guessed.
 *
 * @packageDocumentation
 */

import { isInlineTrait, type OrbitalSchema } from '@almadar/core';
import type { PluginHostInbound } from './OrbitalPluginHost';

export function bridgeInbound(schema: OrbitalSchema, listens: readonly string[], busEventOf: (event: string) => string = (event) => event): PluginHostInbound[] {
  const rows: PluginHostInbound[] = [];
  for (const event of listens) {
    for (const orbital of schema.orbitals) {
      for (const trait of orbital.traits) {
        if (!isInlineTrait(trait)) continue;
        if (!trait.stateMachine?.transitions.some((t) => t.event === event)) continue;
        rows.push({ busEvent: busEventOf(event), orbital: orbital.name, trait: trait.name, trigger: event });
      }
    }
  }
  return rows;
}
