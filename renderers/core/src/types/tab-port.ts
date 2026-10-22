/**
 * The browser-tab host port: what a browser host does for the kernel's `browser/tab-*` effects. The kernel
 * validates every request and shapes every result; the port performs one raw tab or page operation per ask
 * and holds no decision.
 */
import type { TabAsk, TabFailureKind } from '../generated/kernel-wire.js';
import type { EventPayload } from './expression.js';
import type { JsonValue } from './json.js';

/** A raw ask a host could not perform, with the kernel's closed reason. */
export class TabHostFailure extends Error {
  constructor(
    readonly kind: TabFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'TabHostFailure';
  }
}

/** What one ask comes with: the abort signal of a keyed ask, and the way a watch's elements reach the program. */
export interface TabAskContext {
  signal?: AbortSignal;
  /** Dispatches `payload` to the declared external input the watch ask names; a no-op for any other ask. */
  deliver: (payload: EventPayload) => void;
}

export interface BrowserTabPort {
  /** Perform one raw ask and resolve its JSON reply (the shape each `TabAsk` documents), or throw a `TabHostFailure`. */
  perform(ask: TabAsk, context: TabAskContext): Promise<JsonValue>;
}

/** Whether a Chrome match pattern matches a URL: the kernel's one rule (`tabUrlMatches` of `@almadar/kernel`). */
export type TabUrlMatcher = (pattern: string, url: string) => boolean;
