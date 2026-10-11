//! TypeScript Shell for Orbital Compiler
//!
//! This crate provides the TypeScript/React shell implementation for the Orbital compiler.
//! It generates TypeScript code for both client (React) and server (Express) targets.

#![allow(unexpected_cfgs)]

mod backend;
mod backend_hono;
pub mod codegen;
mod generators;
pub mod pattern_registry;
pub mod shell_program;
mod shell;

pub use backend::{classify_oir_type, EntityFieldInfo, ExtraComponentMapping, ServerFramework, TypeScriptBackend};
pub use codegen::target::{
    ClientEffectEmitter, ComponentRenderer, WebClientEffectEmitter, WebComponentRenderer,
};
pub use codegen::*;
pub use generators::*;
pub use shell::{express_shell, hono_shell};
