#!/usr/bin/env bash
# Run any command with the pet reacting to it.
#
#   ./hooks/pet-wrap.sh npm test
#   PET_SOURCE=aider ./hooks/pet-wrap.sh aider --model sonnet
#
# The pet goes to work while the command runs, cheers if it exits 0, and buzzes
# if it doesn't. The exit code is passed straight through, so this is safe to
# drop in front of a command in a Makefile, CI script, or shell alias.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
notify="node $here/pet-notify.js"

if [ "$#" -eq 0 ]; then
  echo "usage: pet-wrap.sh <command> [args...]" >&2
  exit 2
fi

# Never let a missing/broken pet take the real command down with it.
$notify working "$*" >/dev/null 2>&1 || true

"$@"
code=$?

if [ "$code" -eq 0 ]; then
  $notify done "$* ✓" >/dev/null 2>&1 || true
else
  $notify error "$* failed ($code)" >/dev/null 2>&1 || true
fi

exit "$code"
