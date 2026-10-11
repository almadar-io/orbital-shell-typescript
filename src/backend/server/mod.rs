//! Server-side TypeScript generation (event handlers, routes, listeners, seed).
//! Module-split of the former monolithic backend.rs server section.

pub(crate) mod access_policies;
mod handlers;
pub(crate) use handlers::{resolve_access_imports, ACCESS_IMPORT_MARKER};
mod listeners;
mod orbital_route;
mod routes;
mod seed;
mod sse;
pub(crate) mod ticks;
#[cfg(test)]
mod ticks_tests;
pub(crate) mod viewer;
pub(crate) mod i18n;
