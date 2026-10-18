//! Effect compilation for the per-trait logic hook `orbital-shell-mobile` reuses: client-side and expression-mode.

use orbital_core_base::ir::{
    OirBindingRoot, OirEffect, OirEmitConfig, OirEntity, OirExpr, OirInterval,
    OirLogLevel, OirModule, OirPersistOp, OirTrait, OirTransitionFrom,
};

use crate::backend::{to_camel_case, TypeScriptBackend};
use crate::codegen::handler_header::entity_type_ref;

mod client;
#[cfg(test)]
mod dispatch_roots_tests;
#[cfg(test)]
mod now_stamp_tests;
#[cfg(test)]
mod visible_tick_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod runs_on_tests;
pub(crate) mod shared;
mod tick;
mod timeout;
mod to_ts;
