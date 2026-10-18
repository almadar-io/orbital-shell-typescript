//! Where a tick runs.

use crate::backend::*;
use orbital_core_base::ir::OirTick;

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
