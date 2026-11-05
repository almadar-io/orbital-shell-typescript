//! Code generation module for TypeScript
//!
//! This module provides code generation utilities for compiling S-expressions
//! and other Orbital constructs directly to TypeScript code.

pub mod handler_header;
mod service;
pub mod ts_ident;

pub use service::*;
pub use orbital_core_base::theme::{client_themes, generate_theme_css, theme_font_imports, ClientTheme};
pub(crate) use ts_ident::ts_member_name;
