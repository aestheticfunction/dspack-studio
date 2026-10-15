#!/usr/bin/env bash
# shadcn/ui v3 Stage 3, window 1: every no-cost check, repeated immediately before the first paid call, then the launch
# only if every check passes. "check" runs the checks alone; "launch" runs them and then the readiness packet's frozen
# command and monitor. Nothing before the launch calls a model: the probe is the baseline's four zero-cost requests.
set -u
MODE=${1:-check}
SP=/tmp/claude-0/-home-user/870d30cc-3b6b-550c-bdac-b13bd5711164/scratchpad/v4/shadcn-w1
REPO=/home/user/dspack-studio
BENCH=$REPO/packages/block-bench
MAIN=7e260c38029ab0a1df1fc499733ed037c06d60db
TOOLING_COMMIT=e3f57da4280e8f67c5f8cdecde3fc0872e03708b
BASELINE_COMMIT=460cc81d7af794eadabb7da919dc4bd147c09c74
BUILD=Dyml8RSqfWynKU1KbVuZI
CODE=51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229
DIGEST=0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9
DATE=$(date -u +%F)
RUNREL=live/runs/1b-stage3-shadcn-$DATE
RUNDIR=$BENCH/$RUNREL
TOOLING=$SP/tooling
if [ "$MODE" = launch ]; then PRE=$SP/prerun-checks.txt; else PRE=$SP/prerun-checks.check-$(date -u +%Y%m%dT%H%M%SZ).txt; fi
ok=1
fail() { echo "FAIL: $*"; ok=0; }
cd "$REPO" || exit 2
{
  date -u +"checks at %FT%TZ"
  echo "mode $MODE | run directory $RUNREL"

  # Main, the checkout, processes and the run directory.
  git fetch -q origin
  echo "HEAD $(git rev-parse HEAD) | origin/main $(git rev-parse origin/main)"
  [ "$(git rev-parse HEAD)" = "$MAIN" ] && [ "$(git rev-parse origin/main)" = "$MAIN" ] || fail "main is not $MAIN"
  [ -z "$(git status --porcelain)" ] && echo "working tree clean" || fail "working tree not clean"
  if pgrep -f "live/run.ts|monitor_run.py" > /dev/null; then fail "a harness or monitor process is running"; else echo "no harness or monitor process running"; fi
  [ ! -e "$RUNDIR" ] && echo "fresh run directory absent: ok ($RUNREL)" || fail "$RUNDIR exists"
  others=$(ls -d "$BENCH"/live/runs/1b-stage3-shadcn-* 2>/dev/null)
  [ -z "$others" ] && echo "no shadcn Stage-3 run directory exists yet" || fail "a shadcn Stage-3 run directory exists: $others"

  # Evidence: every branch's head and every checksum, and the local run directories against theirs.
  for br in blocks-stage3-astryx-evidence blocks-baseline-7e260c3-evidence blocks-baseline-eaf6ae3-evidence blocks-smoke-option-b-evidence blocks-smoke-c154548-evidence; do
    echo "evidence $br $(git rev-parse "origin/claude/$br")"
  done
  [ "$(git rev-parse origin/claude/blocks-stage3-astryx-evidence)" = "$TOOLING_COMMIT" ] || fail "the tooling branch is not at $TOOLING_COMMIT"
  [ "$(git rev-parse origin/claude/blocks-baseline-7e260c3-evidence)" = "$BASELINE_COMMIT" ] || fail "the baseline branch is not at $BASELINE_COMMIT"
  bad=0; n=0
  for f in "$BENCH"/live/runs/*.SHA256SUMS; do
    n=$((n + $(grep -c '' "$f"))); bad=$((bad + $( (cd "$BENCH/live/runs" && sha256sum -c "$(basename "$f")" 2>&1) | grep -vc ': OK$')))
  done
  for br in blocks-stage3-astryx-evidence blocks-baseline-7e260c3-evidence blocks-baseline-eaf6ae3-evidence blocks-smoke-option-b-evidence blocks-smoke-c154548-evidence; do
    d=$SP/ev/$br; rm -rf "$d"; mkdir -p "$d"; git archive "origin/claude/$br" evidence | tar -x -C "$d"
    while IFS= read -r f; do
      n=$((n + $(grep -c '' "$f"))); bad=$((bad + $( (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f")" 2>&1) | grep -vc ': OK$')))
    done < <(find "$d/evidence" -name '*SHA256SUMS' | sort)
  done
  a=$SP/ev/blocks-stage3-astryx-evidence/evidence/blocks-1b/1b-stage3-astryx-2026-10-12.SHA256SUMS
  m=$(grep -c ' 1b-stage3-astryx-2026-10-12/' "$a")
  n=$((n + m)); bad=$((bad + $( (cd "$BENCH/live/runs" && grep ' 1b-stage3-astryx-2026-10-12/' "$a" | sha256sum -c 2>&1) | grep -vc ': OK$')))
  echo "evidence checksums: $n entries, $bad not OK (the local Astryx run directory's $m among them)"
  [ "$bad" -eq 0 ] || fail "evidence checksums"

  # The frozen tooling: the monitor, its configuration and the verifier, exported from the packet's commit.
  rm -rf "$TOOLING" "$SP/tooling-export"; mkdir -p "$SP/tooling-export"
  git archive "$TOOLING_COMMIT" evidence/blocks-1b/tooling | tar -x -C "$SP/tooling-export" && mv "$SP/tooling-export/evidence/blocks-1b/tooling" "$TOOLING" && rm -rf "$SP/tooling-export"
  (cd "$TOOLING" && sha256sum -c SHA256SUMS --quiet) && echo "tooling at $TOOLING_COMMIT: $(grep -c '' "$TOOLING/SHA256SUMS") checksum entries verify" || fail "the tooling's checksums"
  echo "monitor_run.py $(sha256sum "$TOOLING/monitor_run.py" | cut -d' ' -f1) | monitor-shadcn.json $(sha256sum "$TOOLING/monitor-shadcn.json" | cut -d' ' -f1) | verify_run.py $(sha256sum "$TOOLING/verify_run.py" | cut -d' ' -f1)"
  python3 -I - "$TOOLING/monitor-shadcn.json" "$BUILD" "$CODE" "$DIGEST" <<'EOF' || ok=0
import json, sys
c = json.load(open(sys.argv[1]))
e = c["expect"]
want = {"model": "claude-haiku-4-5-20251001", "build": sys.argv[2], "code": sys.argv[3], "reference": "shadcn-v3", "models": ["scripted", "hosted-ai"]}
bad = {k: (e.get(k), v) for k, v in want.items() if e.get(k) != v}
if e["corpus"].get("sha256") != sys.argv[4] or e["corpus"].get("version") != 2:
    bad["corpus"] = (e["corpus"], sys.argv[4])
limits = {"maxRequestsPerWindow": 123, "spacingSeconds": 12, "backoffMs": [30000, 60000, 120000, 240000], "maxReleased": 8, "maxBackoffSeconds": 600}
bad.update({k: (c.get(k), v) for k, v in limits.items() if c.get(k) != v})
print(f"monitor configuration: model {e['model']} | build {e['build']} | code {e['code'][:12]}… | corpus v{e['corpus']['version']} {e['corpus']['sha256'][:12]}… | reference {e['reference']} | {c['maxRequestsPerWindow']} requests a window, {c['spacingSeconds']} s spacing | matches the authorization: {not bad} {bad or ''}")
sys.exit(0 if not bad else 1)
EOF

  # The production probe (zero-cost) against the committed baseline.
  NODE_USE_ENV_PROXY=1 timeout 180 pnpm --filter @dspack-studio/block-bench baseline > "$SP/probe-$MODE.log" 2>&1; echo "probe exit=$?"
  git show "$BASELINE_COMMIT:evidence/blocks-1b/1b.baseline-7e260c3.json" > "$SP/committed-baseline.json"
  python3 -I - "$SP/probe-$MODE.log" "$SP/committed-baseline.json" "$BUILD" <<'EOF' || ok=0
import json, sys
text = open(sys.argv[1]).read()
probe = json.loads(text[text.index("{"):text.rindex("}") + 1])
base = json.load(open(sys.argv[2]))
diff = [k for k in sorted(set(probe) | set(base)) if k != "at" and probe.get(k) != base.get(k)]
w = probe["worker"]
print(f"probe at {probe['at']} | build {probe['buildId']} | worker {w['shape']} {w.get('capabilities')} {w['status']} calls {w['calls']} | models {','.join(probe['models'])} | drafts {probe.get('drafts')}")
print("sidecars: " + "; ".join(f"{s['reference']}={s['status']}/{s['binding']}/{len(s['usable'])} usable/{len(s['disabled'])} disabled" for s in probe["sidecars"]))
print(f"equals the committed baseline (7e260c3) apart from 'at': {diff == []} {diff}")
ok = diff == [] and probe["buildId"] == sys.argv[3] and w["shape"] == "per-call-model" and w["status"] == 400 and w["calls"] == [] and probe["models"] == ["scripted", "hosted-ai"]
if not ok:
    print("FAIL: the probe does not match the baseline")
sys.exit(0 if ok else 1)
EOF

  # The command through the harness's own parser, selection check, frozen pin and planner; the digest and identity.
  (cd "$BENCH" && timeout 300 npx tsx "$SP/plan-check.mts" "$DATE" 2>&1 | grep -v -e EHPA -e trace-warnings) > "$SP/plan-$MODE.txt"
  cat "$SP/plan-$MODE.txt"
  python3 -I - "$SP/plan-$MODE.txt" "$DIGEST" "$CODE" <<'EOF' || ok=0
import json, sys
lines = open(sys.argv[1]).read().splitlines()
p = json.loads(next(l for l in lines if l.startswith("{")))
code = next((l.split()[-1] for l in lines if l.startswith("code identity ")), None)
want = {"cells": 480, "references": ["shadcn-v3"], "corpus": "blocks-1b v2", "digest": sys.argv[2], "frozen": True, "scoring": "binding",
        "maxTotalUsd": 77, "maxTotalRequests": 1275, "maxRequests": 123, "spacingMs": 12000, "resume": None, "rerunFailed": False}
bad = {k: (p.get(k), v) for k, v in want.items() if p.get(k) != v}
if not (len(p["sidecars"]) == 1 and p["sidecars"][0].startswith("shadcn-v3:approved:")):
    bad["sidecars"] = p["sidecars"]
if code != sys.argv[3]:
    bad["code"] = code
print(f"plan matches the authorization: {not bad} {bad or ''}")
sys.exit(0 if not bad else 1)
EOF

  # The monitor's window count: the run's preflight files plus one.
  pf=$(ls "$RUNDIR"/preflight*.json 2>/dev/null | wc -l)
  echo "preflight files in the run: $pf, so the monitor's --preflights is $((pf + 1))"
  [ "$pf" -eq 0 ] || fail "the run already holds a preflight"
  date -u +"checks ended %FT%TZ"
} > "$PRE" 2>&1
cat "$PRE"
if [ "$ok" -ne 1 ]; then echo "NOT LAUNCHED: a check failed"; exit 1; fi
if [ "$MODE" != launch ]; then echo "EVERY CHECK PASSED (check mode: nothing launched)"; exit 0; fi

# The launch: the readiness packet's frozen command and monitor, from packages/block-bench, without job control, so that
# $! is the new session's process group.
cd "$BENCH" || exit 2
setsid bash -c '
  echo "invocation 1 start $(date -u +%FT%TZ)" >> "$1/invocations.txt"
  NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --corpus 2 --reference shadcn-v3 \
    --prompts rt-01,rt-02,rt-03,rt-04,rt-05,rt-06,af-01,af-02,af-03,af-04,af-05,af-06,gs-01,gs-02,gs-03,gs-04,gs-05,gs-06,nb-01,nb-02,nb-03,nb-04,nb-05,nb-06 \
    --max-total-usd 77 --max-total-requests 1275 --max-requests 123 --spacing-ms 12000 \
    --out live/runs/1b-stage3-shadcn-'"$DATE"' > "$1/invocation-1.log" 2>&1
  code=$?
  echo "invocation 1 end $(date -u +%FT%TZ) exit $code" >> "$1/invocations.txt"
' _ "$SP" < /dev/null > /dev/null 2>&1 &
python3 -I "$TOOLING"/monitor_run.py --run live/runs/1b-stage3-shadcn-$DATE --pgid $! --preflights 1 \
  --config "$TOOLING"/monitor-shadcn.json --corpus live/corpora/blocks.v2.json --events "$SP"/monitor-events-1.log
echo "monitor exit $? at $(date -u +%FT%TZ)" | tee -a "$SP/monitor-exit.txt"
