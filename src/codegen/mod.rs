//! Code generation module for TypeScript
//!
//! This module provides code generation utilities for compiling S-expressions
//! and other Orbital constructs directly to TypeScript code.

pub mod context;
pub mod effect;
pub mod expr;
pub mod handler_header;
pub mod infer;
pub mod operator;
pub mod operator_names;
pub mod pattern;
mod service;
pub mod target;
mod theme;
pub mod ts_ident;

pub use context::CodegenContext;
pub use infer::infer_oirexpr_element_type_ts;

pub use operator_names::is_operator_name;
pub use operator_names::is_substrate_operator;
pub use service::*;
pub use theme::*;
pub(crate) use ts_ident::ts_member_name;
