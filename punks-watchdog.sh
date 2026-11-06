#!/bin/bash
# Watchdog presign + retry loop untuk stage-stage yang masih ARMED:
# elysium-punks Allowlist 1 + public, the-obol Allowlist + public.
# (Dibuat 4 Nov 22:42 untuk punks; diperluas 5 Nov ~04:10 untuk
# the-obol setelah presign catto mati sebelum buka dan user mint manual.)
# Env inherited (KALOS_PRIVATE_KEY, KALOS_RPC); LIVE=1 forced here so
# spawned presigns/loops are always live, never dry.
# Silent if all alive/resolved/window closed. Reports only on reinstall.
# pgrep patterns use the [s]/[l] bracket trick so the pattern text itself
# never self-matches a shell command line containing this script.
export LIVE=1
FARM="$(cd "$(dirname "$0")" && pwd)"
cd $FARM || exit 0
NOW=$(date +%s)
supervise() {
  # $1=slug $2=stage $3=open $4=end $5=mode $6=retrylog
  local slug="$1" stage="$2" end="$4" mode="$5" rlog="$6"
  local resolved=0
  grep -q "$slug/$stage.*RESULT" drop-sched.log 2>/dev/null && resolved=1
  grep -q "$slug/$stage RETRY-TERMINAL" "$rlog" 2>/dev/null && resolved=1
  [ "$resolved" -eq 1 ] && return 0
  [ "$NOW" -ge "$end" ] && return 0
  local pat
  case "$slug" in
    elysium-punks) pat='elysium-punk[s]' ;;
    the-obol) pat='the-obo[l]' ;;
    *) pat="$slug" ;;
  esac
  pgrep -f "mint-sched.mjs $pat $stage" > /dev/null || { setsid node mint-sched.mjs "$slug" "$stage" >> drop-sched.log 2>&1 < /dev/null & echo "$slug $stage scheduler reinstalled pid $!"; }
  if [ "$mode" = public ]; then
    pgrep -f "retry-mint-loop.sh $pat $stage" > /dev/null || { setsid bash retry-mint-loop.sh "$slug" "$stage" "$3" "$4" 120 public >> "$rlog" 2>&1 < /dev/null & echo "$slug $stage retry loop reinstalled pid $!"; }
  else
    pgrep -f "retry-mint-loop.sh $pat $stage" > /dev/null || { setsid bash retry-mint-loop.sh "$slug" "$stage" "$3" "$4" 120 >> "$rlog" 2>&1 < /dev/null & echo "$slug $stage retry loop reinstalled pid $!"; }
  fi
}
supervise elysium-punks 'Allowlist 1' 1793898000 1793905200 allow elysium-punks-retry.log
supervise elysium-punks public 1793905200 1794164400 public elysium-punks-retry.log
supervise the-obol 'Allowlist' 1793826000 1793912400 allow the-obol-retry.log
supervise the-obol public 1793912460 1793998800 public the-obol-retry.log
echo "watchdog check done"
