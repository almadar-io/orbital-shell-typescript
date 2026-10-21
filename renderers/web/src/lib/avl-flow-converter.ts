/**
 * AVL Flow Converter
 *
 * Converts an OrbitalSchema into React Flow nodes and edges
 * for the unified AVL canvas. Reuses the existing AVL schema parser.
 */

import type { Node, Edge } from '@xyflow/react';
import type { JsonObject, OrbitalSchema, EntityPersistence } from '@almadar/core';
import {
  parseApplicationLevel,
  parseOrbitalLevel,
  parseTraitLevel,
  type TraitLevelData,
  type FieldInfo,
  type OrbitalTraitInfo,
  type OrbitalPageInfo,
  type ExternalLink,
} from './avl-schema-parser';

/** Data carried by every orbital node in the unified canvas. */
export interface AvlNodeData extends JsonObject {
  orbitalName: string;
  entityName: string;
  persistence: EntityPersistence;
  fields: FieldInfo[];
  traits: OrbitalTraitInfo[];
  pages: OrbitalPageInfo[];
  traitDetails: { [k: string]: TraitLevelData };
  externalLinks: ExternalLink[];
}


/** Edge kind determines visual style. */
export type AvlEdgeKind = 'eventWire' | 'page';

/** Data carried by edges in the unified canvas. */
export interface AvlEdgeData extends JsonObject {
  edgeKind: string;
  event: string | null;
  fromTrait: string | null;
  toTrait: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Spacing between orbital nodes in React Flow coordinates. */
const NODE_SPACING = 350;

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Transform an OrbitalSchema into React Flow nodes and edges.
 * Pre-parses all orbital and trait details for responsive zoom.
 */
export function schemaToFlowGraph(schema: OrbitalSchema): {
  nodes: Node<AvlNodeData>[];
  edges: Edge<AvlEdgeData>[];
} {
  const appData = parseApplicationLevel(schema);
  const nodes: Node<AvlNodeData>[] = [];
  const edges: Edge<AvlEdgeData>[] = [];

  // Position orbitals in a grid
  const count = appData.orbitals.length;
  const cols = Math.ceil(Math.sqrt(count));

  for (let i = 0; i < appData.orbitals.length; i++) {
    const orb = appData.orbitals[i];

    // Parse orbital detail
    const orbitalDetail = parseOrbitalLevel(schema, orb.name);
    if (!orbitalDetail) continue;

    // Parse trait details
    const traitDetails: Record<string, TraitLevelData> = {};
    for (const traitName of orb.traitNames) {
      const td = parseTraitLevel(schema, orb.name, traitName);
      if (td) traitDetails[traitName] = td;
    }

    const col = i % cols;
    const row = Math.floor(i / cols);

    nodes.push({
      id: orb.name,
      type: 'orbital',
      position: { x: col * NODE_SPACING, y: row * NODE_SPACING },
      data: {
        orbitalName: orb.name,
        entityName: orb.entityName,
        persistence: orb.persistence,
        fields: orbitalDetail.entity.fields,
        traits: orbitalDetail.traits,
        pages: orbitalDetail.pages,
        traitDetails,
        externalLinks: orbitalDetail.externalLinks,
      },
    });
  }

  // Create event wire edges from cross-links
  for (const link of appData.crossLinks) {
    edges.push({
      id: `ew-${link.emitterOrbital}-${link.listenerOrbital}-${link.eventName}`,
      source: link.emitterOrbital,
      target: link.listenerOrbital,
      type: 'eventWire',
      data: {
        edgeKind: 'eventWire',
        event: link.eventName,
        fromTrait: link.emitterTrait ?? null,
        toTrait: link.listenerTrait ?? null,
      },
    });
  }

  return { nodes, edges };
}
