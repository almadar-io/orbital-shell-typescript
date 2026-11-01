#!/usr/bin/env bash
# G-ORBITAL-SHELL-TYPESCRIPT-003: compile real organisms with `orb compile` and run `tsc --noEmit` on the generated
# client and server packages. Every error from every organism is printed in full; any error fails the gate.
#
# The gate typechecks against the versions being released: every @almadar package the template depends on is
# `pnpm pack`ed from this checkout's built dist and pinned in the compiled project's pnpm.overrides to its file:
# tarball, so the registry's older versions never decide the result. Other dependencies come from the registry; the
# project is installed in the temp dir, outside any workspace.
#
# Requires: ORB_BIN (the orb binary), BEHAVIORS_DIR (packages/almadar-behaviors/behaviors/lolo), SHELL_DIR
# (crates/orbital-shell-typescript, built), WASM_JS_DIR (crates/orbital-wasm/js, built by its scripts/build.sh),
# STD_DIR (the built @almadar/std package), and pnpm with registry access for the non-@almadar dependencies.
# Optional: ORGANISMS (newline-separated "mode path-under-BEHAVIORS_DIR" entries, replaces the default set),
#           KEEP_DIR (compile into this directory and keep it; default is a temp dir removed on exit).
#
# Default set. `orb compile --mode full` refuses an organism that declares no http endpoint, and only std-kflow
# (and std-studio) compose std-http-server, so the other three compile in `client` mode, which still emits and
# typechecks packages/client and packages/server.
set -u
: "${ORB_BIN:?set ORB_BIN to the orb binary}"
: "${BEHAVIORS_DIR:?set BEHAVIORS_DIR to packages/almadar-behaviors/behaviors/lolo}"

: "${SHELL_DIR:?set SHELL_DIR to crates/orbital-shell-typescript (built)}"
: "${WASM_JS_DIR:?set WASM_JS_DIR to crates/orbital-wasm/js (built)}"
: "${STD_DIR:?set STD_DIR to the built @almadar/std package}"

DEFAULT_ORGANISMS="full kflow/organisms/std-kflow.lolo
client app/organisms/std-notes.lolo
client riya/organisms/riya-game.lolo
client learning/organisms/learning-math-lab.lolo"
ORGANISMS="${ORGANISMS:-$DEFAULT_ORGANISMS}"

root="${KEEP_DIR:-$(mktemp -d)}"
mkdir -p "$root"
[ -z "${KEEP_DIR:-}" ] && trap 'rm -rf "$root"' EXIT
status=0

PACKAGE_DIRS="$SHELL_DIR/core
$SHELL_DIR/runtime/logger
$SHELL_DIR/runtime/kernel
$SHELL_DIR/tooling/syntax
$SHELL_DIR/hosts/browser
$SHELL_DIR/hosts/node
$SHELL_DIR/renderers/web
$WASM_JS_DIR
$STD_DIR"
tarballs="$root/.tarballs"
mkdir -p "$tarballs"
overrides="$root/.overrides.json"
echo "{" > "$overrides"
first=1
while read -r dir; do
  pname=$(node -p "require('$dir/package.json').name")
  if ! (cd "$dir" && npm_config_ignore_scripts=true pnpm pack --pack-destination "$tarballs" 2>&1); then
    echo "compiled-typecheck: pnpm pack failed for $pname ($dir): build it first"
    exit 1
  fi
  tgz=$(ls -t "$tarballs"/*.tgz | head -n 1)
  [ "$first" -eq 1 ] || echo "," >> "$overrides"
  first=0
  printf '"%s": "file:%s"' "$pname" "$tgz" >> "$overrides"
done <<< "$PACKAGE_DIRS"
echo "}" >> "$overrides"

while read -r mode rel; do
  [ -z "$rel" ] && continue
  name=$(basename "$rel" .lolo)
  out="$root/$name"
  echo "== $name ($mode)"
  rm -rf "$out"
  "$ORB_BIN" compile "$BEHAVIORS_DIR/$rel" -o "$out" --mode "$mode" 2>&1 | grep -v '^Loaded '
  if [ ! -f "$out/package.json" ]; then
    echo "compiled-typecheck $name: orb compile produced no project"
    status=1
    continue
  fi
  (cd "$out" && node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.pnpm = { ...pkg.pnpm, overrides: { ...(pkg.pnpm && pkg.pnpm.overrides), ...JSON.parse(fs.readFileSync(process.argv[1], "utf8")) } };
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));
  ' "$overrides") || { echo "compiled-typecheck $name: could not write overrides"; status=1; continue; }
  if ! (cd "$out" && pnpm install --no-frozen-lockfile --ignore-scripts 2>&1); then
    echo "compiled-typecheck $name: pnpm install failed"
    status=1
    continue
  fi
  for pkg in client server; do
    echo "-- $name packages/$pkg: tsc --noEmit"
    if ! (cd "$out/packages/$pkg" && npx --no-install tsc --noEmit -p tsconfig.json 2>&1); then
      echo "compiled-typecheck $name: $pkg FAILED"
      status=1
    fi
  done
done <<< "$ORGANISMS"

[ "$status" -eq 0 ] && echo "compiled-typecheck: all organisms typecheck" || echo "compiled-typecheck: FAILED"
exit $status
