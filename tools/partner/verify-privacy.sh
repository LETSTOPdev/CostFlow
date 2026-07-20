#!/usr/bin/env bash
# Pass 4 — privacy verification: grep every raw actor value (from a LOCAL,
# git-ignored values file) across generated outputs and notes. Prints COUNTS
# ONLY — never the values themselves, on success or failure.
set -euo pipefail

values="${1:?usage: verify-privacy.sh <values-file> <path...>}"
shift
[ "$#" -ge 1 ] || { echo "usage: verify-privacy.sh <values-file> <path...>" >&2; exit 2; }

total=0
leaks=0
while IFS= read -r value; do
  [ -z "$value" ] && continue
  total=$((total + 1))
  # grep exits 1 on zero matches; that is the GOOD case and must not trip -e/pipefail.
  hits=$( (grep -rF -- "$value" "$@" 2>/dev/null || true) | wc -l | tr -d ' ')
  if [ "$hits" != "0" ]; then
    leaks=$((leaks + 1))
    echo "LEAK: value #$total occurs $hits time(s) in the checked paths"
  fi
done < "$values"

echo "privacy check: $total value(s) tested against: $*"
if [ "$total" -eq 0 ]; then
  echo "WARNING: values file is empty — nothing was actually verified" >&2
  exit 2
fi
if [ "$leaks" -eq 0 ]; then
  echo "privacy verification PASSED (0 occurrences)"
else
  echo "privacy verification FAILED ($leaks value(s) leaked)" >&2
  exit 1
fi
