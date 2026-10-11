//! Phase F.6: codegen self-typecheck.
//!
//! Goal: emit a representative project from a fixture .orb, run `tsc
//! --noEmit` over the emitted TypeScript, and assert exit 0. This catches
//! regression classes where a Rust codegen change emits TypeScript that
//! still parses but fails the project's tsconfig (missing imports, prop
//! type mismatches, generic constraints).
//!
//! The full implementation requires:
//!   - parsing a .orb fixture (cross-crate dependency on the compiler's
//!     full lower pipeline, which mounts its own embedded behaviors)
//!   - emitting the full project (hundreds of files: client + server +
//!     shared packages)
//!   - running `pnpm install` for `@almadar/*` workspace packages so the
//!     emitted code's imports resolve
//!   - finally invoking `tsc --noEmit`
//!
//! That involves cross-process orchestration that does not belong in a
//! pure-Rust unit test. The procedure is documented in
//! `tools/orbital-verify-unified` (Phase 2.5 tsc step under VG8-A) and is
//! exercised end-to-end by the orbital-verify CI gate.
//!
//! This stub exists to:
//!   1. Mark the surface area where the in-process tsc gate would land if
//!      we add it later.
//!   2. Lock the test name in the suite so `cargo test` reflects the
//!      coverage map even though the body is `#[ignore]`d by default.
//!   3. Still validate the cheap precondition (a `tsc` binary is on
//!      $PATH) when the test is invoked explicitly with
//!      `cargo test -- --ignored`.

use std::process::Command;

/// Manual procedure to run the full Phase F.6 gate today:
///
/// 1. From repo root: `~/bin/orbital compile projects/cart/cart.orb`.
/// 2. `cd projects/cart && pnpm install`.
/// 3. `pnpm exec tsc --noEmit`.
/// 4. Expect exit 0; any non-zero exit is a Phase F.6 violation.
///
/// To run automatically: see `tools/orbital-verify-unified` Phase 2.5.
#[test]
#[ignore = "Phase F.6: full codegen typecheck runs out-of-process; see tools/orbital-verify-unified Phase 2.5. Run with --ignored to verify tsc availability."]
fn codegen_typecheck_stub() {
    // Cheap precondition: when invoked, confirm `tsc` is at least
    // discoverable on $PATH. The actual `--noEmit` run requires emitted
    // project files which this binary does not generate in-process.
    let out = match Command::new("tsc").arg("--version").output() {
        Ok(o) => o,
        Err(_) => {
            // No tsc on PATH; fail with a helpful message rather than panic
            // ambiguously, since the user explicitly invoked --ignored.
            panic!(
                "Phase F.6: tsc is not installed or not on PATH. Install via `pnpm install -g typescript` or run `pnpm install` from the repo root, then re-run with --ignored."
            );
        }
    };
    assert!(
        out.status.success(),
        "Phase F.6: `tsc --version` exited non-zero: {:?}",
        String::from_utf8_lossy(&out.stderr)
    );
}
