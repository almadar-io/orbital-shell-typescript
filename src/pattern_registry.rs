//! Pattern registry — re-export of the single canonical embed in
//! `orbital_core::language::pattern_registry`. The data (component-mapping /
//! event-contracts / pattern registry) lives ONCE in `orbital-core`; this
//! shell consumes it through this re-export so `crate::pattern_registry::…`
//! call sites are unchanged. See that module for why the per-shell copies were
//! removed.

pub use orbital_core_base::language::pattern_registry::*;
