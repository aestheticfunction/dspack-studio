#!/usr/bin/env bash
# Window 8's operator stop for a provider failure. The owner's rule for window 8 stops the run at any new provider
# failure; the frozen monitor (monitor-shadcn.json, maxProviderFailures 1) allows one a window and stops at the second.
# This follows the monitor's own events log and, at its first "a provider failure in" line, sends SIGTERM to the
# harness's process group, as the monitor's own stop does. It signals only a group the monitor has shown the harness
# inside (its lock line), never a harness already ending its window by itself (its pacing entry written), and nothing
# else. It never writes the run.
#   provider-failure-stop.sh <monitor events log> <harness process group> <the run's pacing.jsonl> <its lines before
#     this window> <this script's own log>
set -u
EV=${1:?events log}
PG=${2:?process group}
PACING=${3:?pacing.jsonl}
BASE=${4:?pacing lines before this window}
OUT=${5:?own log}
log() { echo "$(date -u +%FT%TZ) $*" >> "$OUT"; }
running() { pgrep -g "$PG" > /dev/null; }
ending() { [ "$(grep -c '' "$PACING" 2>/dev/null || echo 0)" -gt "$BASE" ]; }
log "watching $EV for a provider failure; harness process group $PG; $BASE pacing lines before this window"
until grep -q "inside --pgid $PG: the harness" "$EV" 2>/dev/null; do
  running || { log "the harness's group ended before the monitor showed the harness inside it: nothing signalled"; exit 0; }
  sleep 1
done
log "the monitor showed the harness inside process group $PG"
while running; do
  if grep -q "a provider failure in " "$EV"; then
    log "the monitor logged a provider failure: $(grep -m1 'a provider failure in ' "$EV" | cut -c1-300)"
    if ending; then
      log "the harness has written its pacing entry and is ending its window by itself: nothing signalled"
      while running; do sleep 0.5; done
      log "the harness exited"
      exit 11
    fi
    kill -TERM -- "-$PG" 2> /dev/null && log "SIGTERM sent to process group $PG"
    for _ in $(seq 1 60); do running || break; sleep 0.5; done
    if running; then
      kill -KILL -- "-$PG" 2> /dev/null
      log "the harness did not exit on SIGTERM: SIGKILL sent"
    fi
    log "the harness stopped"
    exit 10
  fi
  sleep 1
done
log "the harness exited, and the monitor logged no provider failure"
exit 0
