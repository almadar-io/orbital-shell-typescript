//! Expression-mode effect lowering (`effect_to_ts`) and the direct
//! S-expression → TypeScript entry points.

use super::*;

impl TypeScriptBackend {
    /// V4 leverage-ids: resolve a NON-linked entity token embedded in a client
    /// effect descriptor (`persist`/`fetch`/`ref`/`deref`/`swap`/`watch`/
    /// `fetch-stream`/`spawn`) to its CURRENT display name via the trait's
    /// `entity_ref_ids` side-map (token → id) + the module `entity_catalog`
    /// (id → entity). `@entity` and any token absent from the side-map pass
    /// through unchanged — byte-identical to the pre-flip name path.
    fn resolve_entity_descriptor_name(&self, entity_type: &str) -> String {
        if let Some(id) = self
            .current_entity_ref_ids
            .borrow()
            .as_ref()
            .and_then(|m| m.get(entity_type))
        {
            if let Some(name) = self
                .entity_catalog
                .borrow()
                .values()
                .find(|e| e.id.as_deref() == Some(id.as_str()))
                .map(|e| e.name.clone())
            {
                return name;
            }
        }
        entity_type.to_string()
    }

    pub(crate) fn effect_to_ts(&self, effect: &OirEffect) -> String {
        match effect {
            OirEffect::Set { target, value, .. } => {
                format!(
                    "{{ type: 'set', target: '{}', value: {} }}",
                    self.binding_to_ts(target),
                    self.expr_to_ts(value)
                )
            }
            OirEffect::SetDynamic { target, value, .. } => {
                format!(
                    "{{ type: 'set-dynamic', target: {}, value: {} }}",
                    self.expr_to_ts(target),
                    self.expr_to_ts(value)
                )
            }
            OirEffect::Emit { event, payload } => {
                if let Some(p) = payload {
                    format!(
                        "{{ type: 'emit', event: '{}', payload: {} }}",
                        event,
                        self.expr_to_ts(p)
                    )
                } else {
                    format!("{{ type: 'emit', event: '{}' }}", event)
                }
            }
            OirEffect::PersistBatch { ops, .. } => format!(
                "{{ type: 'persist', operation: 'batch', data: {} }}",
                self.expr_to_ts(ops)
            ),
            OirEffect::Persist {
                operation,
                entity_type,
                data,
                ..
            } => {
                let op = match operation {
                    OirPersistOp::Create => "create",
                    OirPersistOp::Upsert => "upsert",
                    OirPersistOp::Read => "read",
                    OirPersistOp::Update => "update",
                    OirPersistOp::Delete => "delete",
                    OirPersistOp::List => "list",
                    OirPersistOp::Query => "query",
                };
                format!(
                    "{{ type: 'persist', operation: '{}', entity: '{}', data: {} }}",
                    op,
                    self.resolve_entity_descriptor_name(entity_type),
                    self.expr_to_ts(data)
                )
            }
            OirEffect::NavigateBack => "{ type: 'navigate-back' }".to_string(),
            OirEffect::Navigate { path, params, .. } => {
                let path_ts = self.expr_to_ts(path);
                if let Some(p) = params {
                    format!(
                        "{{ type: 'navigate', path: {}, params: {} }}",
                        path_ts,
                        self.expr_to_ts(p)
                    )
                } else {
                    format!("{{ type: 'navigate', path: {} }}", path_ts)
                }
            }
            OirEffect::RenderUi { slot, pattern } => {
                format!(
                    "{{ type: 'render-ui', slot: '{}', pattern: '{}' }}",
                    slot, pattern.pattern_type
                )
            }
            OirEffect::Log { level, message } => {
                let level_str = match level {
                    OirLogLevel::Trace => "trace",
                    OirLogLevel::Debug => "debug",
                    OirLogLevel::Info => "info",
                    OirLogLevel::Warn => "warn",
                    OirLogLevel::Error => "error",
                };
                format!(
                    "{{ type: 'log', level: '{}', message: {} }}",
                    level_str,
                    self.expr_to_ts(message)
                )
            }
            OirEffect::Fetch {
                entity_type,
                id,
                filter,
                ..
            } => {
                let entity = self.resolve_entity_descriptor_name(entity_type);
                if let Some(id_expr) = id {
                    format!(
                        "{{ type: 'fetch', entity: '{}', id: {} }}",
                        entity,
                        self.expr_to_ts(id_expr)
                    )
                } else if let Some(f) = filter {
                    format!(
                        "{{ type: 'fetch', entity: '{}', filter: {} }}",
                        entity,
                        self.expr_to_ts(f)
                    )
                } else {
                    format!("{{ type: 'fetch', entity: '{}' }}", entity)
                }
            }
            OirEffect::CallService {
                service,
                method,
                args,
                ..
            } => {
                format!(
                    "{{ type: 'call-service', service: '{}', method: '{}', args: {} }}",
                    service,
                    method,
                    self.expr_to_ts(args)
                )
            }
            OirEffect::Http {
                method,
                origin,
                path,
                request,
                ..
            } => {
                format!(
                    "{{ type: 'http', method: '{}', origin: {}, path: {}, request: {} }}",
                    format!("{:?}", method).to_uppercase(),
                    self.expr_to_ts(origin),
                    self.expr_to_ts(path),
                    request
                        .as_ref()
                        .map(|r| self.expr_to_ts(r))
                        .unwrap_or_else(|| "{}".to_string())
                )
            }
            OirEffect::CancelCall { key } => {
                format!("{{ type: 'cancel-call', key: {} }}", self.expr_to_ts(key))
            }
            OirEffect::RandomBytes { bytes, .. } => {
                format!("{{ type: 'random-bytes', bytes: {} }}", self.expr_to_ts(bytes))
            }
            OirEffect::CredentialStatus { credential, .. } => {
                format!("{{ type: 'credential-status', credential: {} }}", self.expr_to_ts(credential))
            }
            OirEffect::CredentialForget { credential, .. } => {
                format!("{{ type: 'credential-forget', credential: {} }}", self.expr_to_ts(credential))
            }
            OirEffect::Spawn { entity_type, props } => {
                format!(
                    "{{ type: 'spawn', entityType: '{}', props: {} }}",
                    self.resolve_entity_descriptor_name(entity_type),
                    self.expr_to_ts(props)
                )
            }
            OirEffect::Despawn { entity_id } => {
                format!(
                    "{{ type: 'despawn', entityId: {} }}",
                    self.expr_to_ts(entity_id)
                )
            }
            OirEffect::Custom { name, args, .. } => {
                if crate::codegen::operator_names::is_substrate_operator(name) {
                    if let Some(ts) = self.substrate_value_to_ts(name, args) {
                        return ts;
                    }
                }
                let ts_args: Vec<String> = args
                    .iter()
                    .map(|(k, v)| format!("\"{}\": {}", k, self.expr_to_ts(v)))
                    .collect();
                format!(
                    "{{ type: 'custom', name: '{}', args: {{ {} }} }}",
                    name,
                    ts_args.join(", ")
                )
            }
            OirEffect::OsWatchFiles { glob, .. } => {
                format!(
                    "{{ type: 'os/watch-files', glob: {} }}",
                    self.expr_to_ts(glob)
                )
            }
            OirEffect::OsWatchProcess { name, .. } => {
                format!(
                    "{{ type: 'os/watch-process', name: {} }}",
                    self.expr_to_ts(name)
                )
            }
            OirEffect::OsWatchPort { port, .. } => {
                format!(
                    "{{ type: 'os/watch-port', port: {} }}",
                    self.expr_to_ts(port)
                )
            }
            OirEffect::OsWatchHttp { url_pattern, .. } => {
                format!(
                    "{{ type: 'os/watch-http', urlPattern: {} }}",
                    self.expr_to_ts(url_pattern)
                )
            }
            OirEffect::OsWatchCron { expression, .. } => {
                format!(
                    "{{ type: 'os/watch-cron', expression: {} }}",
                    self.expr_to_ts(expression)
                )
            }
            OirEffect::OsWatchSignal { signal, .. } => {
                format!(
                    "{{ type: 'os/watch-signal', signal: {} }}",
                    self.expr_to_ts(signal)
                )
            }
            OirEffect::OsWatchEnv { variable, .. } => {
                format!(
                    "{{ type: 'os/watch-env', variable: {} }}",
                    self.expr_to_ts(variable)
                )
            }
            OirEffect::OsDebounce { ms, event_type } => {
                format!(
                    "{{ type: 'os/debounce', ms: {}, eventType: {} }}",
                    self.expr_to_ts(ms),
                    self.expr_to_ts(event_type)
                )
            }
            OirEffect::Ref { entity_type, .. } => {
                format!(
                    "{{ type: 'ref', entityType: '{}' }}",
                    self.resolve_entity_descriptor_name(entity_type)
                )
            }
            OirEffect::Deref { entity_type, .. } => {
                format!(
                    "{{ type: 'deref', entityType: '{}' }}",
                    self.resolve_entity_descriptor_name(entity_type)
                )
            }
            OirEffect::Swap {
                entity_type, id, ..
            } => {
                format!(
                    "{{ type: 'swap', entityType: '{}', id: {} }}",
                    self.resolve_entity_descriptor_name(entity_type),
                    self.expr_to_ts(id)
                )
            }
            OirEffect::Watch { entity_type, .. } => {
                format!(
                    "{{ type: 'watch', entityType: '{}' }}",
                    self.resolve_entity_descriptor_name(entity_type)
                )
            }
            OirEffect::Atomic { .. } => "{ type: 'atomic' }".to_string(),
            OirEffect::FetchStream {
                entity_type, id, ..
            } => {
                let entity = self.resolve_entity_descriptor_name(entity_type);
                if let Some(id_expr) = id {
                    format!(
                        "{{ type: 'fetch-stream', entity: '{}', id: {} }}",
                        entity,
                        self.expr_to_ts(id_expr)
                    )
                } else {
                    format!("{{ type: 'fetch-stream', entity: '{}' }}", entity)
                }
            }
            OirEffect::SendServer { event, payload } => {
                if let Some(p) = payload {
                    format!(
                        "{{ type: 'send-server', event: {}, payload: {} }}",
                        self.expr_to_ts(event),
                        self.expr_to_ts(p)
                    )
                } else {
                    format!(
                        "{{ type: 'send-server', event: {} }}",
                        self.expr_to_ts(event)
                    )
                }
            }
            OirEffect::BrowserOpenFilePicker { options, .. } => {
                if let Some(o) = options {
                    format!(
                        "{{ type: 'browser/open-file-picker', options: {} }}",
                        self.expr_to_ts(o)
                    )
                } else {
                    "{ type: 'browser/open-file-picker' }".to_string()
                }
            }
            OirEffect::BrowserClipboardRead { .. } => {
                "{ type: 'browser/clipboard-read' }".to_string()
            }
            OirEffect::BrowserPushSubscribe { .. } => {
                "{ type: 'browser/push-subscribe' }".to_string()
            }
            OirEffect::BrowserClipboardWrite { text, .. } => {
                format!(
                    "{{ type: 'browser/clipboard-write', text: {} }}",
                    self.expr_to_ts(text)
                )
            }
            OirEffect::BrowserGeolocationCurrent { options, .. } => {
                if let Some(o) = options {
                    format!(
                        "{{ type: 'browser/geolocation-current', options: {} }}",
                        self.expr_to_ts(o)
                    )
                } else {
                    "{ type: 'browser/geolocation-current' }".to_string()
                }
            }
        }
    }

    /// Build a `CodegenContext` snapshotted from the backend's trait /
    /// payload / catalog cells. Centralises the Phase E plumbing so
    /// every `compile_sexpr*` entry point picks up the same source-type
    /// inference inputs.
    pub(crate) fn build_codegen_ctx(
        &self,
        entity_var: Option<&str>,
        payload_var: Option<&str>,
        user_var: Option<&str>,
    ) -> crate::codegen::CodegenContext {
        use crate::codegen::CodegenContext;
        let catalog = self.entity_catalog.snapshot();
        let linked = self.current_linked_entity.snapshot();
        let payload_schema = self.current_payload_schema.snapshot();
        CodegenContext {
            entity_var: entity_var.map(|s| s.to_string()),
            payload_var: payload_var.map(|s| s.to_string()),
            user_var: user_var.map(|s| s.to_string()),
            entity_catalog: catalog,
            linked_entity_name: linked,
            current_payload_schema: payload_schema,
            ..Default::default()
        }
    }

    /// The substrate ops whose emission below calls `getLLMClient()` rather
    /// than the generic `getSubstrateService().invoke(...)` fallback. The
    /// handlers-file import detection MUST derive from this same truth — a
    /// prefix-based guess there imported `getLLMClient` for `llm/embed` while
    /// the emitted call was `getSubstrateService` (TS2304).
    pub(crate) fn substrate_op_uses_llm_client(name: &str) -> bool {
        matches!(
            name,
            "llm/generate" | "llm/call-tools" | "llm/token-count" | "llm/compact"
        )
    }

    /// The language trio's server effects, compiled to the shared program host
    /// (`@almadar/integrations/program` `runProgramEffect`) — the one truth both
    /// the handler-file import and the effect emission read.
    pub(crate) fn substrate_op_is_program_effect(name: &str) -> bool {
        orbital_core::language::registry::is_program_host_effect(name)
    }

    /// Compile a substrate operator used in VALUE position (inside `set`,
    /// `when`, etc.) to an inline TS expression. Returns `None` for
    /// operators that have no value-position mapping (they fall through to
    /// the generic `{ type: 'custom' }` object literal).
    pub(crate) fn substrate_value_to_ts(
        &self,
        name: &str,
        args: &orbital_core::ir::OirFields,
    ) -> Option<String> {
        let mut sorted: Vec<(&String, &OirExpr)> = args.iter().collect();
        sorted.sort_by(|a, b| a.0.cmp(b.0));
        let arg_ts: Vec<String> = sorted.iter().map(|(_, v)| self.expr_to_ts(v)).collect();
        let a = |i: usize| arg_ts.get(i).map(|s| s.as_str()).unwrap_or("undefined");

        let ts = match name {
            // `.lolo`'s `llm/generate` declares one positional arg (the
            // user prompt) — no operator surface for a system prompt.
            // `callRaw` requires `systemPrompt` (TS2345 without it); an
            // empty string is the honest "none configured" value, not a
            // stand-in for one the op never had.
            "llm/generate" => format!(
                "await getLLMClient().callRaw({{ systemPrompt: '', userPrompt: ({}) as string }})",
                a(0)
            ),
            // `.lolo`'s `llm/call-tools` declares two positional args
            // (`prompt: string`, `tools: array`) but `LLMClient.
            // callWithTools` takes ONE object argument: `{ messages:
            // ChatCompletionMessage[], tools: ChatCompletionToolDef[], … }`
            // — two positional args (the old shape here) is a TS2554 arity
            // mismatch. Wrap the declared `prompt` as the single user
            // message `callWithTools` expects; `tools` passes straight
            // through (contextually typed against the object literal's
            // `tools` field, matching `llm/generate`'s `userPrompt` cast
            // pattern immediately above for the string leg).
            "llm/call-tools" => format!(
                "await getLLMClient().callWithTools({{ messages: [{{ role: 'user', content: ({}) as string }}], tools: {} }})",
                a(0), a(1)
            ),
            "llm/token-count" => "(getLLMClient().getTokenCount?.() ?? 0)".to_string(),
            "llm/compact" => format!("await getLLMClient().compact({})", a(0)),
            "memory/recall" => format!(
                "(await getDataService().list('memories')).filter(m => (m.content ?? '').includes((({}) as string)))",
                a(0)
            ),
            "session/read-spec" => "await getSubstrateService().session.readSpec()".to_string(),
            "session/read-history" => "await getSubstrateService().session.readHistory()".to_string(),
            _ => {
                let args_arr: Vec<String> = (0..arg_ts.len())
                    .map(|i| a(i).to_string())
                    .collect();
                format!(
                    "await getSubstrateService().invoke('{}', [{}])",
                    name,
                    args_arr.join(", ")
                )
            }
        };
        Some(ts)
    }
}

#[cfg(test)]
mod substrate_value_tests {
    use super::*;
    use orbital_core::ir::OirExpr;

    /// C1-R2 item 3: `.lolo`'s `llm/call-tools` declares two positional args
    /// (`prompt: string`, `tools: array`) but `LLMClient.callWithTools` takes
    /// ONE object argument (`{ messages, tools, … }`) — the OLD emission
    /// (`callWithTools(a, b)`) is a TS2554 arity mismatch. Pin the honest
    /// shape: the prompt wraps into a single user message, `tools` forwards
    /// under the object's own key.
    #[test]
    fn call_tools_value_position_emits_one_object_arg_not_two_positional() {
        let backend = TypeScriptBackend::new();
        let mut args: orbital_core::ir::OirFields = orbital_core::ir::OirFields::new();
        args.insert(
            "prompt".to_string(),
            OirExpr::String {
                value: "What is 2+2?".to_string(),
            },
        );
        args.insert("tools".to_string(), OirExpr::Array { items: vec![] });

        let ts = backend
            .substrate_value_to_ts("llm/call-tools", &args)
            .expect("llm/call-tools has a value-position mapping");

        assert!(
            ts.contains("callWithTools({ messages: [{ role: 'user', content: "),
            "must pass ONE object arg wrapping the prompt as a user message, got: {ts}"
        );
        assert!(
            ts.contains("tools: "),
            "must forward the tools array under the object's own `tools` key, got: {ts}"
        );
        assert!(
            !ts.contains("callWithTools((") && !ts.contains("callWithTools(\""),
            "must never emit the old two-positional-arg shape, got: {ts}"
        );
    }
}
