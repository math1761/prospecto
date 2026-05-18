#!/usr/bin/env bash
set -euo pipefail

pnpm run dev:workers &
pnpm run dev:frontend &

trap 'kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM

wait
