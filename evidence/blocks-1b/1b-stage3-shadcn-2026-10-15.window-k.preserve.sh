#!/usr/bin/env bash
# Window K's copy (3 or later): the run directory byte-identical as window K left it, with window K's operator files,
# added to the shadcn evidence branch's worktree (made from origin if it is missing). Refuses while a harness or monitor
# still runs. Commits nothing by itself.
#   shadcn-preserve.sh <K>
set -eu
K=${1:?window number}
SCRATCH=/tmp/claude-0/-home-user/870d30cc-3b6b-550c-bdac-b13bd5711164/scratchpad
OP=$SCRATCH/v4/shadcn-w$K
REPO=/home/user/dspack-studio
N=1b-stage3-shadcn-2026-10-15
RUN=$REPO/packages/block-bench/live/runs/$N
WT=$SCRATCH/evidence-stage3-shadcn
BR=claude/blocks-stage3-shadcn-evidence
if pgrep -f "live/run.ts|monitor_run.py" > /dev/null; then echo "a harness or monitor still runs: nothing preserved"; exit 1; fi
cd "$REPO"
git fetch -q origin "$BR"
if [ ! -d "$WT" ]; then git worktree add -q -B "$BR" "$WT" "origin/$BR"; fi
cd "$WT"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BR")" ] || { echo "the evidence worktree is not at origin's head"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "the evidence worktree is not clean"; exit 1; }
D=$WT/evidence/blocks-1b
rm -rf "${D:?}/$N" && cp -rp "$RUN" "$D/"
cp -p "$OP/invocations.txt" "$D/$N.invocations.txt"
cp -p "$OP/invocation-$K.log" "$D/$N.invocation-$K.log"
cp -p "$OP/monitor-events-$K.log" "$D/$N.monitor-events-$K.log"
cp -p "$OP/preresume-checks.txt" "$D/$N.window-$K.preresume-checks.txt"
cp -p "$OP/launch-console.txt" "$D/$N.window-$K.launch-console.txt"
python3 -I - "$OP/probe-launch.log" "$D/$N.window-$K.preresume-probe.json" <<'EOF'
import json, sys
text = open(sys.argv[1]).read()
probe = json.loads(text[text.index("{"):text.rindex("}") + 1])
with open(sys.argv[2], "w") as f:
    json.dump(probe, f, indent=2)
    f.write("\n")
EOF
diff -r "$RUN" "$D/$N" && echo "the copy is byte-identical to $RUN"
cd "$D"
TMP=$(mktemp)
{
  find "$N" -type f | LC_ALL=C sort | xargs sha256sum
  ls "$N".* | grep -v -E "^$N\.SHA256SUMS$" | LC_ALL=C sort | xargs sha256sum
  sha256sum reconcile_window.py
} > "$TMP"
mv "$TMP" "$N.SHA256SUMS"
chmod 644 "$N.SHA256SUMS"
sha256sum -c "$N.SHA256SUMS" --quiet && echo "$(grep -c '' "$N.SHA256SUMS") checksum entries verify"
cd "$WT" && git status --short
