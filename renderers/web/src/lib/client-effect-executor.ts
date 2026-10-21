/**
 * Client Effect Executor
 *
 * Executes client effects returned from the server.
 * This is the core of the dual execution model - the server processes
 * events and returns client effects, which this module executes.
 *
 * Used by both Builder preview and compiled shells.
 *
 * @packageDocumentation
 */

import type { FieldValue } from '@almadar/core';
import type {
  ClientEffect,
  ClientEffectExecutorConfig,
  PatternConfig,
} from '../types/renderer-types';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:effects:client');

// ============================================================================
// Effect Execution
// ============================================================================

/**
 * Execute an array of client effects.
 *
 * Effects are executed sequentially in order.
 * Errors in one effect don't prevent subsequent effects from executing.
 *
 * @param effects - Array of client effects to execute
 * @param config - Configuration providing implementations for each effect type
 *
 * @example
 * ```typescript
 * executeClientEffects(
 *   [
 *     ['render-ui', 'main', { type: 'entity-table', entity: 'Task' }],
 *     ['emit', 'TASKS_LOADED']
 *   ],
 *   {
 *     renderToSlot: (slot, pattern) => slotManager.render(slot, pattern),
 *     navigate: (path) => router.push(path),
 *     eventBus: { emit: (event, payload) => bus.emit(event, payload) }
 *   }
 * );
 * ```
 */
export function executeClientEffects(
  effects: ClientEffect[],
  config: ClientEffectExecutorConfig
): void {
  if (!effects || effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    try {
      executeEffect(effect, config);
    } catch (error) {
      log.error('Error executing effect', () => ({
        effect: JSON.stringify(effect),
        error: error instanceof Error ? error : String(error),
      }));
    }
  }

  // Call onComplete callback if provided
  config.onComplete?.();
}

/**
 * Execute a single client effect.
 */
function executeEffect(
  effect: ClientEffect,
  config: ClientEffectExecutorConfig
): void {
  const [effectType, ...args] = effect;

  switch (effectType) {
    case 'render-ui': {
      const [slot, patternConfig] = args as [string, PatternConfig | null];
      executeRenderUI(slot, patternConfig, config);
      break;
    }

    case 'navigate': {
      const [path, params] = args as [string, Record<string, FieldValue>?];
      executeNavigate(path, params, config);
      break;
    }

    case 'emit': {
      const [event, payload] = args as [string, FieldValue?];
      executeEmit(event, payload, config);
      break;
    }

    default:
      log.warn('Unknown effect type', { effectType: String(effectType) });
  }
}

// ============================================================================
// Individual Effect Handlers
// ============================================================================

/**
 * Execute a render-ui effect.
 *
 * If patternConfig is null, the slot is cleared.
 */
function executeRenderUI(
  slot: string,
  patternConfig: PatternConfig | null,
  config: ClientEffectExecutorConfig
): void {
  config.renderToSlot(slot, patternConfig);
}

/**
 * Execute a navigate effect.
 */
function executeNavigate(
  path: string,
  params: Record<string, FieldValue> | undefined,
  config: ClientEffectExecutorConfig
): void {
  config.navigate(path, params);
}

/**
 * Execute an emit effect.
 */
function executeEmit(
  event: string,
  payload: FieldValue | undefined,
  config: ClientEffectExecutorConfig
): void {
  config.eventBus.emit(event, payload);
}

// ============================================================================
// Effect Parsing Utilities
// ============================================================================

/**
 * Parse a raw effect array into a typed ClientEffect.
 * Handles unknown effect formats gracefully.
 */
export function parseClientEffect(
  raw: FieldValue[]
): ClientEffect | null {
  if (!Array.isArray(raw) || raw.length < 1) {
    log.warn('Invalid effect format', () => ({ raw: JSON.stringify(raw) }));
    return null;
  }

  const [type, ...args] = raw;

  if (typeof type !== 'string') {
    log.warn('Effect type must be string', () => ({ raw: JSON.stringify(raw) }));
    return null;
  }

  switch (type) {
    case 'render-ui':
      return ['render-ui', args[0] as string, args[1] as PatternConfig | null];
    case 'navigate':
      return ['navigate', args[0] as string, args[1] as Record<string, FieldValue>];
    case 'emit':
      return ['emit', args[0] as string, args[1]];
    default:
      log.warn('Unknown effect type', { type });
      return null;
  }
}

/**
 * Parse an array of raw effects into typed ClientEffects.
 * Filters out invalid effects.
 */
export function parseClientEffects(
  raw: FieldValue[] | undefined
): ClientEffect[] {
  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((effect) => parseClientEffect(effect as FieldValue[]))
    .filter((effect): effect is ClientEffect => effect !== null);
}

// ============================================================================
// Effect Filtering
// ============================================================================

/**
 * Filter effects by type.
 */
function filterEffectsByType<T extends ClientEffect[0]>(
  effects: ClientEffect[],
  type: T
): Extract<ClientEffect, [T, ...FieldValue[]]>[] {
  return effects.filter(
    (effect): effect is Extract<ClientEffect, [T, ...FieldValue[]]> =>
      effect[0] === type
  );
}

/**
 * Get all render-ui effects.
 */
export function getRenderUIEffects(
  effects: ClientEffect[]
): Array<['render-ui', string, PatternConfig | null]> {
  return filterEffectsByType(effects, 'render-ui');
}

