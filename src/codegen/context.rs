//! `CodegenContext` — the shared code-generation context carried by both the
//! OirExpr emitter (`expr.rs`/`operator.rs`) and the legacy SExpression
//! emitter (`sexpr_to_ts/`). Lives here (not under `sexpr_to_ts/`) so it
//! survives the eventual deletion of the legacy emission tree.

use orbital_core_base::ir::{OirEntity, OirType};
use std::collections::HashMap;

/// Context for code generation
#[derive(Debug, Clone, Default)]
pub struct CodegenContext {
    /// The trait's linked entity name (e.g. `"Article"`) — used to resolve
    /// `@entity` and `@entity.<field>` source types when inferring lambda
    /// element types.
    pub linked_entity_name: Option<String>,
    /// The narrowed payload schema for the current event/transition (field
    /// name → OirType). Used to resolve `@payload.<field>` source types.
    pub current_payload_schema: Option<orbital_core_base::ir::OirTypeMap>,
    /// The trait's declared config knob types, so `@config.<knob>` sources infer like payloads.
    pub current_config_schema: Option<orbital_core_base::ir::OirTypeMap>,
    /// All entities keyed by name. Used to resolve `@<EntityName>`,
    /// `Reference { entity }`, and the linked entity's field types when
    /// inferring lambda element types.
    pub entity_catalog: HashMap<String, OirEntity>,
}

impl CodegenContext {





    /// Render an `OirType` to its emitted TypeScript form (INFERRED position:
    /// lambda-param / array-element types). Thin wrapper over the canonical
    /// `map_type_ts`; resolves `Reference { entity }` against the catalog and
    /// widens an unknown reference / `Json` to `EntityRow`. Struct/enum fields
    /// now recurse to their real shape (they used to collapse to
    /// `EntityRow`/`string` here — CG-SWEEP-1 Category 3).
    pub fn oirtype_to_ts(&self, ty: &OirType, enum_values: Option<&Vec<String>>) -> String {
        crate::backend::map_type_ts(
            ty,
            enum_values,
            Some(&self.entity_catalog),
            crate::backend::TsTypeMode::Inferred,
        )
    }
}
