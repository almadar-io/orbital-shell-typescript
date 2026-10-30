//! The kernel as a native Node add-on. Every export is the `orbital-wasm` host API (`orbital_wasm::api`)
//! under the name the wasm module gives it, so a host loads either one behind the same ports. Marshalling only: every
//! decision is `orbital_core::embed`'s.

use napi::bindgen_prelude::Error;
use napi::Env;
use napi_derive::napi;
use orbital_wasm::api;
use orbital_wasm::stored::{ServerHandle, Slot};

fn js(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

fn flight_id(flight: f64) -> napi::Result<u64> {
    if flight.is_finite()
        && flight >= 0.0
        && flight.fract() == 0.0
        && flight <= 9_007_199_254_740_991.0
    {
        Ok(flight as u64)
    } else {
        Err(js(format!("{flight} is not a flight id")))
    }
}

/// Lazy orbital files read from the folder the program was registered from: raw file reads, no decisions.
struct DirLazySource {
    dir: std::path::PathBuf,
}

impl orbital_wasm::LazySource for DirLazySource {
    fn read(&self, file: &str) -> Result<orbital_wasm::LazyProgram, String> {
        let path = self.dir.join(file);
        let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let schema: orbital_wasm::OrbitalSchema = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut catalogs = std::collections::HashMap::new();
        for locale in schema.locales.iter().flatten() {
            let sidecar = path.with_extension(format!("{locale}.json"));
            let raw = std::fs::read_to_string(&sidecar).map_err(|e| format!("{}: {e}", sidecar.display()))?;
            let catalog = serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", sidecar.display()))?;
            catalogs.insert(locale.clone(), catalog);
        }
        Ok(orbital_wasm::LazyProgram { schema, catalogs })
    }
}

/// The server role: `start` a request, answer the I/O it asks for, `resume` the flight until it is done.
#[napi]
pub struct Server {
    api: Slot<ServerHandle>,
}

#[napi]
impl Server {
    /// `lazy_dir`: the folder the program's `uses lazy` files sit beside; the kernel loads each on the first dispatch that
    /// reaches it (EXEC-LOAD-2). Absent, a lazy page is the client's to open.
    #[napi(constructor)]
    pub fn new(resolved_schema_json: String, lazy_dir: Option<String>) -> napi::Result<Self> {
        let handle = match lazy_dir {
            Some(dir) => ServerHandle::plain_lazy(&resolved_schema_json, std::sync::Arc::new(DirLazySource { dir: dir.into() })),
            None => ServerHandle::plain(&resolved_schema_json),
        };
        Ok(Self { api: Slot::new(handle.map_err(js)?) })
    }

    #[napi]
    pub fn free(&self) {
        self.api.take();
    }

    /// A server holding this one's registered program and none of its session.
    #[napi]
    pub fn fork(&self) -> napi::Result<Server> {
        Ok(Server {
            api: Slot::new(self.api.get().map_err(js)?.fork().map_err(js)?),
        })
    }

    #[napi]
    pub fn fork_program(&self, program_json: String) -> napi::Result<Server> {
        Ok(Server {
            api: Slot::new(
                self.api
                    .get()
                    .map_err(js)?
                    .fork_program(&program_json)
                    .map_err(js)?,
            ),
        })
    }

    #[napi]
    pub fn os_allows(&self, requirement_json: String) -> napi::Result<bool> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .os_allows(&requirement_json)
            .map_err(js)
    }

    #[napi]
    pub fn set_os_anchors(&self, anchors_json: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().set_os_anchors(&anchors_json).map_err(js)
    }

    #[napi]
    pub fn os_resolve_args(&self, op: String, args_json: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().os_resolve_args(&op, &args_json).map_err(js)
    }

    #[napi]
    pub fn tls_complete(&self, key: String, outcome_json: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().tls_complete(&key, &outcome_json).map_err(js)
    }

    #[napi]
    pub fn start(&self, orbital: String, request_json: String) -> napi::Result<String> {
        self.api
            .get()
            .map_err(js)?
            .start(&orbital, &request_json)
            .map_err(js)
    }

    #[napi]
    pub fn live_item_delivered(&self, item_json: String, viewer_json: String, client_id: Option<String>) -> napi::Result<bool> {
        self.api.get().map_err(js)?.api().live_item_delivered(&item_json, &viewer_json, client_id.as_deref()).map_err(js)
    }

    #[napi]
    pub fn dispatch_stream(&self) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().dispatch_stream().map_err(js)
    }

    #[napi]
    pub fn resume(&self, flight: f64, replies_json: String) -> napi::Result<String> {
        self.api
            .get()
            .map_err(js)?
            .resume(flight_id(flight)?, &replies_json)
            .map_err(js)
    }

    #[napi]
    pub fn next(&self) -> napi::Result<String> {
        self.api.get().map_err(js)?.next().map_err(js)
    }

    #[napi]
    pub fn holds_lane(&self, flight: f64) -> napi::Result<bool> {
        Ok(self.api.get().map_err(js)?.holds_lane(flight_id(flight)?))
    }

    #[napi]
    pub fn open_session_stream(&self, client: String) -> napi::Result<f64> {
        Ok(self.api.get().map_err(js)?.open_session_stream(&client) as f64)
    }

    #[napi]
    pub fn close_session_stream(&self, id: f64) -> napi::Result<bool> {
        Ok(self.api.get().map_err(js)?.close_session_stream(flight_id(id)?))
    }

    #[napi]
    pub fn resolve_rows(&self, ref_json: String, viewer_json: String) -> napi::Result<String> {
        self.api
            .get()
            .map_err(js)?
            .resolve_rows(&ref_json, &viewer_json)
            .map_err(js)
    }

    #[napi]
    pub fn resume_resolve(&self, flight: f64, replies_json: String) -> napi::Result<String> {
        self.api
            .get()
            .map_err(js)?
            .resume_resolve(flight_id(flight)?, &replies_json)
            .map_err(js)
    }

    #[napi]
    pub fn abandon(&self, flight: f64) -> napi::Result<bool> {
        Ok(self.api.get().map_err(js)?.abandon(flight_id(flight)?))
    }

    #[napi]
    pub fn in_flight(&self) -> napi::Result<u32> {
        Ok(self.api.get().map_err(js)?.api().in_flight() as u32)
    }

    #[napi]
    pub fn get_state(&self, trait_name: String, entity_id: Option<String>) -> napi::Result<String> {
        Ok(self
            .api
            .get()
            .map_err(js)?
            .api()
            .get_state(&trait_name, entity_id.as_deref()))
    }

    #[napi]
    pub fn set_managed_program(&self, program_json: String) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .set_managed_program(&program_json)
            .map_err(js)
    }

    #[napi]
    pub fn set_default_user(&self, user_json: String) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .set_default_user(&user_json)
            .map_err(js)
    }

    #[napi]
    pub fn mount(&self, traits_json: String) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .mount(&traits_json)
            .map_err(js)
    }

    #[napi]
    pub fn boot_mounts(&self, side: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().boot_mounts(&side).map_err(js)
    }

    #[napi]
    pub fn route_mounts(&self, route_path: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().route_mounts(&route_path).map_err(js)
    }

    /// One question about the registered program (a `ContractQuery` as JSON): its answer as JSON.
    #[napi]
    pub fn contract_query(&self, query_json: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().contract_query(&query_json).map_err(js)
    }

    #[napi]
    pub fn remount(&self, traits_json: String) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .remount(&traits_json)
            .map_err(js)
    }

    #[napi]
    pub fn set_messages(&self, locales_json: String, catalogs_json: String) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .set_messages(&locales_json, &catalogs_json)
            .map_err(js)
    }

    #[napi]
    pub fn set_capabilities(
        &self,
        entity_type: String,
        query_json: String,
        write_json: String,
    ) -> napi::Result<()> {
        self.api
            .get()
            .map_err(js)?
            .api()
            .set_capabilities(&entity_type, &query_json, &write_json)
            .map_err(js)
    }

    #[napi]
    pub fn mount_client(&self, client: String, orbital: String, traits_json: String) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().mount_client(&client, &orbital, &traits_json).map_err(js)
    }

    #[napi]
    pub fn unmount_client(&self, client: String, orbital: String, traits_json: String) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().unmount_client(&client, &orbital, &traits_json).map_err(js)
    }

    #[napi]
    pub fn release_client(&self, client: String) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().release_client(&client);
        Ok(())
    }

    #[napi]
    pub fn relay_tick(&self, orbital: String, request_json: String) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().relay_tick(&orbital, &request_json).map_err(js)
    }

    #[napi]
    pub fn set_tick_relay_interval(&self, interval_ms: f64) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().set_tick_relay_interval(interval_ms.max(0.0) as u64);
        Ok(())
    }

    #[napi]
    pub fn flush_tick_relay(&self) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().flush_tick_relay().map_err(js)
    }

    #[napi]
    pub fn set_stateful(&self, stateful: bool) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().set_stateful(stateful);
        Ok(())
    }

    #[napi]
    pub fn declares_ticks(&self) -> napi::Result<bool> {
        Ok(self.api.get().map_err(js)?.api().declares_ticks())
    }

    #[napi]
    pub fn tick_pass(&self, now_ms: f64) -> napi::Result<String> {
        self.api.get().map_err(js)?.api().tick_pass(now_ms.max(0.0) as u64).map_err(js)
    }

    #[napi]
    pub fn tick_pause(&self) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().tick_pause();
        Ok(())
    }

    #[napi]
    pub fn tick_resume(&self) -> napi::Result<()> {
        self.api.get().map_err(js)?.api().tick_resume();
        Ok(())
    }

    #[napi]
    pub fn tick_paused(&self) -> napi::Result<bool> {
        Ok(self.api.get().map_err(js)?.api().tick_paused())
    }

    #[napi]
    pub fn last_error(&self) -> napi::Result<String> {
        Ok(self.api.get().map_err(js)?.api().last_error())
    }
}

#[napi]
pub fn install_language(bundle_json: String) -> napi::Result<()> {
    api::install_language(&bundle_json).map_err(js)
}

#[napi]
pub fn os_glob_matches(glob: String, path: String) -> bool {
    api::os_glob_matches(&glob, &path)
}

/// The typed event request a `program/dispatch` call names, as an object; a record that is no event request throws the reason.
#[napi(ts_return_type = "EventRequest")]
pub fn parse_event_request(env: Env, payload_json: String, options_json: String) -> napi::Result<napi::JsUnknown> {
    let request = api::parse_event_request(&payload_json, &options_json).map_err(js)?;
    let json: napi::JsObject = env.get_global()?.get_named_property("JSON")?;
    let parse: napi::JsFunction = json.get_named_property("parse")?;
    parse.call(Some(&json), &[env.create_string(&request)?])
}

/// The program's emitter-to-listener wire table (`EventWire[]` as JSON), by the source rule the kernel delivers by.
#[napi]
pub fn event_wires(schema_json: String) -> napi::Result<String> {
    api::event_wires(&schema_json).map_err(js)
}

#[napi]
pub fn tab_url_matches(pattern: String, url: String) -> bool {
    api::tab_url_matches(&pattern, &url)
}

#[napi]
pub fn os_deferring_ops() -> napi::Result<String> {
    api::os_deferring_ops().map_err(js)
}

#[napi]
pub fn os_stream_ops() -> napi::Result<String> {
    api::os_stream_ops().map_err(js)
}

#[napi]
pub fn os_completion_event(
    site_json: String,
    key: String,
    outcome_json: String,
) -> napi::Result<String> {
    api::os_completion_event(&site_json, &key, &outcome_json).map_err(js)
}

#[napi]
pub fn evaluate_many(context_json: String, expressions_json: String) -> napi::Result<String> {
    api::evaluate_many(&context_json, &expressions_json).map_err(js)
}

#[napi]
pub fn resolve_values(context_json: String, values_json: String) -> napi::Result<String> {
    api::resolve_values(&context_json, &values_json).map_err(js)
}

#[napi]
pub fn evaluate_guards(context_json: String, guards_json: String) -> napi::Result<String> {
    api::evaluate_guards(&context_json, &guards_json).map_err(js)
}

#[napi]
pub fn evaluate_traced(context_json: String, expression_json: String) -> napi::Result<String> {
    api::evaluate_traced(&context_json, &expression_json).map_err(js)
}

#[napi]
pub fn trace_effects(context_json: String, effects_json: String) -> napi::Result<String> {
    api::trace_effects(&context_json, &effects_json).map_err(js)
}

#[napi]
pub fn map_listen_payload(mapping_json: String, payload_json: String) -> napi::Result<String> {
    api::map_listen_payload(&mapping_json, &payload_json).map_err(js)
}

#[napi]
pub fn scope_rows(
    bindings_json: String,
    rows_json: String,
    policy_json: String,
    filter_json: String,
    entity_type: String,
) -> napi::Result<String> {
    api::scope_rows(
        &bindings_json,
        &rows_json,
        &policy_json,
        &filter_json,
        &entity_type,
    )
    .map_err(js)
}

#[napi]
pub fn check_mutation_access(
    operation: String,
    bindings_json: String,
    row_json: String,
    policy_json: String,
    entity_type: String,
) -> napi::Result<String> {
    api::check_mutation_access(
        &operation,
        &bindings_json,
        &row_json,
        &policy_json,
        &entity_type,
    )
    .map_err(js)
}

#[napi]
pub fn resolve_row_binding(term: String, bindings_json: String) -> napi::Result<String> {
    api::resolve_row_binding(&term, &bindings_json).map_err(js)
}

#[napi]
pub fn substrate_completion_event(site_json: String, key: String, op: String, args_json: String, outcome_json: String) -> napi::Result<String> {
    api::substrate_completion_event(&site_json, &key, &op, &args_json, &outcome_json).map_err(js)
}

use orbital_wasm::MemoryStoreApi;

#[derive(Default)]
#[napi]
pub struct MemoryStore {
    api: MemoryStoreApi,
}

#[napi]
impl MemoryStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            api: MemoryStoreApi::new(),
        }
    }
    #[napi]
    pub fn get_by_id(&self, entity_type: String, id: String) -> Result<String, Error> {
        self.api.get_by_id(&entity_type, &id).map_err(js)
    }
    #[napi]
    pub fn list(&self, entity_type: String) -> Result<String, Error> {
        self.api.list(&entity_type).map_err(js)
    }
    #[napi]
    pub fn create(&self, entity_type: String, data_json: String) -> Result<String, Error> {
        self.api.create(&entity_type, &data_json).map_err(js)
    }
    #[napi]
    pub fn update(
        &self,
        entity_type: String,
        id: String,
        data_json: String,
    ) -> Result<String, Error> {
        self.api.update(&entity_type, &id, &data_json).map_err(js)
    }
    #[napi]
    pub fn delete(&self, entity_type: String, id: String) -> Result<(), Error> {
        self.api.delete(&entity_type, &id).map_err(js)
    }
    #[napi]
    pub fn query_page(&self, entity_type: String, query_json: String) -> Result<String, Error> {
        self.api.query_page(&entity_type, &query_json).map_err(js)
    }
    #[napi]
    pub fn query_ids(&self, entity_type: String, query_json: String) -> Result<String, Error> {
        self.api.query_ids(&entity_type, &query_json).map_err(js)
    }
    #[napi]
    pub fn write_where(&self, op_json: String) -> Result<String, Error> {
        self.api.write_where(&op_json).map_err(js)
    }
    #[napi]
    pub fn write_batch(&self, batch_json: String) -> Result<String, Error> {
        self.api.write_batch(&batch_json).map_err(js)
    }
    #[napi]
    pub fn query_capabilities(&self) -> Result<String, Error> {
        self.api.query_capabilities().map_err(js)
    }
    #[napi]
    pub fn write_capabilities(&self) -> Result<String, Error> {
        self.api.write_capabilities().map_err(js)
    }
    #[napi]
    pub fn snapshot(&self) -> Result<String, Error> {
        self.api.snapshot().map_err(js)
    }
    #[napi]
    pub fn bind_collection(&self, entity_type: String, collection: String) {
        self.api.bind_collection(&entity_type, &collection);
    }
    #[napi]
    pub fn clear(&self) {
        self.api.clear();
    }
}
