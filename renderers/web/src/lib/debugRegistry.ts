/**
 * Debug Registry - Central event log for debugging
 *
 * @packageDocumentation
 */

import type { FieldValue } from '@almadar/core';

export type DebugEventType =
  | 'state-change'
  | 'event-fired'
  | 'effect-executed'
  | 'guard-evaluated'
  | 'error'
  | 'warning'
  | 'info';

export interface DebugEvent {
  id: string;
  type: DebugEventType;
  source: string;
  message: string;
  data?: Record<string, FieldValue>;
  timestamp: number;
}

type ChangeListener = () => void;

const events: DebugEvent[] = [];
const listeners = new Set<ChangeListener>();
const MAX_EVENTS = 500;

function notifyListeners(): void {
  listeners.forEach(listener => listener());
}

export function logDebugEvent(
  type: DebugEventType,
  source: string,
  message: string,
  data?: Record<string, FieldValue>
): void {
  const event: DebugEvent = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    source,
    message,
    data,
    timestamp: Date.now(),
  };

  events.unshift(event);

  // Keep events bounded
  if (events.length > MAX_EVENTS) {
    events.pop();
  }

  notifyListeners();
}

export function logStateChange(source: string, from: string, to: string, event?: string): void {
  logDebugEvent('state-change', source, `${from} → ${to}`, { from, to, event: event ?? null });
}

export function logEventFired(source: string, eventName: string, payload?: FieldValue): void {
  logDebugEvent('event-fired', source, eventName, { eventName, payload: payload ?? null });
}

export function logEffectExecuted(source: string, effectType: string, details?: FieldValue): void {
  logDebugEvent('effect-executed', source, effectType, { effectType, details: details ?? null });
}

export function logError(source: string, message: string, error?: Error | null): void {
  logDebugEvent('error', source, message, { error: error?.message ?? null });
}

export function logWarning(source: string, message: string, data?: Record<string, FieldValue>): void {
  logDebugEvent('warning', source, message, data);
}

export function logInfo(source: string, message: string, data?: Record<string, FieldValue>): void {
  logDebugEvent('info', source, message, data);
}

export function getDebugEvents(): DebugEvent[] {
  return [...events];
}

export function getRecentEvents(count: number): DebugEvent[] {
  return events.slice(0, count);
}

export function getEventsByType(type: DebugEventType): DebugEvent[] {
  return events.filter(e => e.type === type);
}

export function getEventsBySource(source: string): DebugEvent[] {
  return events.filter(e => e.source === source);
}

export function subscribeToDebugEvents(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDebugEvents(): void {
  events.length = 0;
  notifyListeners();
}
