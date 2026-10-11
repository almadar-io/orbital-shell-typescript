use crate::backend::*;

impl TypeScriptBackend {
    /// `hooks/dispatchContext.ts`: the client's dispatch memory (Runtime Spec Clause 5.5). A dispatch
    /// begins at a direct event; hooks that deliver its emits continue it, since the bus delivers
    /// synchronously and each listener captures the dispatch in effect when it is called.
    pub(crate) fn generate_dispatch_context(&self) -> InternalFile {
        let code = "/**\n * GENERATED — one memory per client dispatch (`@prevEvents` / `@prevStates`).\n */\n\n\
import { DispatchMemory, type DeliveryRecord, type DispatchScope } from '@almadar/core';\n\n\
export interface ClientDispatch {\n  memory: DispatchMemory;\n}\n\n\
/** How a hook's dispatch continues another: the delivery, the dispatch, and a deferred listens `when`. */\n\
export interface DispatchVia {\n  delivery: DeliveryRecord;\n  ctx: ClientDispatch;\n  listenWhen?: (fromState: string, scope: DispatchScope) => boolean;\n}\n\n\
let current: ClientDispatch | undefined;\n\n\
export function beginDispatch(): ClientDispatch {\n  return { memory: new DispatchMemory() };\n}\n\n\
/** The dispatch whose emit is being delivered right now, if any. */\n\
export function currentDispatch(): ClientDispatch | undefined {\n  return current;\n}\n\n\
/** Run `fn` (which emits synchronously) as part of `ctx`. */\n\
export function withinDispatch<T>(ctx: ClientDispatch, fn: () => T): T {\n  const previous = current;\n  current = ctx;\n  try {\n    return fn();\n  } finally {\n    current = previous;\n  }\n}\n";
        InternalFile::new(
            "packages/client/src/hooks/dispatchContext.ts",
            code.to_string(),
            GeneratedFileType::Hook,
        )
    }

    /// Generate the `useOrbitalBridge` hook (Express).
    pub(crate) fn generate_orbital_bridge_hook(&self) -> InternalFile {
        self.generate_orbital_bridge_hook_impl(ServerFramework::Express)
    }

    /// Shared `useOrbitalBridge` generator for both frameworks.
    ///
    /// The Express body is canonical (the superset). Both frameworks import the
    /// event-protocol types from `@app/shared` (both builds ship
    /// `shared/types/events.ts`, and the shared client trait files already
    /// import from it), so the Hono build no longer inlines a diverged subset.
    /// Hono now also gets the orbital-qualified config + cascade re-emit
    /// (`UI:${orbital}.${trait}.${event}`) the Express bridge has — fixing the
    /// latent Hono cascade-qualification bug where a cascade emit fell back to a
    /// bare `eventBus.emit(ev.event, ...)` that no qualified `listens`
    /// subscription matched. The only per-framework line is the `@generated`
    /// doc-header marker.
    /// §60 — hold-until-subscribed store for mount-racy `listens` edges.
    ///
    /// A racy edge's target trait is embedded in a render tree the SOURCE
    /// produces on the very event the target listens for, so the target's
    /// subscription — emitted inside its own component's effect — always
    /// registers after the delivery. The runtime path never hits this because
    /// it subscribes every page-bound trait once at page level
    /// (`almadar-ui/runtime/OrbPreview.tsx` `TraitInitializer`).
    ///
    /// A held entry is written ONLY while the known target is unsubscribed and
    /// is dropped when it subscribes or unmounts, so nothing can survive a
    /// navigation and no payload is pinned for an edge that does not need one.
    /// The bus keeps sole ownership of fan-out and dispatch; this holds an
    /// undelivered payload, it does not route.
    fn generate_racy_listens_store(
        &self,
        racy_listens: &BTreeMap<String, BTreeSet<String>>,
    ) -> String {
        if racy_listens.is_empty() {
            return String::new();
        }
        let mut code = String::new();
        code.push_str("// §60 — mount-racy `listens` edges: qualified bus key → the traits that\n");
        code.push_str("// subscribe to it from inside a view the same event mounts.\n");
        code.push_str("const __RACY_LISTENS: Readonly<Record<string, readonly string[]>> = {\n");
        for (key, targets) in racy_listens {
            let list: Vec<String> = targets.iter().map(|t| format!("'{}'", t)).collect();
            code.push_str(&format!("  '{}': [{}],\n", key, list.join(", ")));
        }
        code.push_str("};\n\n");
        code.push_str("const __heldListens = new Map<string, BusEvent>();\n");
        code.push_str("// Refcount, not a flag: one page can mount two instances of the same\n");
        code.push_str("// trait, and the first to unmount must not mark the slot vacant while\n");
        code.push_str("// the second is still subscribed.\n");
        code.push_str("const __mountedListens = new Map<string, number>();\n\n");
        code.push_str("function __holdForUnmountedListeners(key: string, payload: EventPayload | undefined, source: BusEventSource): void {\n");
        code.push_str("  const targets = __RACY_LISTENS[key];\n");
        code.push_str("  if (targets === undefined) return;\n");
        code.push_str("  for (const target of targets) {\n");
        code.push_str("    const slot = `${key}::${target}`;\n");
        code.push_str("    if ((__mountedListens.get(slot) ?? 0) > 0) continue;\n");
        code.push_str(
            "    __heldListens.set(slot, { type: key, payload, timestamp: Date.now(), source });\n",
        );
        code.push_str("  }\n");
        code.push_str("}\n\n");
        code.push_str("/**\n");
        code.push_str(" * Subscribe a mount-racy cross-trait listener. Hands over the one held\n");
        code.push_str(" * delivery (if the emit happened before this trait mounted) and then\n");
        code.push_str(" * subscribes normally. Unsubscribing clears the slot, so a later mount\n");
        code.push_str(" * of the same trait can never receive a previous page's payload.\n");
        code.push_str(" */\n");
        code.push_str("export function __subscribeListens(\n");
        code.push_str("  eventBus: ReturnType<typeof useEventBus>,\n");
        code.push_str("  key: string,\n");
        code.push_str("  target: string,\n");
        code.push_str("  handler: (event: BusEvent) => void,\n");
        code.push_str("): Unsubscribe {\n");
        code.push_str("  const slot = `${key}::${target}`;\n");
        code.push_str("  __mountedListens.set(slot, (__mountedListens.get(slot) ?? 0) + 1);\n");
        code.push_str("  const held = __heldListens.get(slot);\n");
        code.push_str("  if (held !== undefined) {\n");
        code.push_str("    __heldListens.delete(slot);\n");
        code.push_str("    handler(held);\n");
        code.push_str("  }\n");
        code.push_str("  const unsub = eventBus.on(key, handler);\n");
        code.push_str("  return () => {\n");
        code.push_str("    const remaining = (__mountedListens.get(slot) ?? 1) - 1;\n");
        code.push_str("    if (remaining > 0) {\n");
        code.push_str("      __mountedListens.set(slot, remaining);\n");
        code.push_str("    } else {\n");
        code.push_str("      __mountedListens.delete(slot);\n");
        code.push_str("      __heldListens.delete(slot);\n");
        code.push_str("    }\n");
        code.push_str("    if (typeof unsub === 'function') unsub();\n");
        code.push_str("  };\n");
        code.push_str("}\n\n");
        code
    }

    /// G-ORB-055 — relay store for `listens` edges whose listener has no hook
    /// mounted on this page. The client drives every hop through the
    /// listener's hook; an unmounted listener is delivered by posting the
    /// emit to its orbital route, from its initial state (it holds no state of
    /// its own), and the answer re-enters the bus like any response.
    /// `, locale: __viewerLocale` on a request body when the app declares locales.
    fn viewer_locale_field(&self) -> &'static str {
        if self.browser_locales.snapshot().is_empty() { "" } else { ", locale: __viewerLocale" }
    }

    fn generate_off_page_relay(
        &self,
        off_page: &BTreeMap<String, Vec<crate::backend::OffPageListen>>,
        dispatch_scope: bool,
    ) -> String {
        if off_page.is_empty() {
            return String::new();
        }
        let mut code = String::new();
        code.push_str("// G-ORB-055 — `listens` edges into traits that take server round trips.\n");
        code.push_str("interface __OffPageListen {\n");
        code.push_str("  orbital: string;\n  trait: string;\n  event: string;\n  triggers: string;\n  initial: string;\n");
        code.push_str("  selfEvents: readonly string[];\n");
        code.push_str("  project: (event: BusEvent) => EventPayload | undefined;\n");
        if dispatch_scope {
            code.push_str("  when?: (event: BusEvent, fromState: string, __dispatch: DispatchScope) => boolean;\n");
        } else {
            code.push_str("  when?: (event: BusEvent) => boolean;\n");
        }
        code.push_str("}\n\n");
        code.push_str(
            "const __OFF_PAGE_LISTENS: Readonly<Record<string, readonly __OffPageListen[]>> = {\n",
        );
        for (key, edges) in off_page {
            code.push_str(&format!("  '{}': [\n", key));
            for edge in edges {
                let self_events: Vec<String> = edge
                    .self_events
                    .iter()
                    .map(|e| format!("'{}'", e))
                    .collect();
                code.push_str(&format!(
                    "    {{ orbital: '{}', trait: '{}', event: '{}', triggers: '{}', initial: '{}', selfEvents: [{}], project: (event: BusEvent): EventPayload | undefined => {}",
                    edge.orbital, edge.trait_name, edge.event, edge.triggers, edge.initial, self_events.join(", "), edge.project
                ));
                if let Some(when) = &edge.when {
                    code.push_str(&format!(", when: {}", when));
                }
                code.push_str(" },\n");
            }
            code.push_str("  ],\n");
        }
        code.push_str("};\n\n");
        code.push_str(
            "// An unmounted listener's state and row, held here as its hook would hold them.\n",
        );
        code.push_str("const __offPageStates = new Map<string, string>();\n");
        code.push_str("const __offPageFrames = new Map<string, EntityRow>();\n\n");
        code.push_str("// Refcount per trait: a hook on the page delivers its own listens.\n");
        code.push_str("const __mountedTraits = new Map<string, number>();\n\n");
        code.push_str("export function __markTraitMounted(trait: string): () => void {\n");
        code.push_str("  __mountedTraits.set(trait, (__mountedTraits.get(trait) ?? 0) + 1);\n");
        code.push_str("  return () => {\n");
        code.push_str("    const remaining = (__mountedTraits.get(trait) ?? 1) - 1;\n");
        code.push_str("    if (remaining > 0) __mountedTraits.set(trait, remaining);\n");
        code.push_str("    else __mountedTraits.delete(trait);\n");
        code.push_str("  };\n");
        code.push_str("}\n\n");
        if dispatch_scope {
            code.push_str("function __postToUnmounted(eventBus: ReturnType<typeof useEventBus>, edge: __OffPageListen, event: string, payload: EventPayload | undefined, delivery: DeliveryRecord, dispatchLog: DispatchLog): void {\n");
        } else {
            code.push_str("function __postToUnmounted(eventBus: ReturnType<typeof useEventBus>, edge: __OffPageListen, event: string, payload: EventPayload | undefined, delivery: { event: string; payload?: EventPayload; source: BusEventSource }): void {\n");
        }
        code.push_str("  const frame = __offPageFrames.get(edge.trait);\n");
        code.push_str("  void authHeaders().then((headers) => fetch(`${API_BASE}/api/orbitals/${edge.orbital}/events`, {\n");
        code.push_str("    method: 'POST',\n");
        code.push_str("    headers,\n");
        code.push_str("    credentials: 'include',\n");
        if dispatch_scope {
            code.push_str(&format!("    body: JSON.stringify({{ event, payload, targetTrait: edge.trait, clientId: _clientId, traits: [{{ trait: edge.trait, from: __offPageStates.get(edge.trait) ?? edge.initial }}], entityByTrait: frame !== undefined ? {{ [edge.trait]: frame }} : undefined, delivery, dispatchLog{} }}),\n", self.viewer_locale_field()));
        } else {
            code.push_str(&format!("    body: JSON.stringify({{ event, payload, targetTrait: edge.trait, clientId: _clientId, traits: [{{ trait: edge.trait, from: __offPageStates.get(edge.trait) ?? edge.initial }}], entityByTrait: frame !== undefined ? {{ [edge.trait]: frame }} : undefined, delivery{} }}),\n", self.viewer_locale_field()));
        }
        code.push_str("  }))\n");
        code.push_str("    .then((response) => (response.ok ? (response.json() as Promise<EventResponse>) : undefined))\n");
        code.push_str("    .then((result) => {\n");
        code.push_str("      if (result === undefined || !result.success) return;\n");
        code.push_str("      const next = result.states?.[edge.trait];\n");
        code.push_str("      if (next !== undefined) __offPageStates.set(edge.trait, next);\n");
        code.push_str("      const row = result.entityByTrait?.[edge.trait];\n");
        code.push_str("      if (row !== undefined) __offPageFrames.set(edge.trait, { ...(__offPageFrames.get(edge.trait) ?? {}), ...row });\n");
        code.push_str("      for (const ev of result.emittedEvents) {\n");
        code.push_str("        emitCascadeEvent(eventBus, edge.orbital, edge.trait, ev);\n");
        code.push_str("        // The listener's own continuation: still no hook to drive it.\n");
        code.push_str("        const own = (ev.source?.trait ?? edge.trait) === edge.trait;\n");
        code.push_str("        if (!own || !edge.selfEvents.includes(ev.event) || (__mountedTraits.get(edge.trait) ?? 0) > 0) continue;\n");
        code.push_str("        const source: BusEventSource = { ...(ev.source ?? {}), orbital: edge.orbital, trait: edge.trait };\n");
        code.push_str("        const continued = { event: ev.event, ...(ev.payload !== undefined ? { payload: ev.payload } : {}), source };\n");
        if dispatch_scope {
            code.push_str("        __postToUnmounted(eventBus, edge, ev.event, ev.payload, continued, (currentDispatch() ?? beginDispatch()).memory.log(edge.trait));\n");
        } else {
            code.push_str(
                "        __postToUnmounted(eventBus, edge, ev.event, ev.payload, continued);\n",
            );
        }
        code.push_str("      }\n");
        code.push_str("    })\n");
        code.push_str("    .catch(() => undefined);\n");
        code.push_str("}\n\n");
        code.push_str("function __relayOffPage(eventBus: ReturnType<typeof useEventBus>, key: string, payload: EventPayload | undefined, source: BusEventSource): void {\n");
        code.push_str("  for (const edge of __OFF_PAGE_LISTENS[key] ?? []) {\n");
        code.push_str("    if ((__mountedTraits.get(edge.trait) ?? 0) > 0) continue;\n");
        code.push_str(
            "    const event: BusEvent = { type: key, payload, timestamp: Date.now(), source };\n",
        );
        code.push_str("    const delivery = { event: edge.event, ...(payload !== undefined ? { payload } : {}), source };\n");
        code.push_str("    const projected = edge.project(event);\n");
        if dispatch_scope {
            code.push_str("    const ctx = currentDispatch() ?? beginDispatch();\n");
            code.push_str("    const dispatchLog = ctx.memory.log(edge.trait);\n");
            code.push_str("    if (edge.when !== undefined && !edge.when(event, edge.initial, dispatchScopeOf(delivery, dispatchLog, edge.triggers, projected))) continue;\n");
        } else {
            code.push_str("    if (edge.when !== undefined && !edge.when(event)) continue;\n");
        }
        if dispatch_scope {
            code.push_str("    __postToUnmounted(eventBus, edge, edge.triggers, projected, delivery, dispatchLog);\n");
        } else {
            code.push_str(
                "    __postToUnmounted(eventBus, edge, edge.triggers, projected, delivery);\n",
            );
        }
        code.push_str("  }\n");
        code.push_str("}\n\n");
        code
    }

    pub(crate) fn generate_orbital_bridge_hook_impl(
        &self,
        framework: ServerFramework,
    ) -> InternalFile {
        let racy_listens = self.racy_listens.snapshot();
        let off_page = self.off_page_listens.snapshot();
        let keyed_emit = !racy_listens.is_empty() || !off_page.is_empty();
        let mut code = String::new();
        code.push_str("/**\n");
        code.push_str(" * useOrbitalBridge Hook\n");
        code.push_str(" *\n");
        code.push_str(
            " * Decoupled bridge for trait <-> server communication via the event bus.\n",
        );
        code.push_str(" * Components emit events on the bus; the bridge forwards to the server\n");
        code.push_str(
            " * and emits responses back. Replaces the tightly-coupled useServerBridge.\n",
        );
        code.push_str(" *\n");
        code.push_str(" * Lifecycle events emitted on the bus:\n");
        code.push_str(
            " *   - `{traitName}:DISPATCH`  - before server call (event, payload, currentState)\n",
        );
        code.push_str(" *   - `{traitName}:{event}:SUCCESS` - after successful server response\n");
        code.push_str(" *   - `{traitName}:{event}:ERROR`   - after failed server response\n");
        code.push_str(" *\n");
        match framework {
            ServerFramework::Express => {
                code.push_str(" * @generated by Orbital Compiler (Phase 5)\n");
            }
            ServerFramework::Hono => {
                code.push_str(" * @generated by Orbital Compiler (Hono backend)\n");
            }
        }
        code.push_str(" * @packageDocumentation\n");
        code.push_str(" */\n\n");
        let has_server = self.app_has_server_leg.snapshot();
        code.push_str(if has_server {
            "import { useCallback, useEffect } from 'react';\n"
        } else {
            "import { useCallback } from 'react';\n"
        });
        let viewer_locale = !self.browser_locales.snapshot().is_empty();
        code.push_str(if self.browser_legs.snapshot().is_empty() && !viewer_locale {
            "import { useEventBus } from '@almadar/ui/hooks';\n"
        } else {
            "import { useEventBus, useTranslate } from '@almadar/ui/hooks';\n"
        });
        code.push_str(&crate::codegen::handler_header::core_imports_clause(
            &if !keyed_emit {
                ["EntityRow", "EventPayload", "EventPayloadValue"]
                    .into_iter()
                    .collect::<BTreeSet<&str>>()
            } else {
                [
                    "BusEvent",
                    "BusEventSource",
                    "EntityRow",
                    "EventPayload",
                    "EventPayloadValue",
                    "Unsubscribe",
                ]
                .into_iter()
                .collect::<BTreeSet<&str>>()
            },
        ));
        code.push_str(if has_server {
            "import type { EventResponse, EmittedEvent, BusBroadcastItem } from '@app/shared';\n"
        } else {
            "import type { EventResponse, EmittedEvent } from '@app/shared';\n"
        });
        let browser_legs = self.browser_legs.snapshot();
        if !browser_legs.is_empty() {
            code.push_str("import { openBundledBrowserStore } from '@almadar/runtime';\n");
            code.push_str("import type { EventRequest } from '@app/shared';\n");
            if self.browser_services.snapshot() {
                code.push_str("import { browserCallService } from '@/browserServices';\n");
            }
        }
        let dispatch_scope = self.dispatch_scope.snapshot();
        if dispatch_scope {
            code.push_str("import type { DeliveryRecord, DispatchLog } from '@almadar/core';\n");
            if off_page.is_empty() {
                code.push_str(
                    "import { withinDispatch, type ClientDispatch } from './dispatchContext';\n",
                );
            } else {
                code.push_str(
                    "import { dispatchScopeOf, type DispatchScope } from '@almadar/core';\n",
                );
                code.push_str(
                    "import { beginDispatch, currentDispatch, withinDispatch, type ClientDispatch } from './dispatchContext';\n",
                );
            }
        }
        if self.dev_logs {
            code.push_str(
                "import { createLogger, generateCorrelationId } from '@almadar/logger';\n",
            );
        }
        // Every server call carries the signed-in user's ID token; the server resolves `@user` from it.
        code.push_str("import { authHeaders } from '../config/auth';\n");
        code.push_str("\nexport type { EventRequest, EventResponse } from '@app/shared';\n\n");
        if self.dev_logs {
            code.push_str("const _bridgeLog = createLogger('almadar:bridge:http');\n\n");
        }
        code.push_str("export interface OrbitalBridgeConfig {\n");
        code.push_str("  /** API base path for the trait (e.g., '/api/task-crud') */\n");
        code.push_str("  basePath: string;\n");
        code.push_str("  /** Owning orbital name — used to qualify bus keys per gap #13. */\n");
        code.push_str("  orbitalName: string;\n");
        code.push_str(
            "  /** Trait name - used to qualify bus keys and namespace lifecycle events. */\n",
        );
        code.push_str("  traitName: string;\n");
        code.push_str("}\n\n");
        code.push_str("export interface OrbitalBridge {\n");
        code.push_str(
            "  /** Send an event to the server and emit lifecycle events on the bus */\n",
        );
        code.push_str("  sendEvent: (\n");
        code.push_str("    event: string,\n");
        code.push_str("    payload?: EventPayload,\n");
        code.push_str("    currentState?: string,\n");
        if dispatch_scope {
            code.push_str("    fields?: EntityRow,\n");
            code.push_str("    continuation?: { delivery: DeliveryRecord; dispatchLog: DispatchLog; ctx: ClientDispatch }\n");
        } else {
            code.push_str("    fields?: EntityRow\n");
        }
        code.push_str("  ) => Promise<EventResponse>;\n");
        code.push_str(
            "  /** Send an orbital event to the server over WebSocket (send-server operator). */\n",
        );
        code.push_str("  sendServerEvent: (event: string, payload?: EventPayload) => void;\n");
        code.push_str("  /** The event bus instance (shared with cross-trait listeners) */\n");
        code.push_str("  eventBus: ReturnType<typeof useEventBus>;\n");
        code.push_str("}\n\n");
        code.push_str("// API base URL: empty in dev (Vite proxy handles /api), full server URL in production\n");
        code.push_str("const API_BASE = import.meta.env.VITE_API_URL ?? '';\n\n");
        // Lazy WS singleton for send-server effects
        code.push_str("let _ws: WebSocket | null = null;\n");
        code.push_str("const _wsQueue: string[] = [];\n");
        code.push_str("function _getOrOpenWs(): WebSocket | null {\n");
        code.push_str("  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return null;\n");
        code.push_str("  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return _ws;\n");
        code.push_str("  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';\n");
        code.push_str("  try {\n");
        code.push_str("    _ws = new WebSocket(`${proto}//${location.host}/ws/events`);\n");
        code.push_str("    _ws.addEventListener('open', () => { _wsQueue.splice(0).forEach(m => _ws!.send(m)); });\n");
        code.push_str("    _ws.addEventListener('error', () => { _ws = null; });\n");
        code.push_str("    _ws.addEventListener('close', () => { _ws = null; });\n");
        code.push_str("  } catch { _ws = null; }\n");
        code.push_str("  return _ws;\n");
        code.push_str("}\n\n");
        code.push_str("// Live-push (Almadar_Live_Push.md): one id per tab, stamped on every\n");
        code.push_str("// dispatch. The server's SSE broadcast excludes the origin clientId —\n");
        code.push_str("// this tab already receives the emit in-response.\n");
        code.push_str(
            "const _clientId = typeof crypto !== 'undefined' ? crypto.randomUUID() : '';\n\n",
        );
        // Mount in one round trip: a lifecycle send joins the batch of every
        // hook mounting in the same commit (same orbital, same payload).
        if !browser_legs.is_empty() {
            let keys: Vec<String> = browser_legs
                .iter()
                .map(|k| format!("'{}'", k.replace('\u{0}', "\\u0000")))
                .collect();
            code.push_str(
                "// Legs over browser-stored entities run against the in-process browser store.\n",
            );
            code.push_str(&format!(
                "const __BROWSER_LEGS: ReadonlySet<string> = new Set([{}]);\n",
                keys.join(", ")
            ));
            // The catalogs App.tsx loads: the declared locales, or the schema language's one file.
            let mut locales = self.browser_locales.snapshot();
            if locales.is_empty() {
                locales.push(self.schema_language.clone());
            }
            for locale in &locales {
                code.push_str(&format!(
                    "import __messages_{locale} from '../../../../locales/{locale}.json';\n"
                ));
            }
            let entries: Vec<String> = locales
                .iter()
                .map(|l| format!("{l}: __messages_{l}"))
                .collect();
            code.push_str(&format!(
                "const __BROWSER_MESSAGES: Record<string, Record<string, string>> = {{ {} }};\n",
                entries.join(", ")
            ));
            code.push_str("// One store per viewer locale: its rows are seeded in that locale.\n");
            code.push_str("const __browserTransports = new Map<string, ReturnType<typeof openBundledBrowserStore>>();\n");
            code.push_str("function __browserSend(orbitalName: string, request: EventRequest, locale: string): Promise<EventResponse> {\n");
            code.push_str("  let transport = __browserTransports.get(locale);\n");
            code.push_str("  if (transport === undefined) {\n");
            code.push_str(if self.browser_services.snapshot() {
                "    transport = import('@/browserSchema.json').then((m) => openBundledBrowserStore(m.default, locale, browserCallService, __BROWSER_MESSAGES));\n"
            } else {
                "    transport = import('@/browserSchema.json').then((m) => openBundledBrowserStore(m.default, locale, undefined, __BROWSER_MESSAGES));\n"
            });
            code.push_str("    __browserTransports.set(locale, transport);\n");
            code.push_str("  }\n");
            code.push_str(
                "  return transport.then((t) => t.send(orbitalName, { ...request, locale }));\n",
            );
            code.push_str("}\n\n");
        }
        code.push_str("const __LIFECYCLE_EVENTS: ReadonlySet<string> = new Set(['INIT', 'LOAD', '$MOUNT']);\n");
        code.push_str("interface __MountRequest { trait: string; event: string; from?: string; fields?: EntityRow; payload?: EventPayload }\n");
        code.push_str("interface __MountItem extends __MountRequest { orbitalName: string; resolve: (r: EventResponse) => void; reject: (e: Error) => void }\n");
        code.push_str("const __mountBatches = new Map<string, __MountItem[]>();\n");
        if viewer_locale {
            code.push_str("// The page's locale (its I18nProvider); servers evaluate `i18n/t` with it.\n");
            code.push_str("let __viewerLocale: string | undefined;\n");
        }
        code.push_str("/** The lifecycle sends of every hook mounting in one commit share ONE `mount` request to the orbital route. */\n");
        code.push_str("function __mountFetch(orbitalName: string, item: __MountRequest): Promise<EventResponse> {\n");
        code.push_str(
            "  const key = `${orbitalName}\\u0000${JSON.stringify(item.payload ?? null)}`;\n",
        );
        code.push_str("  return new Promise<EventResponse>((resolve, reject) => {\n");
        code.push_str("    let batch = __mountBatches.get(key);\n");
        code.push_str("    if (batch === undefined) {\n");
        code.push_str("      batch = [];\n");
        code.push_str("      __mountBatches.set(key, batch);\n");
        code.push_str("      queueMicrotask(() => { void __flushMount(key); });\n");
        code.push_str("    }\n");
        code.push_str("    batch.push({ ...item, orbitalName, resolve, reject });\n");
        code.push_str("  });\n");
        code.push_str("}\n");
        code.push_str("async function __flushMount(key: string): Promise<void> {\n");
        code.push_str("  const batch = __mountBatches.get(key) ?? [];\n");
        code.push_str("  __mountBatches.delete(key);\n");
        code.push_str("  const first = batch[0];\n");
        code.push_str("  if (first === undefined) return;\n");
        code.push_str("  const entityByTrait: Record<string, EntityRow> = {};\n");
        code.push_str("  for (const i of batch) if (i.fields !== undefined) entityByTrait[i.trait] = i.fields;\n");
        code.push_str("  try {\n");
        code.push_str("    const response = await fetch(`${API_BASE}/api/orbitals/${first.orbitalName}/events`, {\n");
        code.push_str("      method: 'POST',\n");
        code.push_str("      headers: await authHeaders(),\n");
        code.push_str("      credentials: 'include',\n");
        code.push_str("      body: JSON.stringify({\n");
        code.push_str("        event: first.event,\n");
        code.push_str("        payload: first.payload,\n");
        code.push_str("        clientId: _clientId,\n");
        code.push_str("        mount: batch.map((i) => ({ trait: i.trait, event: i.event })),\n");
        code.push_str("        traits: batch.flatMap((i) => (i.from !== undefined ? [{ trait: i.trait, from: i.from }] : [])),\n");
        code.push_str("        entityByTrait: Object.keys(entityByTrait).length > 0 ? entityByTrait : undefined,\n");
        if viewer_locale {
            code.push_str("        locale: __viewerLocale,\n");
        }
        code.push_str("      }),\n");
        code.push_str("    });\n");
        code.push_str("    const result: EventResponse = response.ok\n");
        code.push_str("      ? await response.json()\n");
        code.push_str("      : { success: false, transitioned: false, states: {}, emittedEvents: [], error: `HTTP ${response.status}: ${response.statusText}` };\n");
        code.push_str(
            "    // The cross-trait re-emits run once: only the first item's slice carries them.\n",
        );
        code.push_str("    batch.forEach((i, index) => i.resolve(index === 0 ? result : { ...result, emittedEvents: [] }));\n");
        code.push_str("  } catch (err) {\n");
        code.push_str("    for (const i of batch) i.reject(err instanceof Error ? err : new Error(String(err)));\n");
        code.push_str("  }\n");
        code.push_str("}\n\n");
        if has_server {
            // §61 — one EventSource per app; §91 — one cascade per broadcast item,
            // keyed by the item's own source (never the subscribing hook's trait).
            code.push_str("let _sse: EventSource | null = null;\n");
            code.push_str("let _sseBus: ReturnType<typeof useEventBus> | null = null;\n");
            code.push_str("let _sseSubscribers = 0;\n");
            code.push_str("function _openSseOnce(): void {\n");
            code.push_str("  if (_sse !== null || typeof EventSource === 'undefined') return;\n");
            code.push_str(
                "  _sse = new EventSource(`${API_BASE}/api/events?clientId=${_clientId}`);\n",
            );
            code.push_str("  _sse.onmessage = (ev) => {\n");
            code.push_str("    let parsed: Partial<BusBroadcastItem> | null;\n");
            code.push_str("    try {\n");
            code.push_str("      parsed = JSON.parse(ev.data);\n");
            code.push_str("    } catch {\n");
            code.push_str("      return;\n");
            code.push_str("    }\n");
            code.push_str(
                "    if (!parsed || typeof parsed !== 'object' || parsed.type !== 'bus' || _sseBus === null) return;\n",
            );
            code.push_str("    const item = parsed as BusBroadcastItem;\n");
            code.push_str("    emitCascadeEvent(_sseBus, item.source.orbital, item.source.trait, { event: item.event, payload: item.payload, source: item.source });\n");
            code.push_str("  };\n");
            // Native auto-reconnect only — EventSource retries on its own after a
            // transport error; no manual reconnect/backoff loop is added.
            code.push_str("}\n\n");
        }
        code.push_str("// Shared qualified cascade re-emit — used both for the in-response\n");
        code.push_str("// `emittedEvents` loop below and the SSE subscribe leg, so a same-tab\n");
        code.push_str("// cascade and a cross-client broadcast fire through the identical\n");
        code.push_str(
            "// `UI:${orbital}.${trait}.${event}` path that `listens` subscriptions match.\n",
        );
        code.push_str("export function emitCascadeEvent(\n");
        code.push_str("  eventBus: ReturnType<typeof useEventBus>,\n");
        code.push_str("  orbitalName: string,\n");
        code.push_str("  traitName: string,\n");
        code.push_str("  ev: Pick<EmittedEvent, 'event' | 'payload' | 'source'>\n");
        code.push_str("): void {\n");
        code.push_str("  const evOrbital = ev.source?.orbital ?? orbitalName;\n");
        code.push_str("  const evTrait = ev.source?.trait ?? traitName;\n");
        if !keyed_emit {
            code.push_str("  eventBus.emit(`UI:${evOrbital}.${evTrait}.${ev.event}`, ev.payload, { ...(ev.source ?? {}), orbital: evOrbital, trait: evTrait, fromBridge: true });\n");
        } else {
            code.push_str("  const key = `UI:${evOrbital}.${evTrait}.${ev.event}`;\n");
            code.push_str("  const source = { ...(ev.source ?? {}), orbital: evOrbital, trait: evTrait, fromBridge: true };\n");
            code.push_str("  eventBus.emit(key, ev.payload, source);\n");
            if !racy_listens.is_empty() {
                code.push_str("  __holdForUnmountedListeners(key, ev.payload, source);\n");
            }
            if !off_page.is_empty() {
                code.push_str("  __relayOffPage(eventBus, key, ev.payload, source);\n");
            }
        }
        code.push_str("}\n\n");
        code.push_str(&self.generate_racy_listens_store(&racy_listens));
        code.push_str(&self.generate_off_page_relay(&off_page, dispatch_scope));
        code.push_str("export function useOrbitalBridge({ basePath, orbitalName, traitName }: OrbitalBridgeConfig): OrbitalBridge {\n");
        code.push_str("  const eventBus = useEventBus();\n");
        if !browser_legs.is_empty() || viewer_locale {
            code.push_str("  const { locale: __locale } = useTranslate();\n");
        }
        if viewer_locale {
            code.push_str("  __viewerLocale = __locale;\n");
        }
        let locale_field = if viewer_locale { ", locale: __viewerLocale" } else { "" };
        code.push('\n');
        code.push_str("  const sendEvent = useCallback(\n");
        code.push_str("    async (\n");
        code.push_str("      event: string,\n");
        code.push_str("      payload?: EventPayload,\n");
        code.push_str("      currentState?: string,\n");
        if dispatch_scope {
            code.push_str("      fields?: EntityRow,\n");
            code.push_str("      continuation?: { delivery: DeliveryRecord; dispatchLog: DispatchLog; ctx: ClientDispatch }\n");
        } else {
            code.push_str("      fields?: EntityRow\n");
        }
        code.push_str("    ): Promise<EventResponse> => {\n");
        if self.dev_logs {
            code.push_str("      const _cid = generateCorrelationId();\n");
            code.push_str("      _bridgeLog.info('request', { method: 'POST', url: `${API_BASE}${basePath}/events`, event, currentState }, _cid);\n");
        }
        code.push_str("      // Emit pre-dispatch lifecycle event (for debugging, analytics, local listeners)\n");
        code.push_str(
            "      eventBus.emit(`${traitName}:DISPATCH`, { event, payload, currentState });\n\n",
        );
        code.push_str("      try {\n");
        let routed = !browser_legs.is_empty();
        if routed {
            code.push_str(
                "        const __browserLeg = __BROWSER_LEGS.has(`${traitName}\\u0000${event}`);\n",
            );
        }
        let not_browser = if routed { "!__browserLeg && " } else { "" };
        if dispatch_scope {
            code.push_str(&format!("        const __isMount = {not_browser}__LIFECYCLE_EVENTS.has(event) && continuation === undefined;\n"));
        } else {
            code.push_str(&format!(
                "        const __isMount = {not_browser}__LIFECYCLE_EVENTS.has(event);\n"
            ));
        }
        code.push_str(if routed {
            "        const response = (__isMount || __browserLeg) ? undefined : await fetch(`${API_BASE}${basePath}/events`, {\n"
        } else {
            "        const response = __isMount ? undefined : await fetch(`${API_BASE}${basePath}/events`, {\n"
        });
        code.push_str("          method: 'POST',\n");
        code.push_str("          headers: await authHeaders(),\n");
        code.push_str("          credentials: 'include',\n");
        // §156: the wire's `traits[]`/`entityByTrait` generalize this
        // bridge's single-trait `currentState`/`fields` params into the
        // stateless per-trait addressing shape the compiled server reads.
        if dispatch_scope {
            code.push_str(&format!("          body: JSON.stringify({{ event, payload, clientId: _clientId, traits: [{{ trait: traitName, from: currentState }}], entityByTrait: fields ? {{ [traitName]: fields }} : undefined, delivery: continuation?.delivery, dispatchLog: continuation?.dispatchLog{locale_field} }}),\n"));
        } else {
            code.push_str(&format!("          body: JSON.stringify({{ event, payload, clientId: _clientId, traits: [{{ trait: traitName, from: currentState }}], entityByTrait: fields ? {{ [traitName]: fields }} : undefined{locale_field} }}),\n"));
        }
        code.push_str("        });\n\n");
        code.push_str("        if (response !== undefined && !response.ok) {\n");
        code.push_str("          const errorResponse: EventResponse = {\n");
        code.push_str("            success: false,\n");
        code.push_str("            transitioned: false,\n");
        code.push_str("            states: {},\n");
        code.push_str("            emittedEvents: [],\n");
        code.push_str("            error: `HTTP ${response.status}: ${response.statusText}`,\n");
        code.push_str("          };\n");
        if self.dev_logs {
            code.push_str("          _bridgeLog.warn('response:error', { status: response.status, error: errorResponse.error }, _cid);\n");
        }
        code.push_str("          eventBus.emit(`${traitName}:${event}:ERROR`, { event, success: false, error: errorResponse.error });\n");
        code.push_str("          return errorResponse;\n");
        code.push_str("        }\n\n");
        if routed {
            code.push_str("        const result: EventResponse = __browserLeg\n");
            code.push_str("          ? await __browserSend(orbitalName, { event, payload, clientId: _clientId, ...(currentState !== undefined ? { traits: [{ trait: traitName, from: currentState }] } : {}), ...(fields ? { entityByTrait: { [traitName]: fields } } : {})");
            if dispatch_scope {
                code.push_str(", ...(continuation ? { delivery: continuation.delivery, dispatchLog: continuation.dispatchLog } : {})");
            }
            code.push_str(" }, __locale)\n");
            code.push_str("          : response === undefined\n");
        } else {
            code.push_str("        const result: EventResponse = response === undefined\n");
        }
        code.push_str("          ? await __mountFetch(orbitalName, { trait: traitName, event, from: currentState, fields, payload })\n");
        code.push_str("          : await response.json();\n\n");
        code.push_str("        if (result.success) {\n");
        if self.dev_logs {
            code.push_str("          _bridgeLog.info('response:ok', { ...(response !== undefined ? { status: response.status } : {}), newState: result.states?.[traitName] }, _cid);\n");
        }
        // Lifecycle SUCCESS payload carries the full response surface so
        // VerificationProvider (and any other listener) can record
        // emittedEvents / clientEffects / effectResults / data without
        // needing a separate hook into ServerBridge. Without this,
        // verifier-side observers reading `serverResponse.emittedEvents`
        // saw an empty array even when the server's persist effect's
        // `emit.success` block fired. `emittedEvents`/`effectResults` are
        // arrays of NAMED interfaces (`EmittedEvent[]`/
        // `ServerEffectResult[]`, no index signature of their own) — a
        // cast straight from the named array type to `EventPayloadValue`
        // (or nested inside the outer `as EventPayload`) is TS2352, even
        // though every field the interfaces declare is honestly
        // `EventPayloadValue`-shaped (never `as unknown as`, the escape
        // hatch this used to need): TS's `as` comparability check treats a
        // FRESH object-literal expression far more leniently than a named
        // type reference, so `.map(e => ({ ...e }))` re-literalizes each
        // element (a value-preserving, honest transform, not a widening
        // trick). `ServerEffectResult` clears this on its own; `EmittedEvent`
        // needs one more step — its `source?: BusEventSource` field (routing
        // metadata: orbital/trait names + the V4 branded `OrbitalId`/
        // `TraitId`/`EventId` siblings) still fails comparability one level
        // deep (TS's `as`-comparability check has a depth/complexity budget
        // a branded-type field can exhaust — the SAME spread cleared it at
        // the top level, alone, in isolation). `source` is routing plumbing
        // the observability listener never reads (`event`/`payload` are the
        // whole point), so it is dropped rather than laundered through a
        // second cast.
        code.push_str("          eventBus.emit(`${traitName}:${event}:SUCCESS`, { event, currentState, success: true, newState: result.states?.[traitName], emittedEvents: result.emittedEvents.map((e) => ({ event: e.event, payload: e.payload }) as EventPayloadValue), effectResults: result.effectResults?.map((e) => ({ ...e }) as EventPayloadValue), data: result.data } as EventPayload);\n");
        code.push_str("          // Re-emit the transition's event on the client bus so cross-\n");
        code.push_str(
            "          // trait `listens { SourceTrait EVENT → Y }` subscriptions fire.\n",
        );
        code.push_str(
            "          // Otherwise the bus only ever sees `UI:EVENT` (from Button) and\n",
        );
        code.push_str(
            "          // `${traitName}:${event}:SUCCESS` (logging) — cross-trait listeners\n",
        );
        code.push_str(
            "          // subscribe to plain `EVENT` with a source filter, so they'd never\n",
        );
        code.push_str(
            "          // fire on a user-click flow even when the server returns success.\n",
        );
        code.push_str(
            "          // Skip lifecycle events to avoid re-dispatching INIT cascades.\n",
        );
        code.push_str("          if (event !== 'INIT' && event !== 'LOAD' && event !== '$MOUNT' && event !== '$UNMOUNT') {\n");
        code.push_str(
            "            // Gap #13: emit qualified `UI:Orbital.Trait.Event` so cross-trait\n",
        );
        code.push_str(
            "            // `listens` subscriptions (which now subscribe to the qualified\n",
        );
        code.push_str(
            "            // key) match. `fromBridge: true` is kept on `source` for diagnostic\n",
        );
        code.push_str(
            "            // tooling that wants to distinguish bus echoes from user clicks.\n",
        );
        // `dispatched: true` distinguishes a bridge echo of the event the
        // trait JUST dispatched (loop risk for the source's useUIEvents)
        // from a server-side cascade emit (path 2 below, no `dispatched`
        // flag — those reach the trait's transition handler legitimately).
        // `fromBridge: true` covers both bridge paths so cross-trait
        // listeners can filter on it.
        if !keyed_emit {
            code.push_str("            eventBus.emit(`UI:${orbitalName}.${traitName}.${event}`, payload, { orbital: orbitalName, trait: traitName, fromBridge: true, dispatched: true });\n");
        } else {
            code.push_str(
                "            const echoKey = `UI:${orbitalName}.${traitName}.${event}`;\n",
            );
            code.push_str("            const echoSource = { orbital: orbitalName, trait: traitName, fromBridge: true, dispatched: true };\n");
            code.push_str("            eventBus.emit(echoKey, payload, echoSource);\n");
            if !racy_listens.is_empty() {
                code.push_str(
                    "            __holdForUnmountedListeners(echoKey, payload, echoSource);\n",
                );
            }
            if !off_page.is_empty() {
                code.push_str(
                    "            __relayOffPage(eventBus, echoKey, payload, echoSource);\n",
                );
            }
        }
        code.push_str("          }\n");
        code.push_str(
            "          // Fix B (Phase 9.5.H): server is stateless per request. Any effect\n",
        );
        code.push_str(
            "          // with `emit: { success: \"X\" }` appends X to `result.emittedEvents`.\n",
        );
        code.push_str(
            "          // Fire each on the client bus; cross-trait `listens` subscribers\n",
        );
        code.push_str(
            "          // (gap #13: qualified bus keys) dispatch them back to their state\n",
        );
        code.push_str("          // machines so the state cascade advances. Without this, a\n");
        code.push_str("          // fetch-in-INIT pattern stalls in `loading`.\n");
        // §156: `emittedEvents` is ALWAYS an array on the wire (never
        // absent), so no `Array.isArray` guard is needed.
        if dispatch_scope {
            code.push_str("          const __reemit = (): void => {\n");
        }
        code.push_str("          for (const ev of result.emittedEvents) {\n");
        if self.dev_logs {
            code.push_str(
                "            _bridgeLog.info('cascade:emit', { event: ev.event }, _cid);\n",
            );
        }
        // Server-side cascade emits (`(emit X)` and `fetch.emit.success`) are
        // bridge-confirmed signals, not click-time UI events; `emitCascadeEvent`
        // marks them `fromBridge: true` so cross-trait listeners (which filter
        // on fromBridge) catch them while the source's own useUIEvents (which
        // skips fromBridge) ignores them. Same canonical-emission contract as
        // path 1 above.
        code.push_str("            emitCascadeEvent(eventBus, orbitalName, traitName, ev);\n");
        code.push_str("          }\n");
        if dispatch_scope {
            code.push_str("          };\n");
            code.push_str("          if (continuation !== undefined) withinDispatch(continuation.ctx, __reemit);\n");
            code.push_str("          else __reemit();\n");
        }
        code.push_str("        } else {\n");
        if self.dev_logs {
            code.push_str(
                "          _bridgeLog.warn('response:fail', { error: result.error }, _cid);\n",
            );
        }
        code.push_str("          eventBus.emit(`${traitName}:${event}:ERROR`, { event, currentState, success: false, error: result.error, guardFailed: result.guardFailed });\n");
        code.push_str("        }\n\n");
        code.push_str("        return result;\n");
        code.push_str("      } catch (err) {\n");
        code.push_str("        const errorResponse: EventResponse = {\n");
        code.push_str("          success: false,\n");
        code.push_str("          transitioned: false,\n");
        code.push_str("          states: {},\n");
        code.push_str("          emittedEvents: [],\n");
        code.push_str("          error: err instanceof Error ? err.message : 'Network error',\n");
        code.push_str("        };\n");
        if self.dev_logs {
            code.push_str("        _bridgeLog.error('response:network', { error: errorResponse.error }, _cid);\n");
        }
        code.push_str(
            "        eventBus.emit(`${traitName}:${event}:ERROR`, { event, success: false, error: errorResponse.error });\n",
        );
        code.push_str("        return errorResponse;\n");
        code.push_str("      }\n");
        code.push_str("    },\n");
        code.push_str(if routed {
            "    [basePath, traitName, eventBus, __locale]\n"
        } else {
            "    [basePath, traitName, eventBus]\n"
        });
        code.push_str("  );\n\n");
        code.push_str("  const sendServerEvent = useCallback((event: string, payload?: EventPayload): void => {\n");
        code.push_str("    const msg = JSON.stringify({ type: 'ORBITAL_EVENT', payload: { orbital: orbitalName, event, payload: payload ?? null } });\n");
        code.push_str("    const ws = _getOrOpenWs();\n");
        code.push_str("    if (!ws) return;\n");
        code.push_str("    if (ws.readyState === WebSocket.OPEN) { ws.send(msg); } else { _wsQueue.push(msg); }\n");
        code.push_str("  }, [orbitalName]);\n\n");
        if has_server {
            code.push_str("  // Live-push (Almadar_Live_Push.md): subscribe to the server's SSE\n");
            code.push_str(
                "  // broadcast of OTHER clients' persist-effect success emits and re-emit\n",
            );
            code.push_str(
                "  // them through the same qualified cascade path the in-response loop\n",
            );
            code.push_str(
                "  // above uses, so `listens` subscriptions fire identically either way.\n",
            );
            code.push_str("  useEffect(() => {\n");
            code.push_str("    _sseBus = eventBus;\n");
            code.push_str("    _sseSubscribers += 1;\n");
            code.push_str("    _openSseOnce();\n");
            code.push_str("    return () => {\n");
            code.push_str("      _sseSubscribers -= 1;\n");
            // The stream closes only when the last subscriber leaves, so a
            // navigation that swaps every trait does not leave it dangling.
            code.push_str(
                "      if (_sseSubscribers === 0 && _sse !== null) { _sse.close(); _sse = null; _sseBus = null; }\n",
            );
            code.push_str("    };\n");
            code.push_str("  }, [eventBus]);\n\n");
        }
        code.push_str("  return { sendEvent, sendServerEvent, eventBus };\n");
        code.push_str("}\n\n");
        code.push_str("export default useOrbitalBridge;\n");

        InternalFile::new(
            "packages/client/src/hooks/useOrbitalBridge.ts",
            code,
            GeneratedFileType::Hook,
        )
    }
}

#[cfg(test)]
mod mount_batch_tests {
    use super::*;

    #[test]
    fn success_logs_allow_mount_and_browser_results_without_http_response() {
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            for dev_logs in [false, true] {
                for browser in [false, true] {
                    let mut backend = TypeScriptBackend::new();
                    backend.dev_logs = dev_logs;
                    if browser {
                        backend
                            .browser_legs
                            .set(["Checkout\u{0000}SAVE".into()].into_iter().collect());
                    }
                    let js = backend.generate_orbital_bridge_hook_impl(framework).content;
                    assert!(js.contains("await __mountFetch("), "{js}");
                    assert!(
                        js.contains("await fetch(`${API_BASE}${basePath}/events`"),
                        "{js}"
                    );
                    assert_eq!(js.contains("? await __browserSend("), browser, "{js}");
                    if dev_logs {
                        assert!(js.contains("_bridgeLog.info('response:ok', { ...(response !== undefined ? { status: response.status } : {}),"), "{js}");
                        assert!(
                            js.contains("if (response !== undefined && !response.ok) {"),
                            "{js}"
                        );
                        assert!(
                            js.contains(
                                "_bridgeLog.warn('response:error', { status: response.status,"
                            ),
                            "{js}"
                        );
                    } else {
                        assert!(!js.contains("_bridgeLog.info('response:ok'"), "{js}");
                    }
                }
            }
        }
    }

    /// The auto-INITs of every hook mounting in one commit share ONE `mount` request to
    /// the orbital route (JS twin: `client-kernel-mount.test.ts`); the cross-trait
    /// re-emits run once, from the first item's slice.
    #[test]
    fn lifecycle_sends_without_a_continuation_go_through_the_mount_batcher() {
        let bridge = TypeScriptBackend::new()
            .generate_orbital_bridge_hook()
            .content;
        assert!(bridge.contains("function __mountFetch(orbitalName: string, item: __MountRequest): Promise<EventResponse> {"), "{bridge}");
        assert!(
            bridge.contains("queueMicrotask(() => { void __flushMount(key); });"),
            "{bridge}"
        );
        assert!(
            bridge.contains("fetch(`${API_BASE}/api/orbitals/${first.orbitalName}/events`"),
            "{bridge}"
        );
        assert!(
            bridge.contains("mount: batch.map((i) => ({ trait: i.trait, event: i.event })),"),
            "{bridge}"
        );
        assert!(bridge.contains("batch.forEach((i, index) => i.resolve(index === 0 ? result : { ...result, emittedEvents: [] }));"), "{bridge}");
        assert!(
            bridge.contains("const __isMount = __LIFECYCLE_EVENTS.has(event);"),
            "{bridge}"
        );
    }

    #[test]
    fn control_other_events_keep_the_per_trait_route() {
        let bridge = TypeScriptBackend::new()
            .generate_orbital_bridge_hook()
            .content;
        assert!(
            bridge.contains("fetch(`${API_BASE}${basePath}/events`"),
            "{bridge}"
        );
    }
}

#[cfg(test)]
mod viewer_locale_tests {
    use super::*;

    fn bridge(locales: &[&str], framework: ServerFramework) -> String {
        let backend = TypeScriptBackend::new();
        backend
            .browser_locales
            .set(locales.iter().map(|l| l.to_string()).collect());
        backend.generate_orbital_bridge_hook_impl(framework).content
    }

    /// G-ORB-189(a): servers evaluate `i18n/t` with the viewer's locale, so every
    /// request the compiled client sends carries it (the 2026-10-03 event contract).
    #[test]
    fn every_server_send_carries_the_viewer_locale_when_the_app_declares_locales() {
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            let js = bridge(&["en", "ar"], framework);
            assert!(js.contains("import { useEventBus, useTranslate } from '@almadar/ui/hooks';"), "{js}");
            assert!(js.contains("let __viewerLocale: string | undefined;"), "{js}");
            assert!(js.contains("  const { locale: __locale } = useTranslate();\n  __viewerLocale = __locale;\n"), "{js}");
            assert!(js.contains("entityByTrait: fields ? { [traitName]: fields } : undefined, locale: __viewerLocale }),"), "{js}");
            assert!(js.contains("        locale: __viewerLocale,\n"), "{js}");
        }
    }

    #[test]
    fn control_an_app_without_locales_sends_no_locale() {
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            let js = bridge(&[], framework);
            assert!(!js.contains("__viewerLocale"), "{js}");
            assert!(!js.contains("useTranslate"), "{js}");
        }
    }
}
