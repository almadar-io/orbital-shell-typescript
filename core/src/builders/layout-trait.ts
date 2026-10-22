/**
 * Layout-Trait Builders
 *
 * Helpers for constructing the canonical inline LayoutTrait pattern that
 * std layout-shell molecules (`std-filtered-list`, `std-master-detail-layout`,
 * etc.) use to wrap a set of atom trait references in a `(render-ui main)`
 * effect with `@trait.X` slot embeds.
 *
 * The canonical LayoutTrait is stateless: ONE state (`composing`, initial),
 * ONE transition (`INIT` self-loop) carrying two effects — `(fetch Entity
 * {emit: {success, failure}})` and `(render-ui "main" <pattern-tree>)`. Atoms
 * embedded via `@trait.X` slot references react to the bus events the fetch
 * emits; the LayoutTrait owns no further state.
 *
 * Usage from a std layout-shell molecule:
 *
 * ```ts
 * import { makeSlot, makeLayoutTrait } from '@almadar/core/builders';
 *
 * const layout = makeLayoutTrait({
 *   name: 'DashboardLayout',
 *   linkedEntity: 'Metric',
 *   fetchEntity: 'Metric',
 *   loadedEvent: 'MetricLoaded',
 *   loadFailedEvent: 'MetricLoadFailed',
 *   renderUI: {
 *     type: 'stack',
 *     direction: 'vertical',
 *     children: [
 *       makeSlot('StatsRow'),
 *       makeSlot('ChartsRow'),
 *       makeSlot('FeedRow'),
 *     ],
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { AnyPatternConfig } from '../patterns/index.js';
import type { Trait } from '../types/trait.js';
import type { Effect, FetchEffect, RenderBinding, RenderUIEffect, UISlot } from '../types/effect.js';

/**
 * Build a `@trait.<name>` slot reference string. Used as a child entry in a
 * pattern tree to embed another trait's render-ui at that position. The
 * runtime resolves `@trait.X` to the matching trait's render-ui inline.
 *
 * @example makeSlot('FilteredItemSearch') // "@trait.FilteredItemSearch"
 */
export function makeSlot(traitName: string): string {
  return `@trait.${traitName}`;
}

/**
 * Build a `(render-ui <slot> <root>)` effect tuple. Pattern-typed sugar over
 * the raw `RenderUIEffect` literal so callers don't have to spell out the
 * three-element tuple form.
 *
 * @param slot - Canonical UI slot name (`'main'`, `'header'`, etc. — see UI_SLOTS).
 * @param root - The pattern config for this slot's content, OR a `@`-binding
 *   string ({@link RenderBinding}) pointing at a render tree in `config` /
 *   `payload` (e.g. `'@config.bodyContent'`). Pass `null` to clear.
 */
export function makeRenderUI(
  slot: UISlot,
  root: AnyPatternConfig | RenderBinding | null,
): RenderUIEffect {
  // Branch the return so TS narrows into the correct tuple variant of the
  // RenderUIEffect union (each arm is a distinct tuple shape).
  if (root === null) return ['render-ui', slot, null];
  if (typeof root === 'string') return ['render-ui', slot, root];
  return ['render-ui', slot, root];
}

/**
 * Options for {@link makeLayoutTrait}.
 */
export interface MakeLayoutTraitOpts {
  /** Trait name, e.g. `"DashboardGridLayout"`. */
  name: string;
  /** Entity this layout's emits/listens bind to. */
  linkedEntity: string;
  /** Optional human-readable description (carried through to `Trait.description`). */
  description?: string;
  /**
   * Entity name to fetch on INIT. When set, a `(fetch <Entity> {emit:
   * {success, failure}})` effect is prepended to the INIT transition. Omit
   * for purely-presentational layouts that don't load data themselves.
   */
  fetchEntity?: string;
  /**
   * Event name emitted on successful fetch. Required when `fetchEntity` is
   * set; the LayoutTrait declares this event in its `emits` and uses it as
   * the `success` emit-name in the fetch effect.
   * Convention: `"<Entity>Loaded"`.
   */
  loadedEvent?: string;
  /**
   * Event name emitted on fetch failure. Required when `fetchEntity` is
   * set. Convention: `"<Entity>LoadFailed"`.
   */
  loadFailedEvent?: string;
  /**
   * Payload schema for the loaded event. Defaults to `[{ name: "data", type:
   * "[<Entity>]" }]` when `fetchEntity` is set. Provide explicitly when the
   * payload should carry additional fields.
   */
  loadedPayloadSchema?: Array<{ name: string; type: string; required?: boolean }>;
  /**
   * The pattern tree for the layout's main slot. Children may include
   * `@trait.X` slot strings (built via {@link makeSlot}) interleaved with
   * inline pattern configs (`{ type: 'stack', ... }`). The shape conforms to
   * `AnyPatternConfig` from `@almadar/patterns`.
   */
  renderUI: AnyPatternConfig;
  /**
   * Override the slot the render-ui effect targets. Defaults to `'main'`.
   * Specify when the layout shell should render into a sub-slot (rare).
   */
  slot?: UISlot;
  /**
   * Additional effects appended to the INIT transition AFTER the fetch +
   * render-ui pair. Most layouts don't need this; provided for advanced
   * cases (analytics emit, persistence seed, etc.).
   */
  extraEffects?: Effect[];
}

/**
 * Build the canonical stateless LayoutTrait used by std layout-shell molecules.
 *
 * Result shape:
 * - `category: 'interaction'`, `scope: 'instance'`
 * - `linkedEntity` set per the option
 * - `emits` declares the loaded + loadFailed events when `fetchEntity` is set
 * - One state: `'composing'` (`isInitial: true`)
 * - One transition: `composing → composing` on `INIT`, with effects:
 *   - (when `fetchEntity` set) `['fetch', '<Entity>', { emit: { success, failure } }]`
 *   - `['render-ui', slot, renderUI]`
 *   - …`extraEffects` if provided
 *
 * Atoms whose trait names appear as `@trait.<name>` strings inside `renderUI`
 * get embedded by the runtime when the orbital instantiates. The LayoutTrait
 * itself stays stateless — all reactive behaviour lives in the embedded atoms.
 */
export function makeLayoutTrait(opts: MakeLayoutTraitOpts): Trait {
  const slot: UISlot = opts.slot ?? 'main';
  const effects: Effect[] = [];

  // Build emits list based on fetch configuration.
  const emits: Trait['emits'] = [];
  const eventDefs: NonNullable<Trait['stateMachine']>['events'] = [
    { key: 'INIT', name: 'Initialize' },
  ];

  if (opts.fetchEntity) {
    if (!opts.loadedEvent || !opts.loadFailedEvent) {
      throw new Error(
        `makeLayoutTrait: fetchEntity '${opts.fetchEntity}' set but loadedEvent / loadFailedEvent are required`,
      );
    }
    const payloadSchema =
      opts.loadedPayloadSchema ?? [{ name: 'data', type: `[${opts.fetchEntity}]` }];
    emits.push(
      { event: opts.loadedEvent, scope: 'internal', payloadSchema },
      {
        event: opts.loadFailedEvent,
        scope: 'internal',
        payloadSchema: [
          { name: 'error', type: 'string' },
          { name: 'code', type: 'string' },
        ],
      },
    );
    eventDefs.push(
      { key: opts.loadedEvent, name: `${opts.fetchEntity} loaded`, payloadSchema },
      {
        key: opts.loadFailedEvent,
        name: `${opts.fetchEntity} load failed`,
        payloadSchema: [
          { name: 'error', type: 'string' },
          { name: 'code', type: 'string' },
        ],
      },
    );
    // (fetch <Entity> { emit: { success, failure } })
    const fetchFx: FetchEffect = [
      'fetch',
      opts.fetchEntity,
      { emit: { success: opts.loadedEvent, failure: opts.loadFailedEvent } },
    ];
    effects.push(fetchFx);
  }

  effects.push(makeRenderUI(slot, opts.renderUI));
  if (opts.extraEffects && opts.extraEffects.length > 0) {
    effects.push(...opts.extraEffects);
  }

  const trait: Trait = {
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    category: 'interaction',
    linkedEntity: opts.linkedEntity,
    scope: 'instance',
    ...(emits.length > 0 ? { emits } : {}),
    stateMachine: {
      states: [{ name: 'composing', isInitial: true }],
      events: eventDefs,
      transitions: [
        {
          from: 'composing',
          to: 'composing',
          event: 'INIT',
          effects,
        },
      ],
    },
  };

  return trait;
}
