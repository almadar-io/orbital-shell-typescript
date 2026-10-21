/**
 * puzzleObject — field accessors for reading Event-Handler puzzle-object data
 * off an `EntityRow`.
 *
 * The puzzle objects the kid configures arrive as `entity.objects` (an array of
 * `EntityRow`). These helpers narrow the weakly-typed fields the panel reads.
 * `RuleDefinition` / `RuleOption` are plain UI value DTOs, defined below.
 *
 * @packageDocumentation
 */

import type { EntityWith } from '@almadar/core';

/** A single Event-Handler puzzle rule: "when <event> then <action>". Plain value DTO. */
export type RuleDefinition = {
    whenEvent: string;
    thenAction: string;
};

/** An option (event or action) selectable in a puzzle rule. Plain value DTO. */
export interface RuleOption {
    value: string;
    label: string;
}

type PuzzleObjectRow = EntityWith<{
    name?: string;
    icon?: string;
    states?: string[];
    currentState?: string;
    availableEvents?: RuleOption[];
    availableActions?: RuleOption[];
    rules?: RuleDefinition[];
    maxRules?: number;
}>;

export function objId(o: PuzzleObjectRow): string {
    return o.id == null ? '' : String(o.id);
}

export function objName(o: PuzzleObjectRow): string {
    return o.name == null ? '' : String(o.name);
}

export function objIcon(o: PuzzleObjectRow): string {
    return o.icon == null ? '' : String(o.icon);
}

export function objStates(o: PuzzleObjectRow): string[] {
    return Array.isArray(o.states) ? o.states : [];
}

export function objCurrentState(o: PuzzleObjectRow): string {
    return o.currentState == null ? '' : String(o.currentState);
}

export function objAvailableEvents(o: PuzzleObjectRow): RuleOption[] {
    return Array.isArray(o.availableEvents) ? o.availableEvents : [];
}

export function objAvailableActions(o: PuzzleObjectRow): RuleOption[] {
    return Array.isArray(o.availableActions) ? o.availableActions : [];
}

export function objRules(o: PuzzleObjectRow): RuleDefinition[] {
    return Array.isArray(o.rules) ? o.rules : [];
}

export function objMaxRules(o: PuzzleObjectRow): number {
    const n = Number(o.maxRules);
    return Number.isFinite(n) && n > 0 ? n : 3;
}
