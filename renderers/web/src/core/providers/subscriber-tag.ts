import { isLogLevelEnabled } from '@almadar/logger';
import type { BusEventListener } from '../types/event-bus-types';

/** The bus namespaces whose debug lines print a listener's tag. */
const TAG_READERS = ['almadar:eventbus', 'almadar:eventbus:subscribe'] as const;

/**
 * A listener's identity for the bus debug logs, or undefined when no namespace that prints it logs at debug:
 * the stack it may read costs a capture per subscription, so it is taken only when someone will read it.
 */
export function subscriberTag(listener: BusEventListener): string | undefined {
    if (!TAG_READERS.some((ns) => isLogLevelEnabled('DEBUG', ns))) return undefined;
    // Prefer the listener's function.name (preserved through bundling when the source declares a named
    // function or assigns a name via `Object.defineProperty(fn, 'name', ...)`).
    const fnName = (listener as { name?: string }).name;
    if (typeof fnName === 'string' && fnName.length > 0 && fnName !== 'listener') {
        return fnName;
    }
    // Fallback: the first stack frame that lives in user code (skip the hook/provider frames).
    const stack = new Error().stack ?? '';
    const lines = stack.split('\n');
    for (const raw of lines.slice(2)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('EventBusProvider') || line.includes('useEventBus') || line.includes('subscriber-tag')) continue;
        if (line.includes('subscriberTag')) continue;
        const match = line.match(/([^/\\)]+\.(?:tsx?|jsx?))(?::(\d+))?/);
        if (match) return match[2] ? `${match[1]}:${match[2]}` : match[1];
        return line.slice(0, 120);
    }
    return 'unknown';
}
