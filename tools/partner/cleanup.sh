#!/usr/bin/env bash
# Deletes ALL local data for a partner engagement (raw, config incl. salt,
# outputs, notes) and verifies absence. Doc 11 §8 is the full procedure —
# this script is only the filesystem part.
set -euo pipefail
cd "$(dirname "$0")/../.."

code="${1:?usage: tools/partner/cleanup.sh <partner-code>}"
base="partner-runs/$code"

[ -e "$base" ] || { echo "$base does not exist — nothing to delete."; exit 0; }

echo "About to permanently delete $base — raw exports, salt, outputs, findings notes."
read -r -p "Type the partner code to confirm: " confirm
[ "$confirm" = "$code" ] || { echo "Confirmation mismatch — aborting."; exit 1; }

rm -rf "$base"

if [ -e "$base" ]; then
  echo "FATAL: $base still exists after deletion." >&2
  exit 1
fi
echo "Deleted $base."
echo "Remember (doc 11 §8): check shell history for pasted data, empty the OS"
echo "trash if files ever touched it, and record the deletion date in the"
echo "engagement notes kept OUTSIDE the deleted directory (e.g., CRM)."
