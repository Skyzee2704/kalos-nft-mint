#!/bin/bash
# retry-mint-loop.sh — long-lived 10-second retry loop for ONE stage.
# usage: retry-mint-loop.sh <slug> <stageName> <open_epoch> <end_epoch> [grace_secs=120] [mode=allow|public]
# Env: KALOS_PRIVATE_KEY, KALOS_RPC, LIVE=1 (inherited from launcher).
# Behaviour: sleep until open+grace (grace lets a presign land first), then run
# drop-mint every ~10s (attempt duration included) until success or terminal.
# Terminal (stop): drop-mint exit 0,6,7,8,9,10,11,12. Retry: 1,2,3,5, other.
# No agent worker involved per attempt — this is a single background process,
# so the cadence is real seconds, not worker-startup minutes.
# Single instance per slug via flock. Never logs secrets.
set -u
SLUG=${1:?slug}; STAGE=${2:?stage}; OPEN=${3:?open_epoch}; END=${4:?end_epoch}; GRACE=${5:-120}; MODE=${6:-allow}
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/${SLUG}-retry.log"
exec 9>"${TMPDIR:-/tmp}/retry-mint-${SLUG}-${STAGE// /_}.lock"
flock -n 9 || { echo "retry loop $SLUG already running, exit"; exit 0; }
cd "$DIR" || exit 0
now=$(date +%s)
target=$((OPEN + GRACE))
if [ "$now" -lt "$target" ]; then sleep $((target - now)); fi
while true; do
  now=$(date +%s)
  if [ "$now" -ge "$END" ]; then echo "$(date '+%F %T %Z') $SLUG/$STAGE window closed, stop" >> "$LOG"; exit 0; fi
  start=$(date +%s)
  LIVE=${LIVE:-1} node drop-mint.mjs "$SLUG" "$MODE" "$STAGE" >> "$LOG" 2>&1
  code=$?
  case $code in
    0|6|7|8|9|10|11|12) echo "$(date '+%F %T %Z') $SLUG/$STAGE RETRY-TERMINAL code=$code" >> "$LOG"; exit 0 ;;
  esac
  elapsed=$(($(date +%s) - start))
  [ "$elapsed" -lt 10 ] && sleep $((10 - elapsed))
done
