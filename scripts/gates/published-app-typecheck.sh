#!/usr/bin/env bash
# G-CROSS-800: after a release publishes, install that orb from the registry into an empty HOME, compile an app and
# typecheck it with the packages the generated project resolves from the registry, as a new user would.
# Usage: published-app-typecheck.sh <version>
# Optional: ORGANISM (path under the installed @almadar/std behaviors/lolo, default ui/core/atoms/std-browse.lolo),
#           WAIT_ATTEMPTS and WAIT_SECONDS (how long to wait for the registry to serve this platform's packages).
set -eu
version="${1:?usage: published-app-typecheck.sh <version>}"
organism="${ORGANISM:-ui/core/atoms/std-browse.lolo}"
attempts="${WAIT_ATTEMPTS:-40}"
pause="${WAIT_SECONDS:-15}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64 ;;
  Darwin-x86_64) platform=darwin-x64 ;;
  Linux-x86_64) platform=linux-x64 ;;
  Linux-aarch64) platform=linux-arm64 ;;
  *) echo "published-app-typecheck: no orb build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/proj"
export HOME="$work/home"
unset NPM_CONFIG_USERCONFIG npm_config_userconfig

for pkg in "orb-$platform" orb-shell-typescript "orb-shell-typescript-$platform"; do
  n=0
  until [ -n "$(npm view "@almadar/$pkg@$version" version 2>/dev/null)" ]; do
    n=$((n + 1))
    if [ "$n" -ge "$attempts" ]; then echo "published-app-typecheck: @almadar/$pkg@$version is not served after $attempts tries" >&2; exit 1; fi
    sleep "$pause"
  done
done

cd "$work/proj"
npm init -y >/dev/null
npm install "@almadar/orb@$version" --no-audit --no-fund
orb="$work/proj/node_modules/.bin/orb"
"$orb" --version
"$orb" update --global
"$orb" compile "$HOME/.orb/node_modules/@almadar/std/behaviors/lolo/$organism" --shell typescript --mode client -o "$work/app"
if [ -e "$work/app/pnpm-lock.yaml" ]; then echo "published-app-typecheck: the compiled app carries the template lockfile" >&2; exit 1; fi
cd "$work/app"
pnpm install --ignore-scripts
for pkg in client server; do
  (cd "packages/$pkg" && pnpm exec tsc --noEmit -p .)
done
echo "published-app-typecheck: orb $version compiles $organism and the app typechecks against the registry"
