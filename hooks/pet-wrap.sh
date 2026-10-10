#!/usr/bin/env bash
# Keep a distinct pet session alive for the full command, and preserve its exit code.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/pet-wrap.js" "$@"
