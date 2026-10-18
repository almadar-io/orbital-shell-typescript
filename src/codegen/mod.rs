//! Code generation module for TypeScript
//!
//! This module provides code generation utilities for compiling S-expressions
//! and other Orbital constructs directly to TypeScript code.

pub mod handler_header;
mod service;
mod theme;
pub mod ts_ident;

pub use service::*;
pub use theme::*;
pub(crate) use ts_ident::ts_member_name;
