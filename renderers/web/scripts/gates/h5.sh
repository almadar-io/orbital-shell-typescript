#!/usr/bin/env bash
# H5 gate: shell-web's green checks, each ratcheted against scripts/gates/known-failures/<check>.txt.
set -u
cd "$(dirname "$0")/../.."
ORB=${ORB:-orb}
G=scripts/gates
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

npx eslint --no-warn-ignored -f json -o $G/.observed/eslint.json src > /dev/null 2>&1
node -e '
  const report = require(process.argv[1]);
  for (const file of report) for (const m of file.messages) console.log(`${require("path").relative(process.cwd(), file.filePath)}#${m.ruleId ?? "parse"}#${m.message}`);
' "$PWD/$G/.observed/eslint.json" > $G/.observed/eslint.txt
ratchet eslint

{ node scripts/theme-contrast-audit.mjs > /dev/null 2>&1 || echo "theme-contrast#FAILED"; node scripts/theme-distinctness-audit.mjs > /dev/null 2>&1 || echo "theme-distinctness#FAILED"; } > $G/.observed/themes.txt
ratchet themes

node scripts/component-contrast-audit.mjs 2>&1 | sed -nE 's/^ +[0-9]+ modes +worst [^)]+\) +(.*) +— .*$/\1/p' > $G/.observed/component-contrast.txt
ratchet component-contrast

pnpm audit --json --prod 2>/dev/null | node -e '
  let text = "";
  process.stdin.on("data", (c) => { text += c; });
  process.stdin.on("end", () => {
    const report = JSON.parse(text);
    const ids = new Set();
    for (const [id, a] of Object.entries(report.advisories ?? {})) {
      for (const f of a.findings) for (const p of f.paths) {
        const importer = p.split(">")[0];
        if (importer === "." || importer.endsWith("renderers__web")) ids.add(`${id}#${a.module_name}`);
      }
    }
    for (const id of [...ids].sort()) console.log(id);
  });' > $G/.observed/audit.txt
ratchet audit

exit $status
