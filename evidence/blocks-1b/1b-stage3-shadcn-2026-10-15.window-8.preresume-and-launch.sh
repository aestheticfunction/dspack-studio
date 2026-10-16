#!/usr/bin/env bash
# shadcn/ui v3 Stage 3, window 8 only: the owner's exception for window 7's hold (2026-10-16). It is the window-k script
# (shadcn-window.sh), every check the same, with three differences:
# - the run's state may hold exactly one request the run could not meter, window 7's #61, settled "usage not verified"
#   at $1.118208, with its two ledger lines exactly as window 7 left them; any other hold fails;
# - window 7's pacing entry may end in its integrity stop, exactly as window 7 left it; every other window must have
#   stopped at its cap;
# - the launch adds the owner's stop at any new provider failure (provider-failure-stop.sh), which the frozen monitor
#   allows once a window.
# The hold stays in the ledger as it is: nothing here writes the run.
#   shadcn-window-8.sh check|launch 8 <the commit that preserved window 7's copy>
# "launch" runs the readiness packet's frozen command with --resume and its monitor with --preflights K. Nothing before
# the launch calls a model: the probe is the baseline's four zero-cost requests.
set -u
MODE=${1:?check or launch}
K=${2:?window number}
SNAPSHOT_COMMIT=${3:?the commit that preserved the copy of window K-1}
SCRATCH=/tmp/claude-0/-home-user/870d30cc-3b6b-550c-bdac-b13bd5711164/scratchpad
SP=$SCRATCH/v4/shadcn-w$K
REPO=/home/user/dspack-studio
BENCH=$REPO/packages/block-bench
MAIN=7e260c38029ab0a1df1fc499733ed037c06d60db
TOOLING_COMMIT=e3f57da4280e8f67c5f8cdecde3fc0872e03708b
BASELINE_COMMIT=460cc81d7af794eadabb7da919dc4bd147c09c74
BUILD=Dyml8RSqfWynKU1KbVuZI
CODE=51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229
DIGEST=0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9
N=1b-stage3-shadcn-2026-10-15
RUNREL=live/runs/$N
RUNDIR=$BENCH/$RUNREL
TOOLING=$SP/tooling
[ "$K" -ge 3 ] 2>/dev/null || { echo "window number must be 3 or more"; exit 2; }
[ "$K" = 8 ] || { echo "this script is window 8's only: the owner's exception covers window 7's hold and nothing else"; exit 2; }
mkdir -p "$SP"
if [ "$MODE" = launch ]; then PRE=$SP/preresume-checks.txt; else PRE=$SP/preresume-checks.check-$(date -u +%Y%m%dT%H%M%SZ).txt; fi
ok=1
fail() { echo "FAIL: $*"; ok=0; }
cd "$REPO" || exit 2
{
  date -u +"checks at %FT%TZ"
  echo "mode $MODE | run directory $RUNREL | window $K | window $((K - 1))'s copy $SNAPSHOT_COMMIT"

  # Main, the checkout and processes.
  git fetch -q origin
  echo "HEAD $(git rev-parse HEAD) | origin/main $(git rev-parse origin/main)"
  [ "$(git rev-parse HEAD)" = "$MAIN" ] && [ "$(git rev-parse origin/main)" = "$MAIN" ] || fail "main is not $MAIN"
  [ -z "$(git status --porcelain)" ] && echo "working tree clean" || fail "working tree not clean"
  if pgrep -f "live/run.ts|monitor_run.py" > /dev/null; then fail "a harness or monitor process is running"; else echo "no harness or monitor process running"; fi

  # Evidence: every branch's head and every checksum; the run directory on the shadcn branch is still window K-1's copy.
  for br in blocks-stage3-shadcn-evidence blocks-stage3-astryx-evidence blocks-baseline-7e260c3-evidence blocks-baseline-eaf6ae3-evidence blocks-smoke-option-b-evidence blocks-smoke-c154548-evidence; do
    echo "evidence $br $(git rev-parse "origin/claude/$br")"
  done
  [ "$(git rev-parse origin/claude/blocks-stage3-astryx-evidence)" = "$TOOLING_COMMIT" ] || fail "the tooling branch is not at $TOOLING_COMMIT"
  [ "$(git rev-parse origin/claude/blocks-baseline-7e260c3-evidence)" = "$BASELINE_COMMIT" ] || fail "the baseline branch is not at $BASELINE_COMMIT"
  git merge-base --is-ancestor "$SNAPSHOT_COMMIT" origin/claude/blocks-stage3-shadcn-evidence && echo "window $((K - 1))'s copy $SNAPSHOT_COMMIT is on the shadcn evidence branch" || fail "$SNAPSHOT_COMMIT is not on the shadcn evidence branch"
  [ -z "$(git diff --name-only "$SNAPSHOT_COMMIT" origin/claude/blocks-stage3-shadcn-evidence -- "evidence/blocks-1b/$N/")" ] && echo "the branch's run directory is unchanged since $SNAPSHOT_COMMIT" || fail "the run directory on the evidence branch changed after $SNAPSHOT_COMMIT"
  bad=0; n=0
  for f in "$BENCH"/live/runs/*.SHA256SUMS; do
    [ -e "$f" ] || continue
    n=$((n + $(grep -c '' "$f"))); bad=$((bad + $( (cd "$BENCH/live/runs" && sha256sum -c "$(basename "$f")" 2>&1) | grep -vc ': OK$')))
  done
  for br in blocks-stage3-shadcn-evidence blocks-stage3-astryx-evidence blocks-baseline-7e260c3-evidence blocks-baseline-eaf6ae3-evidence blocks-smoke-option-b-evidence blocks-smoke-c154548-evidence; do
    d=$SP/ev/$br; rm -rf "$d"; mkdir -p "$d"; git archive "origin/claude/$br" evidence | tar -x -C "$d"
    while IFS= read -r f; do
      n=$((n + $(grep -c '' "$f"))); bad=$((bad + $( (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f")" 2>&1) | grep -vc ': OK$')))
    done < <(find "$d/evidence" -name '*SHA256SUMS' | sort)
  done
  if [ -d "$BENCH/live/runs/1b-stage3-astryx-2026-10-12" ]; then
    a=$SP/ev/blocks-stage3-astryx-evidence/evidence/blocks-1b/1b-stage3-astryx-2026-10-12.SHA256SUMS
    m=$(grep -c ' 1b-stage3-astryx-2026-10-12/' "$a")
    n=$((n + m)); bad=$((bad + $( (cd "$BENCH/live/runs" && grep ' 1b-stage3-astryx-2026-10-12/' "$a" | sha256sum -c 2>&1) | grep -vc ': OK$')))
  fi
  echo "evidence checksums: $n entries, $bad not OK"
  [ "$bad" -eq 0 ] || fail "evidence checksums"

  # The run directory is exactly window K-1's committed copy, with nothing open, nothing locked, every window stopped
  # cleanly at its cap but window 7, which stopped on its hold (the owner's exception), and the run's identity and caps
  # unchanged.
  w=$SP/snapshot; rm -rf "$w"; mkdir -p "$w"; git archive "$SNAPSHOT_COMMIT" "evidence/blocks-1b/$N" | tar -x -C "$w"
  if diff -r "$w/evidence/blocks-1b/$N" "$RUNDIR" > /dev/null; then echo "run directory identical to window $((K - 1))'s copy at $SNAPSHOT_COMMIT"; else fail "the run directory differs from window $((K - 1))'s copy at $SNAPSHOT_COMMIT"; fi
  [ ! -e "$RUNDIR/run.lock" ] && echo "no run.lock" || fail "the run directory holds a run.lock"
  python3 -I - "$RUNDIR" "$K" "$BUILD" "$CODE" "$DIGEST" <<'EOF' || ok=0
import json, os, re, sys
R, K, build, code, digest = sys.argv[1], int(sys.argv[2]), *sys.argv[3:6]
# The owner's exception (2026-10-16): window 7's held request #61 and window 7's integrity stop, exactly as window 7
# left them. The gateway's log shows that request as HTTP 502 with no usage and no charge; the hold stays as it is.
HELD = "2026-10-16T00:49:32.432Z~ddbd660d-7f85-486c-b98d-d9a44e2a4dd3#61"
HELD_LINES = [
    {"at": "2026-10-16T01:02:53.697Z", "invocation": "2026-10-16T00:49:32.432Z~ddbd660d-7f85-486c-b98d-d9a44e2a4dd3", "request": HELD, "usd": 0.516096},
    {"at": "2026-10-16T01:02:59.321Z", "invocation": "2026-10-16T00:49:32.432Z~ddbd660d-7f85-486c-b98d-d9a44e2a4dd3", "request": HELD,
     "final": 1.118208, "adjust": 0.6021120000000001, "reason": "usage not verified", "servedModel": "claude-haiku-4-5-20251001"},
]
W7_STOP = {"reason": "integrity", "message": "usage-missing: a refine call (provider-error) reached the provider without reporting its input tokens as a whole count, so the run cannot meter it"}
led = [json.loads(x) for x in open(f"{R}/requests.jsonl") if x.strip()]
res = {x["request"] for x in led if "adjust" not in x}
fin = {x["request"]: x for x in led if "adjust" in x}
committed = sum(round(f["final"] * 1e9) for f in fin.values())
held = [r for r, f in fin.items() if f["reason"] not in ("settled at the reported usage", "refused before any provider call")]
models = {f.get("servedModel") for f in fin.values() if f["reason"] == "settled at the reported usage"}
m = json.load(open(f"{R}/manifest.json"))
pacing = [json.loads(x) for x in open(f"{R}/pacing.jsonl") if x.strip()]
stops = [(p.get("stopped") or {}).get("reason") for p in pacing]
pre = [f for f in os.listdir(R) if re.fullmatch(r"preflight(\.resume-\d+)?\.json", f)]
exception = held == [HELD] and [x for x in led if x["request"] == HELD] == HELD_LINES and len(pacing) == 7 and pacing[6].get("stopped") == W7_STOP
print(f"run so far: {len(res)} requests, {len(fin)} finalized, open {sorted(res - set(fin)) or 'none'}, held {held or 'none'}, committed ${committed / 1e9:.8f}; caps {m['limits']}; "
      f"remaining ${(round(m['limits']['maxTotalUsd'] * 1e9) - committed) / 1e9:.8f} and {m['limits']['maxTotalRequests'] - len(res)} requests; "
      f"windows {len(pacing)}, stops {stops}; preflights {len(pre)}; served models {sorted(models)}; build {m['deployment']['buildId']}; code {m['code']['sha256'][:12]}…; corpus {m['corpus']['sha256'][:12]}…")
print(f"the owner's exception: window 7's held request #61 ({HELD_LINES[1]['reason']}, ${HELD_LINES[1]['final']}) and window 7's integrity stop, "
      f"exactly as window 7 left them, and nothing else held or stopped: {exception}")
ok = (len(res) == len(fin) and exception and models == {"claude-haiku-4-5-20251001"}
      and m["limits"] == {"maxTotalRequests": 1275, "maxTotalUsd": 77} and committed < 77 * 10**9 and len(res) < 1275
      and m["deployment"]["buildId"] == build and m["code"]["sha256"] == code and m["corpus"]["sha256"] == digest
      and (m.get("servedModel") or {}).get("id") == "claude-haiku-4-5-20251001"
      and len(pacing) == K - 1 and stops == ["cap"] * (K - 2) + ["integrity"] and len(pre) == K - 1)
if not ok:
    print(f"FAIL: the run is not the preserved state of windows 1 to {K - 1} under the owner's exception")
sys.exit(0 if ok else 1)
EOF

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

  # The resume command through the harness's own parser, selection check, frozen pin and planner; digest and identity.
  if [ ! -e "$SP/plan-check.mts" ]; then git show "$SNAPSHOT_COMMIT:evidence/blocks-1b/$N.window-2.plan-check.mts" > "$SP/plan-check.mts" 2>/dev/null || git show "origin/claude/blocks-stage3-shadcn-evidence:evidence/blocks-1b/$N.window-2.plan-check.mts" > "$SP/plan-check.mts"; fi
  (cd "$BENCH" && timeout 300 npx tsx "$SP/plan-check.mts" "$N" 2>&1 | grep -v -e EHPA -e trace-warnings) > "$SP/plan-$MODE.txt"
  cat "$SP/plan-$MODE.txt"
  python3 -I - "$SP/plan-$MODE.txt" "$DIGEST" "$CODE" "$RUNREL" <<'EOF' || ok=0
import json, sys
lines = open(sys.argv[1]).read().splitlines()
p = json.loads(next(l for l in lines if l.startswith("{")))
code = next((l.split()[-1] for l in lines if l.startswith("code identity ")), None)
want = {"cells": 480, "references": ["shadcn-v3"], "corpus": "blocks-1b v2", "digest": sys.argv[2], "frozen": True, "scoring": "binding",
        "maxTotalUsd": 77, "maxTotalRequests": 1275, "maxRequests": 123, "spacingMs": 12000, "out": None, "resume": sys.argv[4], "rerunFailed": False}
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
  [ "$pf" -eq $((K - 1)) ] || fail "the run should hold exactly $((K - 1)) preflights before window $K"

  # The operator's record of the invocations so far, from window K-1's copy.
  git show "$SNAPSHOT_COMMIT:evidence/blocks-1b/$N.invocations.txt" > "$SP/invocations.expected"
  if [ ! -e "$SP/invocations.txt" ]; then cp "$SP/invocations.expected" "$SP/invocations.txt"; fi
  cmp -s "$SP/invocations.txt" "$SP/invocations.expected" && echo "operator record holds invocations 1 to $((K - 1)): $(grep -c ' end ' "$SP/invocations.txt") ended" || fail "the operator record differs from window $((K - 1))'s copy"
  date -u +"checks ended %FT%TZ"
} > "$PRE" 2>&1
cat "$PRE"
if [ "$ok" -ne 1 ]; then echo "NOT LAUNCHED: a check failed"; exit 1; fi
if [ "$MODE" != launch ]; then echo "EVERY CHECK PASSED (check mode: nothing launched)"; exit 0; fi

# The launch: the readiness packet's frozen command with --resume, and its monitor with --preflights K, from
# packages/block-bench, without job control, so that $! is the new session's process group.
cd "$BENCH" || exit 2
setsid bash -c '
  echo "invocation $2 start $(date -u +%FT%TZ)" >> "$1/invocations.txt"
  NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --corpus 2 --reference shadcn-v3 \
    --prompts rt-01,rt-02,rt-03,rt-04,rt-05,rt-06,af-01,af-02,af-03,af-04,af-05,af-06,gs-01,gs-02,gs-03,gs-04,gs-05,gs-06,nb-01,nb-02,nb-03,nb-04,nb-05,nb-06 \
    --max-total-usd 77 --max-total-requests 1275 --max-requests 123 --spacing-ms 12000 \
    --resume live/runs/1b-stage3-shadcn-2026-10-15 > "$1/invocation-$2.log" 2>&1
  code=$?
  echo "invocation $2 end $(date -u +%FT%TZ) exit $code" >> "$1/invocations.txt"
' _ "$SP" "$K" < /dev/null > /dev/null 2>&1 &
HPG=$!
# The owner's stop at any new provider failure, beside the frozen monitor, which allows one a window: it follows the
# monitor's events log and signals only the group the monitor shows the harness inside. 7 pacing lines precede window 8.
bash "$SCRATCH/v4/provider-failure-stop.sh" "$SP/monitor-events-$K.log" "$HPG" "$RUNDIR/pacing.jsonl" 7 "$SP/provider-failure-stop.txt" < /dev/null > /dev/null 2>&1 &
WPID=$!
python3 -I "$TOOLING"/monitor_run.py --run live/runs/1b-stage3-shadcn-2026-10-15 --pgid "$HPG" --preflights "$K" \
  --config "$TOOLING"/monitor-shadcn.json --corpus live/corpora/blocks.v2.json --events "$SP/monitor-events-$K.log"
echo "monitor exit $? at $(date -u +%FT%TZ)" | tee -a "$SP/monitor-exit.txt"
wait "$WPID"
echo "provider-failure stop exit $? at $(date -u +%FT%TZ)" | tee -a "$SP/monitor-exit.txt"
