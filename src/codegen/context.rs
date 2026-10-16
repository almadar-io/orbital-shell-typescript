//! `CodegenContext` — the shared code-generation context carried by both the
//! OirExpr emitter (`expr.rs`/`operator.rs`) and the legacy SExpression
//! emitter (`sexpr_to_ts/`). Lives here (not under `sexpr_to_ts/`) so it
//! survives the eventual deletion of the legacy emission tree.

use orbital_core_base::ir::{OirEntity, OirType};
use std::collections::HashMap;

/// Context for code generation
#[derive(Debug, Clone, Default)]
pub struct CodegenContext {
    /// Variable name to use for entity bindings
    pub entity_var: Option<String>,
    /// Variable name to use for payload bindings
    pub payload_var: Option<String>,
    /// Variable name to use for user bindings
    pub user_var: Option<String>,
    /// Track local variable names introduced by let bindings
    pub locals: HashMap<String, String>,
    /// Indentation level for generated code
    pub indent_level: usize,
    /// The expected TS type of the next lambda's element parameter. Set by
    /// array operators (`array/map`, `array/filter`, ...) when descending
    /// into their lambda arg, then read by `compile_lambda_or_expr` /
    /// `compile_lambda` to emit `(item: <T>)` instead of `(item: any)`.
    /// Cleared on the way down — only the immediate child lambda sees it.
    pub expected_element_type: Option<String>,
    /// The trait's linked entity name (e.g. `"Article"`) — used to resolve
    /// `@entity` and `@entity.<field>` source types when inferring lambda
    /// element types.
    pub linked_entity_name: Option<String>,
    /// The narrowed payload schema for the current event/transition (field
    /// name → OirType). Used to resolve `@payload.<field>` source types.
    pub current_payload_schema: Option<orbital_core_base::ir::OirTypeMap>,
    /// All entities keyed by name. Used to resolve `@<EntityName>`,
    /// `Reference { entity }`, and the linked entity's field types when
    /// inferring lambda element types.
    pub entity_catalog: HashMap<String, OirEntity>,
}

impl CodegenContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a child context with a new local binding
    pub fn with_local(&self, name: &str, ts_name: &str) -> Self {
        let mut ctx = self.clone();
        ctx.locals.insert(name.to_string(), ts_name.to_string());
        ctx
    }

    /// Create a child context with the expected element type set for the
    /// next lambda. Consumed by `compile_lambda_or_expr`.
    pub fn with_element_type(&self, ts_type: impl Into<String>) -> Self {
        let mut ctx = self.clone();
        ctx.expected_element_type = Some(ts_type.into());
        ctx
    }

    /// Create a child context with the element type cleared.
    pub fn without_element_type(&self) -> Self {
        let mut ctx = self.clone();
        ctx.expected_element_type = None;
        ctx
    }

    /// Create a child context whose `@payload` binding resolves to `name` —
    /// the emission scope's payload identifier (`payloadObj` in transition
    /// handlers, `_payload` in hook field builders, `lastPayload` in render-ui).
    /// Single owner of the per-scope payload name; resolvers read `payload_var`.
    pub fn with_payload_binding(&self, name: impl Into<String>) -> Self {
        let mut ctx = self.clone();
        ctx.payload_var = Some(name.into());
        ctx
    }

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
