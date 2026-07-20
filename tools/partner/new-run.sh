#!/usr/bin/env bash
# Scaffold an ignored partner-run directory. Refuses to proceed if the
# directory would not be git-ignored (privacy guardrail comes first).
set -euo pipefail
cd "$(dirname "$0")/../.."

code="${1:?usage: tools/partner/new-run.sh <partner-code>}"
base="partner-runs/$code"

# Guardrail BEFORE creating anything: the path must already be ignored.
if ! git check-ignore -q "$base/raw/probe.csv"; then
  echo "FATAL: $base is not git-ignored — fix .gitignore before any partner data exists." >&2
  exit 1
fi

if [ -e "$base" ]; then
  echo "FATAL: $base already exists — refusing to touch an existing engagement." >&2
  exit 1
fi

mkdir -p "$base"/{raw,config,output,notes}

umask 077
openssl rand -hex 32 > "$base/config/salt.txt"
: > "$base/config/actor-values.txt"

cp tools/partner/intake-checklist.md "$base/notes/intake-checklist.md"
cp tools/partner/findings-memo-template.md "$base/notes/findings-memo.md"
cp tools/partner/run-commands.sh.template "$base/config/run.sh"
chmod +x "$base/config/run.sh"
printf '# Session log — %s\n\nCommit: %s\n\n' "$code" "$(git rev-parse --short HEAD)" \
  > "$base/notes/session-log.md"

echo "Scaffolded $base (git-ignored, salt generated with mode 600)."
echo "Next:"
echo "  1. Place raw exports in $base/raw/ (originals; never edit them)"
echo "  2. Build $base/config/mapping.json + assumptions.json with the partner"
echo "  3. List raw actor values (one per line) in $base/config/actor-values.txt"
echo "  4. Fill placeholders in $base/config/run.sh, then follow notes/intake-checklist.md"
