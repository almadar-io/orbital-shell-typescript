//! TypeScript Shell for Orbital Compiler
//!
//! This crate provides the TypeScript/React shell implementation for the Orbital compiler.
//! It generates TypeScript code for both client (React) and server (Express) targets.

#![allow(unexpected_cfgs)]

mod backend;
mod codegen;
pub mod pattern_registry;
pub mod shell_program;
mod shell;

pub use backend::kernel_host::{KERNEL_CLIENT_DEPENDENCIES, KERNEL_SERVER_DEPENDENCIES};
pub use backend::{classify_oir_type, EntityFieldInfo, ExtraComponentMapping, ServerFramework, TypeScriptBackend};
pub use codegen::handler_header::core_value_imports_clause;
pub use codegen::{generate_theme_css, theme_font_imports};
pub use shell::{express_shell, hono_shell};
