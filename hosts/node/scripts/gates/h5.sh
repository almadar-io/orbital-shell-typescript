#!/usr/bin/env bash
# H5 gate: shell-node's green checks, each ratcheted against scripts/gates/known-failures/<check>.txt.
set -u
cd "$(dirname "$0")/../.."
ORB=${ORB:-orb}
G=scripts/gates
KERNEL_JS="$PWD/../../../orbital-wasm/js"
export ORB_BIN=${ORB_BIN:-$HOME/bin/orb} ORBITAL_KERNEL_NODE=${ORBITAL_KERNEL_NODE:-$HOME/bin/kernel.node} ALMADAR_KERNEL_DIR=${ALMADAR_KERNEL_DIR:-$KERNEL_JS}
mkdir -p $G/.observed $G/known-failures
status=0

ratchet() {
  touch "$G/known-failures/$1.txt"
  echo "h5 $1:"
  $ORB gate "$G/known-failures/$1.txt" "$G/.observed/$1.txt" || status=1
}

npx tsc --noEmit -p tsconfig.json 2>&1 | sed -nE 's/^([^(]+)\([0-9]+,[0-9]+\): error (TS[0-9]+): (.*)$/\1#\2#\3/p' > $G/.observed/tsc.txt
ratchet tsc

npx vitest --run --reporter=json --outputFile=$G/.observed/vitest.json > /dev/null 2>&1
node -e '
  const report = require(process.argv[1]);
  for (const file of report.testResults) {
    const rel = require("path").relative(process.cwd(), file.name);
    if (file.status === "failed" && file.assertionResults.length === 0) console.log(`${rel}#SUITE`);
    for (const test of file.assertionResults) if (test.status === "failed") console.log(`${rel}#${test.fullName}`);
  }' "$PWD/$G/.observed/vitest.json" > $G/.observed/vitest.txt
ratchet vitest

exit $status
