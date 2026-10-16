//! Server-side trait ticks for the compiled app (Runtime Spec Clause 8). A `[background]` tick, or
//! any tick of a server-awaited trait, runs here — once per row, mount-scoped unless `[background]`.

use crate::backend::*;
use orbital_core_base::ir::{OirInterval, OirTick};
use orbital_core_base::str_utils::to_pascal_case;

/// Interval a tick fires at on the server; `frame` has no display to follow, so it runs every 16 ms
/// pass like the interpreter's non-rAF fallback (`TickScheduler`).
enum ServerTickCadence {
    EveryMs(u64),
    Cron(String),
}

fn cadence(interval: &OirInterval) -> ServerTickCadence {
    match interval {
        OirInterval::Frame => ServerTickCadence::EveryMs(16),
        OirInterval::Milliseconds { value } => ServerTickCadence::EveryMs(*value),
        OirInterval::Seconds { value } => ServerTickCadence::EveryMs(*value * 1000),
        OirInterval::Minutes { value } => ServerTickCadence::EveryMs(*value * 60 * 1000),
        OirInterval::Cron { expression } => ServerTickCadence::Cron(expression.clone()),
    }
}

/// Whether `tick` runs in the client (`generate_tick_effects`) rather than here: orbital-core's
/// one placement rule (`OirTrait::tick_runs_on_client`) against the trait's resolved entity.
pub(crate) fn tick_runs_on_client(trait_def: &OirTrait, tick: &OirTick, module: &OirModule) -> bool {
    let entity = trait_def
        .linked_entity
        .as_ref()
        .and_then(|name| module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), name));
    trait_def.tick_runs_on_client(
        tick,
        entity,
        &orbital_core_base::runs_on::Residence::of_module(module),
    )
}

/// The ticks the server runs for `trait_def`.
pub(crate) fn server_ticks<'t>(trait_def: &'t OirTrait, module: &OirModule) -> Vec<&'t OirTick> {
    trait_def
        .ticks
        .iter()
        .filter(|tick| !tick_runs_on_client(trait_def, tick, module))
        .collect()
}

pub(crate) fn module_has_server_ticks(module: &OirModule) -> bool {
    module
        .traits
        .iter()
        .any(|t| !server_ticks(t, module).is_empty())
}

fn tick_fn_name(tick: &OirTick) -> String {
    format!("runTick{}", to_pascal_case(&tick.name))
}

impl TypeScriptBackend {
    /// `handleEvent` lines that record this tab's mount (lifecycle events) and answer `$UNMOUNT`.
    pub(crate) fn server_tick_mount_lines(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        respond: &str,
    ) -> String {
        if server_ticks(trait_def, module).is_empty() {
            return String::new();
        }
        let name = &trait_def.name;
        format!(
            "  // Runtime Spec Clause 8.3: this trait's mount-scoped ticks run only while a tab has it mounted.\n  if (event === '$UNMOUNT') {{\n    recordMount('{name}', clientId, false);\n    {respond}\n  }}\n  if (event === 'INIT' || event === 'LOAD' || event === '$MOUNT') recordMount('{name}', clientId, true);\n\n"
        )
    }

    /// One exported `runTick*` function per server tick: a firing runs the guard and effects once per
    /// row of the linked entity (once with no row when unlinked) and returns what it emitted.
    pub(crate) fn generate_trait_tick_functions(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        framework: ServerFramework,
    ) -> String {
        let ticks = server_ticks(trait_def, module);
        if ticks.is_empty() {
            return String::new();
        }
        let initial = trait_def
            .states
            .iter()
            .find(|s| s.is_initial)
            .or_else(|| trait_def.states.first())
            .map(|s| s.name.clone())
            .unwrap_or_default();
        let linked = trait_def.linked_entity.as_ref().map(|name| {
            let node = module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), name);
            let collection = node
                .map(|e| e.collection.clone())
                .unwrap_or_else(|| to_snake_case(name));
            let frame_fields: Vec<&str> = node.map(|e| e.frame_fields()).unwrap_or_default();
            let ty = crate::codegen::handler_header::entity_type_ref(name);
            let binding = crate::codegen::handler_header::entity_frame_binding(
                &ty,
                &collection,
                &frame_fields,
            );
            (ty, collection, binding)
        });

        let mut code = String::new();
        for tick in ticks {
            let mut trans = OirTransition::new(&initial, &initial, format!("$TICK_{}", tick.name));
            trans.effects = tick.effects.clone();
            let guard = tick
                .guard
                .as_ref()
                .map(|g| self.compile_guard_to_ts(g))
                .unwrap_or_else(|| "true".to_string());
            let body = self
                .generate_transition_body_impl(&trans, trait_def, module, "        ", framework);

            code.push_str(&format!(
                "/** Tick `{}`: one firing, mount-scoped unless `[background]`. */\n",
                tick.name
            ));
            code.push_str(&format!(
                "export async function {}(now: number): Promise<EmittedEvent[]> {{\n",
                tick_fn_name(tick)
            ));
            code.push_str("  const fired: EmittedEvent[] = [];\n");
            code.push_str("  const user: UserContext | undefined = undefined;\n");
            code.push_str("  const clientId: string | undefined = undefined;\n");
            code.push_str("  const payload: EventPayload | undefined = undefined;\n");
            code.push_str("  const entityFrame: EntityRow | undefined = undefined;\n");
            code.push_str(&format!(
                "  const state: {}State = '{}';\n",
                trait_def.name, initial
            ));
            let (open, row_id, close) = match &linked {
                Some((ty, collection, _)) => (
                    format!("  for (const __tickRow of await getDataService().list<{ty}>('{collection}')) {{\n"),
                    "    const entityId: string | undefined = typeof __tickRow.id === 'string' ? __tickRow.id : undefined;\n".to_string(),
                    "  }\n".to_string(),
                ),
                None => (
                    "  {\n".to_string(),
                    "    const entityId: string | undefined = undefined;\n".to_string(),
                    "  }\n".to_string(),
                ),
            };
            code.push_str(&open);
            code.push_str(&row_id);
            code.push_str("    const response = await (async (): Promise<EventResponse> => {\n");
            code.push_str("      const data: Record<string, EntityRow[]> = {};\n");
            code.push_str("      const effectResults: ServerEffectResult[] = [];\n");
            code.push_str("      const emittedEvents: EmittedEvent[] = [];\n");
            if let Some((_, _, binding)) = &linked {
                for line in binding.lines() {
                    code.push_str(&format!("    {line}\n"));
                }
            }
            code.push_str(&format!("      if ({guard}) {{\n"));
            code.push_str(&body);
            code.push_str("      }\n");
            code.push_str(
                "      return { success: true, transitioned: false, states: {}, emittedEvents };\n",
            );
            code.push_str("    })();\n");
            code.push_str("    fired.push(...(response.emittedEvents ?? []));\n");
            code.push_str(&close);
            code.push_str("  return fired;\n");
            code.push_str("}\n\n");
        }
        code
    }

    /// `mounts.ts` (the mount registry) and `ticks.ts` (one scheduler per server tick); empty when no tick runs server-side.
    pub(crate) fn generate_server_ticks_modules(&self, module: &OirModule) -> Vec<InternalFile> {
        if !module_has_server_ticks(module) {
            return Vec::new();
        }
        let mut imports = String::new();
        let mut schedules = String::new();
        for trait_def in &module.traits {
            let ticks = server_ticks(trait_def, module);
            if ticks.is_empty() {
                continue;
            }
            let folder = to_kebab_case(&trait_def.name);
            let names: Vec<String> = ticks
                .iter()
                .map(|t| {
                    format!(
                        "{} as {}_{}",
                        tick_fn_name(t),
                        trait_def.name,
                        tick_fn_name(t)
                    )
                })
                .collect();
            imports.push_str(&format!(
                "import {{ {} }} from './routes/features/{}/handlers.js';\n",
                names.join(", "),
                folder
            ));
            for tick in ticks {
                let call = format!(
                    "void fire({{ orbital: '{}', trait: '{}' }}, {}, {}_{})",
                    trait_def.orbital_name,
                    trait_def.name,
                    tick.background,
                    trait_def.name,
                    tick_fn_name(tick)
                );
                match cadence(&tick.interval) {
                    ServerTickCadence::EveryMs(ms) => {
                        schedules.push_str(&format!(
                            "  timers.push(setInterval(() => {call}, {ms}));\n"
                        ));
                    }
                    ServerTickCadence::Cron(expression) => {
                        schedules.push_str(&format!(
                            "  timers.push(cronTimer({}, () => {call}));\n",
                            serde_json::to_string(&expression)
                                .unwrap_or_else(|_| "\"\"".to_string())
                        ));
                    }
                }
            }
        }

        let mut code = String::new();
        code.push_str("/**\n * GENERATED — server trait ticks (Runtime Spec Clause 8).\n *\n");
        code.push_str(
            " * A tick runs only while at least one tab has its trait mounted (a lifecycle\n",
        );
        code.push_str(
            " * event records the mount, `$UNMOUNT` or a closed SSE connection releases it),\n",
        );
        code.push_str(" * unless it is declared `[background]`.\n */\n\n");
        code.push_str("import type { EmittedEvent } from '@app/shared';\n");
        code.push_str("import { broadcastBusEvent } from './sse.js';\n");
        code.push_str("import { isTraitMounted } from './mounts.js';\n");
        code.push_str(&imports);
        code.push('\n');
        code.push_str("async function fire(\n  source: { orbital: string; trait: string },\n  background: boolean,\n  run: (now: number) => Promise<EmittedEvent[]>,\n): Promise<void> {\n");
        code.push_str("  if (!background && !isTraitMounted(source.trait)) return;\n");
        code.push_str("  const now = Date.now();\n");
        code.push_str("  try {\n");
        code.push_str("    for (const e of await run(now)) {\n");
        code.push_str("      broadcastBusEvent(undefined, { type: 'bus', event: e.event, payload: e.payload, source, timestamp: now });\n");
        code.push_str("    }\n");
        code.push_str("  } catch (error) {\n");
        code.push_str("    console.error(`[ticks] ${source.trait} tick failed:`, error instanceof Error ? error.message : String(error));\n");
        code.push_str("  }\n");
        code.push_str("}\n\n");
        code.push_str("/** Fires `run` once per matching minute of a 5-field cron expression, checked every second. */\n");
        code.push_str("function cronTimer(expression: string, run: () => void): ReturnType<typeof setInterval> {\n");
        code.push_str(
            "  const [minute, hour, day, month, weekday] = expression.trim().split(/\\s+/);\n",
        );
        code.push_str(
            "  const matches = (field: string | undefined, value: number): boolean => {\n",
        );
        code.push_str("    if (field === undefined || field === '*') return true;\n");
        code.push_str("    return field.split(',').some((part) => {\n");
        code.push_str("      const [range, stepText] = part.split('/');\n");
        code.push_str("      const step = stepText === undefined ? 1 : Number(stepText);\n");
        code.push_str("      const [lo, hi] = range === '*' || range === undefined ? [0, Number.MAX_SAFE_INTEGER] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];\n");
        code.push_str("      return value >= (lo ?? 0) && value <= (hi ?? lo ?? 0) && (value - (lo ?? 0)) % step === 0;\n");
        code.push_str("    });\n");
        code.push_str("  };\n");
        code.push_str("  let lastMinuteKey = -1;\n");
        code.push_str("  return setInterval(() => {\n");
        code.push_str("    const at = new Date();\n");
        code.push_str("    const key = Math.floor(at.getTime() / 60000);\n");
        code.push_str("    if (key === lastMinuteKey) return;\n");
        code.push_str("    if (matches(minute, at.getMinutes()) && matches(hour, at.getHours()) && matches(day, at.getDate()) && matches(month, at.getMonth() + 1) && matches(weekday, at.getDay())) {\n");
        code.push_str("      lastMinuteKey = key;\n");
        code.push_str("      run();\n");
        code.push_str("    }\n");
        code.push_str("  }, 1000);\n");
        code.push_str("}\n\n");
        code.push_str("const timers: Array<ReturnType<typeof setInterval>> = [];\n\n");
        code.push_str("export function startTicks(): void {\n");
        code.push_str(&schedules);
        code.push_str("}\n\n");
        code.push_str("export function stopTicks(): void {\n");
        code.push_str("  for (const t of timers.splice(0)) clearInterval(t);\n");
        code.push_str("}\n");

        let mut mounts = String::new();
        mounts.push_str("/**\n * GENERATED — which tabs have each trait mounted (Runtime Spec Clause 8.3).\n * A lifecycle event records a mount; `$UNMOUNT` or a tab's last SSE close releases it.\n */\n");
        mounts.push_str("\nconst ANONYMOUS_CLIENT = '\\u0000anonymous';\n");
        mounts.push_str("const mountedBy = new Map<string, Set<string>>();\n\n");
        mounts.push_str("export function recordMount(traitName: string, clientId: string | undefined, mounted: boolean): void {\n");
        mounts.push_str("  const clients = mountedBy.get(traitName) ?? new Set<string>();\n");
        mounts.push_str("  if (mounted) clients.add(clientId ?? ANONYMOUS_CLIENT);\n");
        mounts.push_str("  else clients.delete(clientId ?? ANONYMOUS_CLIENT);\n");
        mounts.push_str("  if (clients.size > 0) mountedBy.set(traitName, clients);\n");
        mounts.push_str("  else mountedBy.delete(traitName);\n");
        mounts.push_str("}\n\n");
        mounts.push_str("export function releaseClient(clientId: string): void {\n");
        mounts.push_str("  for (const [traitName, clients] of mountedBy) {\n");
        mounts.push_str("    clients.delete(clientId);\n");
        mounts.push_str("    if (clients.size === 0) mountedBy.delete(traitName);\n");
        mounts.push_str("  }\n");
        mounts.push_str("}\n\n");
        mounts.push_str("export function isTraitMounted(traitName: string): boolean {\n");
        mounts.push_str("  return (mountedBy.get(traitName)?.size ?? 0) > 0;\n");
        mounts.push_str("}\n\n");

        vec![
            InternalFile::new(
                "packages/server/src/mounts.ts",
                mounts,
                GeneratedFileType::Route,
            ),
            InternalFile::new(
                "packages/server/src/ticks.ts",
                code,
                GeneratedFileType::Route,
            ),
        ]
    }
}
