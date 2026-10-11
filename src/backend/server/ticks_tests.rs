// Compiled server ticks (Runtime Spec Clause 8.3): mount-scoped unless `[background]`, on Express and Hono.
use crate::backend::*;
use orbital_core::ir::{OirBinding, OirField, OirInterval, OirState, OirTick};

fn entity(name: &str, persistence: OirPersistence) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: name.to_string(),
        description: None,
        collection: format!("{}s", name.to_lowercase()),
        persistence,
        fields: vec![
            OirField::new("id", OirType::String),
            OirField::new("at", OirType::Number),
        ],
        defaults: None,
        instances: vec![],
        used_by_traits: vec![],
        used_by_pages: vec![],
        read_policy: None,
        create_policy: None,
        update_policy: None,
        delete_policy: None,
    }
}

fn tick(name: &str, interval: OirInterval, background: bool) -> OirTick {
    let mut t = OirTick::new(name, interval);
    t.background = background;
    t.guard = Some(OirExpr::gt(
        OirExpr::binding(OirBinding::parse("@entity.at").unwrap()),
        OirExpr::number(0.0),
    ));
    t.effects.push(OirExpr::effect(OirEffect::set(
        OirBinding::parse("@entity.at").unwrap(),
        OirExpr::number(1.0),
    )));
    t
}

fn ticking_trait(name: &str, linked: Option<&str>, ticks: Vec<OirTick>) -> OirTrait {
    let mut t = OirTrait::new(name);
    t.orbital_name = "Board".to_string();
    t.linked_entity = linked.map(str::to_string);
    t.states.push(OirState::initial("idle"));
    t.transitions
        .push(OirTransition::new("idle", "idle", "INIT"));
    t.events.push(OirEvent::new("INIT"));
    t.ticks = ticks;
    t
}

fn module(persistence: OirPersistence, traits: Vec<OirTrait>) -> OirModule {
    let mut m = OirModule::new("TickApp", "0.1.0");
    m.entities.push(entity("Task", persistence));
    m.traits = traits;
    m
}

fn file<'a>(files: &'a [InternalFile], path: &str) -> &'a str {
    &files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("missing {path}"))
        .content
}

fn handler_files(t: &OirTrait, m: &OirModule) -> [(&'static str, String); 2] {
    let backend = TypeScriptBackend::new();
    [
        (
            "Express",
            backend
                .generate_trait_event_handler_file(t, m, "scan")
                .content,
        ),
        (
            "Hono",
            backend
                .generate_trait_event_handler_file_hono(t, m, "scan")
                .content,
        ),
    ]
}

#[test]
fn a_persisted_trait_records_mounts_and_answers_unmount_before_dispatch() {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![tick("sweep", OirInterval::Seconds { value: 1 }, false)],
    );
    let m = module(OirPersistence::Persistent, vec![t.clone()]);
    for (name, js) in handler_files(&t, &m) {
        assert!(
            js.contains("import { recordMount } from '../../../mounts.js';"),
            "{name}:\n{js}"
        );
        let unmount = js
            .find("if (event === '$UNMOUNT')")
            .unwrap_or_else(|| panic!("{name}: unmount arm:\n{js}"));
        let release = js.find("recordMount('Scan', clientId, false);").unwrap();
        let mount = js
            .find("if (event === 'INIT' || event === 'LOAD' || event === '$MOUNT') recordMount('Scan', clientId, true);")
            .unwrap_or_else(|| panic!("{name}: mount line:\n{js}"));
        let state = js.find("const state: ScanState").unwrap();
        assert!(
            unmount < release && release < mount && mount < state,
            "{name}: unmount answers before any dispatch:\n{js}"
        );
    }
}

#[test]
fn the_unmount_answer_is_a_no_transition_success_in_each_framework() {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![tick("sweep", OirInterval::Seconds { value: 1 }, false)],
    );
    let m = module(OirPersistence::Persistent, vec![t.clone()]);
    let [(_, express), (_, hono)] = handler_files(&t, &m);
    let no_op = "{ success: true, transitioned: false, states: {}, emittedEvents: [] }";
    // `runEvent` returns it; each framework's route sends what `runEvent` returns.
    assert!(express.contains(&format!("return {no_op};")), "{express}");
    assert!(hono.contains(&format!("return {no_op};")), "{hono}");
}

#[test]
fn each_tick_is_one_exported_firing_that_runs_its_guard_per_row() {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![
            tick("sweep", OirInterval::Seconds { value: 1 }, false),
            tick("purge_old", OirInterval::Minutes { value: 5 }, true),
        ],
    );
    let m = module(OirPersistence::Persistent, vec![t.clone()]);
    for (name, js) in handler_files(&t, &m) {
        for f in ["runTickSweep", "runTickPurgeOld"] {
            assert_eq!(
                js.matches(&format!(
                    "export async function {f}(now: number): Promise<EmittedEvent[]>"
                ))
                .count(),
                1,
                "{name}: {f}:\n{js}"
            );
        }
        let at = js.find("export async function runTickSweep").unwrap();
        let body = &js[at..];
        let rows = body
            .find("for (const __tickRow of await getDataService().list<Task>('tasks'))")
            .unwrap_or_else(|| panic!("{name}: row loop:\n{body}"));
        let guard = body
            .find("if ((+(entity?.at ?? 0) > 0))")
            .unwrap_or_else(|| panic!("{name}: guard:\n{body}"));
        assert!(
            rows < guard,
            "{name}: the guard runs inside the row loop:\n{body}"
        );
        assert!(
            body.contains("fired.push(...(response.emittedEvents ?? []));"),
            "{name}:\n{body}"
        );
    }
}

#[test]
fn an_unlinked_trait_fires_once_without_a_row() {
    let t = ticking_trait(
        "Heartbeat",
        None,
        vec![tick("beat", OirInterval::Seconds { value: 1 }, false)],
    );
    let m = module(OirPersistence::Persistent, vec![t.clone()]);
    for (name, js) in handler_files(&t, &m) {
        let body = &js[js.find("export async function runTickBeat").unwrap()..];
        assert!(!body.contains("__tickRow"), "{name}: no row loop:\n{body}");
        assert!(
            body.contains("const entityId: string | undefined = undefined;"),
            "{name}:\n{body}"
        );
    }
}

#[test]
fn a_runtime_entity_ticks_on_the_client_so_the_server_emits_nothing() {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![tick("sweep", OirInterval::Seconds { value: 1 }, false)],
    );
    let m = module(OirPersistence::Runtime, vec![t.clone()]);
    for (name, js) in handler_files(&t, &m) {
        assert!(
            !js.contains("recordMount") && !js.contains("runTick"),
            "{name}:\n{js}"
        );
    }
    assert!(TypeScriptBackend::new()
        .generate_server_ticks_modules(&m)
        .is_empty());
}

#[test]
fn a_tickless_module_gets_no_tick_files_or_mount_lines() {
    let mut t = ticking_trait("Scan", Some("Task"), vec![]);
    t.ticks.clear();
    let m = module(OirPersistence::Persistent, vec![t.clone()]);
    assert!(TypeScriptBackend::new()
        .generate_server_ticks_modules(&m)
        .is_empty());
    for (name, js) in handler_files(&t, &m) {
        assert!(
            !js.contains("recordMount") && !js.contains("$UNMOUNT"),
            "{name}:\n{js}"
        );
    }
}

#[test]
fn the_scheduler_passes_each_ticks_background_flag_and_cadence() {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![
            tick("sweep", OirInterval::Seconds { value: 2 }, false),
            tick("audit", OirInterval::Milliseconds { value: 250 }, true),
            tick("frame", OirInterval::Frame, false),
            tick("nightly", OirInterval::Cron("0 3 * * *".to_string()), true),
        ],
    );
    let m = module(OirPersistence::Persistent, vec![t]);
    let files = TypeScriptBackend::new().generate_server_ticks_modules(&m);
    let ticks = file(&files, "packages/server/src/ticks.ts");
    for line in [
        "import { runTickSweep as Scan_runTickSweep, runTickAudit as Scan_runTickAudit, runTickFrame as Scan_runTickFrame, runTickNightly as Scan_runTickNightly } from './routes/features/scan/handlers.js';",
        "timers.push(setInterval(() => void fire({ orbital: 'Board', trait: 'Scan' }, false, Scan_runTickSweep), 2000));",
        "timers.push(setInterval(() => void fire({ orbital: 'Board', trait: 'Scan' }, true, Scan_runTickAudit), 250));",
        "timers.push(setInterval(() => void fire({ orbital: 'Board', trait: 'Scan' }, false, Scan_runTickFrame), 16));",
        "timers.push(cronTimer(\"0 3 * * *\", () => void fire({ orbital: 'Board', trait: 'Scan' }, true, Scan_runTickNightly)));",
        "if (!background && !isTraitMounted(source.trait)) return;",
    ] {
        assert!(ticks.contains(line), "missing `{line}`:\n{ticks}");
    }
}

#[test]
fn routes_start_and_sse_releases_only_when_the_server_ticks() {
    let backend = TypeScriptBackend::new();
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![tick("sweep", OirInterval::Seconds { value: 1 }, false)],
    );
    let entities = vec![entity("Task", OirPersistence::Persistent)];
    for server_ticks in [true, false] {
        let routes = [
            backend
                .generate_event_routes_registration(std::slice::from_ref(&t), server_ticks)
                .content,
            backend
                .generate_event_routes_registration_hono(std::slice::from_ref(&t), server_ticks)
                .content,
        ];
        let sse = [
            backend.generate_sse_module(&entities, server_ticks).content,
            backend
                .generate_sse_module_hono(&entities, server_ticks)
                .content,
        ];
        for js in &routes {
            assert_eq!(js.contains("startTicks();"), server_ticks, "{js}");
        }
        for js in &sse {
            assert_eq!(js.contains("releaseClient(clientId)"), server_ticks, "{js}");
        }
    }
}

fn run_mounts(script: &str) -> String {
    let t = ticking_trait(
        "Scan",
        Some("Task"),
        vec![tick("sweep", OirInterval::Seconds { value: 1 }, false)],
    );
    let files = TypeScriptBackend::new()
        .generate_server_ticks_modules(&module(OirPersistence::Persistent, vec![t]));
    let dir = std::env::temp_dir().join(format!(
        "orb-mounts-{}-{}",
        std::process::id(),
        script.len()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("mounts.ts"),
        file(&files, "packages/server/src/mounts.ts"),
    )
    .unwrap();
    std::fs::write(dir.join("probe.ts"), format!("import {{ recordMount, releaseClient, isTraitMounted }} from './mounts.ts';\nconst out: boolean[] = [];\n{script}\nprocess.stdout.write(JSON.stringify(out));\n")).unwrap();
    let out = std::process::Command::new("node")
        .arg(dir.join("probe.ts"))
        .output()
        .expect("node must be on PATH to run the emitted mount registry");
    std::fs::remove_dir_all(&dir).ok();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn the_mount_registry_counts_distinct_tabs() {
    let seen = run_mounts(
        "recordMount('Scan', 'a', true); recordMount('Scan', 'b', true); recordMount('Scan', 'a', false); out.push(isTraitMounted('Scan'));\n\
         recordMount('Scan', 'b', false); out.push(isTraitMounted('Scan'));\n\
         recordMount('Scan', 'a', true); recordMount('Scan', 'a', true); recordMount('Scan', 'a', false); out.push(isTraitMounted('Scan'));\n\
         recordMount('Scan', 'z', false); out.push(isTraitMounted('Scan'));",
    );
    assert_eq!(seen, "[true,false,false,false]");
}

#[test]
fn a_closed_tab_releases_every_trait_it_mounted_and_nothing_else() {
    let seen = run_mounts(
        "recordMount('Scan', 'a', true); recordMount('Feed', 'a', true); recordMount('Feed', 'b', true);\n\
         releaseClient('a'); out.push(isTraitMounted('Scan'), isTraitMounted('Feed'));\n\
         recordMount('Scan', undefined, true); releaseClient('a'); out.push(isTraitMounted('Scan'));\n\
         recordMount('Scan', undefined, false); out.push(isTraitMounted('Scan'));",
    );
    assert_eq!(seen, "[false,true,true,false]");
}

#[test]
fn both_backends_import_only_local_entity_types_aliasing_collisions() {
    let mut t = ticking_trait("Scan", Some("Task"), vec![]);
    let mut load = OirTransition::new("idle", "idle", "LOAD");
    for ty in ["@entity(targetEntity)", "Ghost", "Response"] {
        load.effects.push(OirExpr::effect(OirEffect::Fetch {
            entity_type: ty.to_string(),
            id: None,
            filter: None,
            order_by: None,
            limit: None,
            offset: None,
            include: None,
            emit: None,
        }));
    }
    t.transitions.push(load);
    t.events.push(OirEvent::new("LOAD"));
    let mut m = module(OirPersistence::Persistent, vec![t.clone()]);
    m.entities
        .push(entity("Response", OirPersistence::Persistent));
    for (name, js) in handler_files(&t, &m) {
        assert!(
            js.contains("import type { Response as ResponseEntity, Task } from '@app/shared';"),
            "{name}:\n{js}"
        );
        for line in js.lines().filter(|l| l.starts_with("import")) {
            assert!(
                !line.contains("@entity(") && !line.contains("Ghost"),
                "{name}: non-local names are never imported: {line}"
            );
        }
    }
}
