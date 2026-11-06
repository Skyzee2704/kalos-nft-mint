#!/bin/bash
# Outlaws 10s retry tick: up to 6 attempts, 10s apart, single-instance lock.
# Env (KALOS_PRIVATE_KEY, KALOS_RPC) is inherited from the cron worker.
# Terminal outcomes (0 ok, 8 done, 11 stage full, 12 sold out) write a
# done-marker so later ticks become no-ops. Window end: 2026-11-05 23:30 WITA.
LOCK=/tmp/outlaws-retry.lock
DONE="$(cd "$(dirname "$0")" && pwd)/outlaws-retry-done.txt"
[ -f "$DONE" ] && { echo "already terminal, skip tick"; exit 0; }
if mkdir "$LOCK" 2>/dev/null; then
  trap 'rmdir "$LOCK"' EXIT
else
  AGE=$(($(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0)))
  if [ "$AGE" -gt 150 ]; then
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0; trap 'rmdir "$LOCK"' EXIT
  else
    echo "loop already running, skip tick"; exit 0
  fi
fi
if [ $(date +%s) -gt 1793892600 ]; then echo "window closed, stop"; echo "window-closed" > "$DONE"; exit 0; fi
cd "$(dirname "$0")" || exit 0
for i in 1 2 3 4 5 6; do
  [ -f "$DONE" ] && exit 0
  NO_WAIT=1 FAST=1 LIVE=1 node outlaws-mint.mjs; code=$?
  echo "attempt $i exit $code"
  case $code in 0|8|11|12) echo "terminal $code" > "$DONE"; exit 0;; esac
  sleep 10
done
