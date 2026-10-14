#!/usr/bin/env python3
"""Independent verification of a Phase 1B hosted run of any number of invocations, from its preserved artifacts alone.

The generalization of verify_stage3.py (the Astryx Stage-3 run's verifier, two invocations), which stays as it was
committed. Nothing here imports, runs or reads the harness's code, and nothing reads analyze.mjs. Every figure is
recomputed from the raw files (manifest.json, the preflights, requests.jsonl, runs.jsonl, runs.superseded.jsonl,
pacing.jsonl, summary.json) and the frozen corpus, following the written definitions (ADR-B3, its addendum and
amendment 2), and compared with what the harness wrote. Every disagreement is a finding; the run verifies only when
there are none.

What it checks, for any number of invocations:
- identity: the corpus is the one given and the one the manifest pins; every invocation's preflight names the
  manifest's deployment (base URL, build id, Worker shape), the same models and sidecars; one model is measured (a
  resume may set aside a served model no record shows measured only if it is the model expected);
- history: each window's preserved copy of the run directory (--snapshot, oldest first) is a prefix of what came
  after it, file by file, and the identity files never change; a re-run moves records aside, never deletes them;
- the ledger, request by request: consecutive ids per invocation, one request at a time, every settlement's arithmetic
  in whole nanodollars, releases at nothing, holds at no less than their reservation nor the most one call can cost
  (the least the harness holds a reply it cannot trust at), a request an invocation left open raised to the most a
  request can cost by the first process after it to write to the ledger (the next invocation, or a launch the harness
  refused that raised it before refusing), the caps, each invocation's own count, and a cap stop that was due;
- the cells: the planned grid once each at the end, every invocation running the cells left to do in their planned
  order, so a resume skips nothing and repeats nothing, a cell a stopped invocation abandoned repeated from its
  beginning, a re-run replacing exactly the records it moved aside;
- each invocation's cells against its requests, one by one, what each settled at against what its calls reported, and
  the requests no logged cell made (an abandoned cell's) only at the end of an invocation that stopped inside a cell;
- each invocation's backoffs against its refusals: each refused request waits the next step of the schedule, a request
  refused through the whole schedule fails its cell, and nothing else waits;
- the surfaces, parity (recomputed from each surface and its checklist), the add and remove check, binding scoring,
  the arm statistics, the ADR-B3 decision and its reasons and paired cluster bootstrap (as specified, and again with an
  independent generator and many seeds), every operation-sensitivity reading, selection, retention and the
  named-against-positional comparison, against summary.json field by field (no entry the records do not make, and
  every one they do), and the verdict REPORT.md states;
- with --monitor-events, each monitored window's events log against the run: the window it watched, every request it
  saw, its stops, and a live build read and logged at least every few build-check intervals, all the baseline's; with
  --monitor-config, every window has a log, and each ran with that configuration's limits.

A run between windows verifies too: a window stopped from outside leaves no pacing entry, perhaps no summary.json,
perhaps a request in flight (raised by the next resume), and arms and conditions with no record yet. summary.json is
an invocation's last write, so a stop inside that invocation's shutdown can leave an earlier one's: that is reported,
and a finding for a run that must be complete.

Usage:
  python3 -I verify_run.py --run <run dir> --corpus <corpus json> --out <out json>
      [--snapshot <dir>]...      the run directory as each invocation but the last left it, oldest first
      [--invocations <file>]     the operator's record of each invocation's start, end and exit code (invocations.txt);
                                 a launch the harness refused is recorded as "refused launch after invocation <k>: ..."
      [--monitor-events <file>]...  a window's monitor_run.py events log
      [--monitor-config <file>]  the monitor configuration every window ran with (monitor-shadcn.json)
      [--expect-build <id>] [--expect-model <id>] [--expect-code <sha256>] [--expect-corpus <sha256>]
      [--expect-max-requests <n>]  every invocation that ended by itself ran with --max-requests n
      [--parity-reading arrays|no-arrays]  how the run's code read a surface's text: arrays (the default, code from
                                 aestheticfunction/dspack-studio#102 on) or no-arrays (before it, as the Astryx run's)
      [--complete]               the run must be finished: every planned cell once, the last invocation ended cleanly
      [--partial-history]        a missing window copy is reported, not a finding
      [--quick]                  skip the 200-seed and 20,000-resample bootstrap robustness checks
"""
import argparse
import hashlib
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

ap = argparse.ArgumentParser(description="Verify a Phase 1B hosted run of any number of invocations.")
ap.add_argument("--run", required=True)
ap.add_argument("--corpus", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--snapshot", action="append", default=[])
ap.add_argument("--invocations")
ap.add_argument("--monitor-events", action="append", default=[])
ap.add_argument("--monitor-config")
ap.add_argument("--expect-max-requests", type=int)
ap.add_argument("--parity-reading", choices=["arrays", "no-arrays"], default="arrays")
ap.add_argument("--expect-build")
ap.add_argument("--expect-model", default="claude-haiku-4-5-20251001")
ap.add_argument("--expect-code")
ap.add_argument("--expect-corpus")
ap.add_argument("--complete", action="store_true")
ap.add_argument("--partial-history", action="store_true")
ap.add_argument("--quick", action="store_true")
A = ap.parse_args()
RUN = A.run

# Claude Haiku 4.5 list prices, $1 and $5 per million tokens, with Cloudflare's 5% credit fee, in whole nanodollars.
NANO_IN, NANO_OUT = 1050, 5250
# The most any request can cost (live/cost.ts REQUEST_USD_BOUND): two calls, each at the model's documented 204,800
# input tokens and 65,536 output tokens.
REQUEST_BOUND_NANO = 2 * (204_800 * NANO_IN + 65_536 * NANO_OUT)
# The most one call can cost (live/cost.ts absoluteUsd(1)): the least the harness holds a reply it cannot trust at.
CALL_BOUND_NANO = 204_800 * NANO_IN + 65_536 * NANO_OUT
# The most requests one cell makes (live/cost.ts CELL_REQUESTS): its plan and three generation requests.
CELL_REQUESTS = 4
MODEL = A.expect_model
PRICED = re.compile(r"^(?:(?:anthropic/)?claude-haiku-4\.5|claude-haiku-4-5(?:-\d{8})?)$")
ADD_REMOVE = {"refine-add", "refine-remove"}
ALL_ARMS = ["block", "block-positional", "capped", "production"]
DECISION_ARMS = ["block", "capped", "production"]
ALL_CONDITIONS = ["fresh", "refine-content", "refine-add", "refine-remove", "refine-structural"]
SETTLED, RELEASED, UNVERIFIED = "settled at the reported usage", "refused before any provider call", "usage not verified"
NEVER_READ = "a request whose reply was never read"
LOGS = ["requests.jsonl", "pacing.jsonl", "runs.superseded.jsonl", "runs.torn.jsonl"]

findings = []  # disagreements and integrity issues: the verification passes only if this stays empty
notes = []  # what is reported without failing the run
info = {}


def finding(message):
    findings.append(message)


def note(message):
    notes.append(message)


def read_bytes(path):
    if not os.path.exists(path):
        return b""
    with open(path, "rb") as f:
        return f.read()


TORN = []  # the logs whose last line is cut off (a process stopped while writing it): the next resume sets it aside


def jl(path):
    """A JSON-lines log's whole lines. A cut-off last line is set aside, as the next resume sets it aside, and
    reported; a line in the middle that is not JSON is a finding."""
    text = read_bytes(path).decode("utf-8")
    lines = text.split("\n")
    tail = lines.pop()
    if tail.strip():
        TORN.append(path)
    out = []
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            findings.append(f"{path}: line {i} is not JSON")
    return out


def jload(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sha256_file(path):
    return hashlib.sha256(read_bytes(path)).hexdigest()


def ratio(part, whole):
    return None if whole == 0 else part / whole


def mean(values):
    return None if not values else sum(values) / len(values)


def median(values):
    if not values:
        return None
    s = sorted(values)
    m = len(s) // 2
    return s[m] if len(s) % 2 == 1 else (s[m - 1] + s[m]) / 2


def close(a, b, tol=1e-9):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def js_stringify(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def js_num(x):
    """A number as JavaScript prints it in a template string, for the values the reasons print (30, 5)."""
    return str(int(x)) if float(x).is_integer() and abs(x) < 1e21 else repr(float(x))


def to_fixed1(x):
    """Number.prototype.toFixed(1): the exact value, rounded half away from zero."""
    return str(Decimal(x).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


nano = lambda usd: round(usd * 1e9)  # the ledger counts whole nanodollars
cell = lambda r: f"{r['arm']}|{r['prompt']}|{r['condition']}"
key_of = lambda r: (r["reference"], r["arm"], r["prompt"], r["condition"])


# --- 1. Files and identity ------------------------------------------------------------------------------------------
def inventory(d):
    out = {}
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            data = read_bytes(p)
            out[name] = {"bytes": len(data), "lines": data.count(b"\n"), "sha256": hashlib.sha256(data).hexdigest()}
    return out


info["files"] = inventory(RUN)
manifest = jload(os.path.join(RUN, "manifest.json"))
# summary.json is the last thing an invocation writes as it ends: a first window stopped from outside leaves none.
summary_file = jload(os.path.join(RUN, "summary.json")) if os.path.exists(os.path.join(RUN, "summary.json")) else None
S = (summary_file or {}).get("summary") or {}
with open(A.corpus, encoding="utf-8") as f:
    corpus = json.load(f)
corpus_digest = hashlib.sha256(js_stringify(corpus).encode("utf-8")).hexdigest()
corpus_prompts = {p["id"]: p for p in corpus["prompts"]}

pinned = manifest["corpus"]
if corpus_digest != pinned["sha256"] or corpus["corpus"] != pinned["id"] or corpus["version"] != pinned["version"] or corpus["frozenAt"] != pinned["frozenAt"]:
    finding(f"corpus: the file given is {corpus['corpus']} v{corpus['version']} frozen {corpus['frozenAt']} ({corpus_digest[:12]}), the run pins {pinned['id']} v{pinned['version']} frozen {pinned['frozenAt']} ({pinned['sha256'][:12]})")
if A.expect_corpus and pinned["sha256"] != A.expect_corpus:
    finding(f"corpus: the run pins {pinned['sha256']}, expected {A.expect_corpus}")
if A.expect_code and manifest["code"]["sha256"] != A.expect_code:
    finding(f"code: the run's code identity is {manifest['code']['sha256']}, expected {A.expect_code}")
deployment = manifest["deployment"]
if A.expect_build and deployment["buildId"] != A.expect_build:
    finding(f"deployment: the run's build id is {deployment['buildId']}, expected {A.expect_build}")
if deployment["worker"] != "per-call-model":
    finding(f"deployment: the Worker is {deployment['worker']}, not per-call-model")
served = (manifest.get("servedModel") or {}).get("id")
if served != MODEL:
    finding(f"model: the manifest records {served!r} as the model measured, expected {MODEL}")
# A resume sets aside a served model no record shows measured; the run then records the next one a reply reports.
for entry in manifest.get("setAside") or []:
    aside = ((entry or {}).get("servedModel") or {}).get("id")
    if aside != MODEL:
        finding(f"model: a resume set aside {aside!r}, not the model expected ({MODEL}): a reply on it came back")
    else:
        note(f"model: a resume set aside the served model {aside} (no record showed it measured), the model expected")
REFERENCES = [r["id"] for r in manifest["references"]]
PROVIDER_ID, _, BASE = manifest["provider"].partition("@")
if BASE != deployment["baseUrl"]:
    finding(f"provider {manifest['provider']} names another origin than the deployment's {deployment['baseUrl']}")
sel = manifest["selection"]
ARMS = [a for a in ALL_ARMS if a in sel["arms"]]
CONDITIONS = [c for c in ALL_CONDITIONS if c in sel["conditions"]]
OPTIONS = manifest["decision"]
info["identity"] = {"corpus": pinned, "corpusFileSha256": corpus_digest, "code": manifest["code"], "deployment": deployment, "servedModel": manifest.get("servedModel"), "provider": manifest["provider"], "references": REFERENCES}


# The planned cells, in the harness's order (live/evaluate.ts planCells).
def planned_cells():
    out = []
    for ref in REFERENCES:
        prompts = [p for p in corpus["prompts"] if isinstance(p["intent"].get(ref), str)]
        if sel["promptIds"] is not None:
            prompts = [p for p in prompts if p["id"] in sel["promptIds"]]
        if sel["blocks"] is not None:
            prompts = [p for p in prompts if (p["block"] or "null") in sel["blocks"]]
        if sel["limit"] is not None:
            prompts = prompts[: sel["limit"]]
        for p in prompts:
            for arm in sel["arms"]:
                for c in ALL_CONDITIONS:
                    if c in sel["conditions"]:
                        out.append((ref, arm, p["id"], c))
    return out


PLANNED = planned_cells()
PLANNED_INDEX = {k: i for i, k in enumerate(PLANNED)}
info["planned"] = len(PLANNED)


# --- 2. Invocations -------------------------------------------------------------------------------------------------
def preflights_of(d):
    """The run's preflights in invocation order: preflight.json, then preflight.resume-1.json, -2, ..."""
    out = [jload(os.path.join(d, "preflight.json"))] if os.path.exists(os.path.join(d, "preflight.json")) else []
    resumes = sorted(int(m.group(1)) for m in (re.fullmatch(r"preflight\.resume-(\d+)\.json", n) for n in os.listdir(d)) if m)
    if resumes != list(range(1, len(resumes) + 1)):
        finding(f"{d}: the resume preflights are not numbered 1 to {len(resumes)}: {resumes}")
    return out + [jload(os.path.join(d, f"preflight.resume-{k}.json")) for k in resumes]


preflights = preflights_of(RUN)
N = len(preflights)
inv_at = [p["at"] for p in preflights]
if inv_at != sorted(inv_at) or len(set(inv_at)) != N:
    finding("the preflights' times are not strictly increasing")
if manifest["startedAt"] != inv_at[0]:
    finding(f"the manifest's startedAt {manifest['startedAt']} is not the first preflight's {inv_at[0]}")
first = preflights[0]
for k, p in enumerate(preflights, 1):
    if p.get("baseUrl") != deployment["baseUrl"] or p.get("buildId") != deployment["buildId"] or (p.get("worker") or {}).get("shape") != deployment["worker"]:
        finding(f"invocation {k}: its preflight found {p.get('baseUrl')} build {p.get('buildId')} Worker {(p.get('worker') or {}).get('shape')}, the run is {deployment['baseUrl']} build {deployment['buildId']} Worker {deployment['worker']}")
    if p.get("models") != first.get("models"):
        finding(f"invocation {k}: the deployment lists models {p.get('models')}, the first invocation's listed {first.get('models')}")
    if p.get("sidecars") != first.get("sidecars") or p.get("drafts") != first.get("drafts"):
        finding(f"invocation {k}: the sidecars in use differ from the first invocation's")
    if p.get("drafts"):
        finding(f"invocation {k}: a sidecar in use is a draft")

ledger = jl(os.path.join(RUN, "requests.jsonl"))
pacing = jl(os.path.join(RUN, "pacing.jsonl"))
ids = []
for line in ledger:
    if line.get("invocation") not in ids:
        ids.append(line.get("invocation"))
for p in pacing:
    if p.get("id") not in ids:
        ids.append(p.get("id"))
inv_of_id = {}
# A launch the harness refused (a cap below what the run has sent, say) writes no preflight and is no invocation, but
# it may have raised a request an earlier invocation left open before it refused: its id names no preflight, and
# every line it wrote is such a raise.
refused = {}
for i in ids:
    at = str(i).split("~")[0]
    if at not in inv_at:
        written = [x for x in ledger if x.get("invocation") == i]
        if written and all(x.get("reason") == NEVER_READ for x in written) and not any(p.get("id") == i for p in pacing):
            refused[i] = written
            note(f"a launch the harness refused ({i}: no preflight, so no invocation) raised {', '.join(str(x.get('request')) for x in written)} before it refused")
        else:
            finding(f"invocation id {i} matches no preflight")
        continue
    k = inv_at.index(at) + 1
    if k in inv_of_id.values():
        finding(f"two invocation ids start at the preflight of invocation {k}")
    inv_of_id[i] = k
id_of_inv = {k: i for i, k in inv_of_id.items()}
pacing_of = {}
for p in pacing:
    k = inv_of_id.get(p.get("id"))
    if k is None:
        continue
    if k in pacing_of:
        finding(f"invocation {k} has two pacing entries")
    pacing_of[k] = p
    if p.get("at") != inv_at[k - 1]:
        finding(f"invocation {k}: its pacing entry is stamped {p.get('at')}, its preflight {inv_at[k - 1]}")
if [inv_of_id.get(p.get("id")) for p in pacing] != sorted(inv_of_id.get(p.get("id")) or 0 for p in pacing):
    finding("pacing.jsonl is not in invocation order")
schedules = {json.dumps(p["telemetry"]["pacing"]["backoffMs"]) for p in pacing}
if len(schedules) > 1:
    finding(f"the backoff schedule changed between invocations: {sorted(schedules)}")
SCHEDULE = json.loads(next(iter(schedules))) if schedules else [30000, 60000, 120000, 240000]
STEPS = len(SCHEDULE)
CELL_BOUND = CELL_REQUESTS * (1 + STEPS)

operator = {}
refused_launches = []
if A.invocations:
    for line in open(A.invocations, encoding="utf-8"):
        m = re.match(r"invocation (\d+) (start|end) (\S+)(?: (exit|signal) (\S+))?", line.strip())
        if m:
            e = operator.setdefault(int(m.group(1)), {})
            e[m.group(2)] = m.group(3)
            if m.group(4):
                e[m.group(4)] = m.group(5)
        elif line.startswith("refused launch"):
            refused_launches.append(line.strip())
    if sorted(operator) != list(range(1, N + 1)):
        finding(f"the operator's record lists invocations {sorted(operator)}, the run has {N}")
info["refusedLaunches"] = {"operator": refused_launches, "raisedBy": sorted(refused)}

# An exit by signal: the code a shell or tsx reports for SIGKILL or SIGTERM, or the signal itself.
signalled = lambda o: o.get("exit") in ("137", "143") or "signal" in o
invocations = []
for k in range(1, N + 1):
    p = pacing_of.get(k)
    status = "killed" if p is None else (p.get("stopped") or {}).get("reason") or "complete"
    e = {"invocation": k, "id": id_of_inv.get(k), "at": inv_at[k - 1], "ended": status}
    if p:
        t = p["telemetry"]["pacing"]
        e.update({"maxRequests": t["maxRequests"], "spacingMs": t["spacingMs"], "sent": t["sent"]})
        if A.expect_max_requests is not None and t["maxRequests"] != A.expect_max_requests:
            finding(f"invocation {k} ran with --max-requests {t['maxRequests']}, expected {A.expect_max_requests}")
    o = operator.get(k)
    if o:
        e["operator"] = o
        if status == "killed":
            ok = "exit" not in o or signalled(o)
        else:
            ok = o.get("exit") == {"complete": "0", "cap": "0", "integrity": "3", "error": "1"}[status]
            if not ok and signalled(o):
                # A signal inside the harness's synchronous shutdown (summary, then pacing.jsonl, then summary.json, then
                # REPORT.md) ends it there; its pacing entry is written, its summary perhaps not (checked below).
                ok = True
                e["signalledInShutdown"] = True
                note(f"invocation {k}: the operator recorded {o.get('exit') or o.get('signal')}, a signal, but it wrote its pacing entry ({status}): the signal reached it in its shutdown, after its stop was on the record")
        if not ok:
            finding(f"invocation {k}: the operator recorded {o}, but the run shows it {status}")
    invocations.append(e)
if pacing_of.get(N) is None:
    (finding if A.complete else note)(f"the last invocation ({N}) left no pacing entry: it was stopped from outside, and summary.json, if any, is an earlier invocation's")
elif A.complete and (pacing_of[N].get("stopped") is not None):
    finding(f"the last invocation stopped ({pacing_of[N]['stopped']['reason']}): the run is not complete")
for k in range(1, N):
    if pacing_of.get(k) and not (pacing_of[k].get("stopped")):
        note(f"invocation {k} ended complete, and another invocation followed it")

# Whose summary.json this is: an invocation writes it as it ends, after its pacing entry, listing every pacing entry up
# to its own. It is the last invocation's own only if that invocation wrote one; the figures are compared only then.
LAST_ENDED = max(pacing_of, default=None)  # the last invocation with a pacing entry
summary_owner = None
if summary_file is None:
    if LAST_ENDED is not None:
        cut = invocations[LAST_ENDED - 1].get("signalledInShutdown")
        (finding if A.complete or not cut else note)(f"summary.json: none, though invocation {LAST_ENDED} wrote its pacing entry: its shutdown did not finish")
    else:
        (finding if A.complete else note)("summary.json: none yet; no invocation has ended by itself (the first window was stopped from outside)")
else:
    listed = [x.get("id") for x in summary_file.get("invocations") or []]
    if listed and listed == [p.get("id") for p in pacing[: len(listed)]]:
        summary_owner = inv_of_id.get(listed[-1])
    else:
        finding("summary.json: the invocations it lists are not the run's first pacing entries")
    if summary_owner is not None and summary_owner != LAST_ENDED:
        cut = invocations[LAST_ENDED - 1].get("signalledInShutdown")
        (finding if A.complete or not cut else note)(f"summary.json is invocation {summary_owner}'s, but invocation {LAST_ENDED} ended after it with a pacing entry and no summary.json of its own: its shutdown did not finish")
SUMMARY_CURRENT = summary_owner is not None and summary_owner == N and summary_owner == LAST_ENDED
info["summaryOf"] = summary_owner


# --- 3. History: each window's copy against what came after it ------------------------------------------------------
def whole_lines(data):
    cut = data.rfind(b"\n") + 1
    return data[:cut], data[cut:]


def lines_of(data):
    return [line for line in data.decode("utf-8").split("\n") if line.strip()]


IDENTITY_FIELDS = ["runId", "startedAt", "provider", "corpus", "references", "code", "model", "deployment", "selection", "decision"]


def compare_states(a_dir, b_dir, label, since=None):
    """b_dir must extend a_dir: append-only logs, identity files unchanged, runs.jsonl less only what a re-run moved.
    Across several invocations (no copy between them), a re-run may also move aside a record logged in between: one
    stamped at or after `since`, the first of them's preflight."""
    for name in ["preflight.json"] + [n for n in sorted(os.listdir(a_dir)) if n.startswith("preflight.resume-")]:
        if not os.path.exists(os.path.join(b_dir, name)) or sha256_file(os.path.join(a_dir, name)) != sha256_file(os.path.join(b_dir, name)):
            finding(f"{label}: {name} changed or vanished")
    ma, mb = jload(os.path.join(a_dir, "manifest.json")), jload(os.path.join(b_dir, "manifest.json"))
    for f_ in IDENTITY_FIELDS:
        if ma.get(f_) != mb.get(f_):
            finding(f"{label}: the manifest's {f_} changed")
    if ma.get("servedModel") and ma.get("servedModel") != mb.get("servedModel"):
        finding(f"{label}: the manifest's servedModel changed")
    if (mb.get("setAside") or [])[: len(ma.get("setAside") or [])] != (ma.get("setAside") or []):
        finding(f"{label}: the manifest's setAside lost an entry")
    la, lb = ma.get("limits") or {}, mb.get("limits") or {}
    changes_a, changes_b = la.get("changes") or [], lb.get("changes") or []
    if changes_b[: len(changes_a)] != changes_a:
        finding(f"{label}: the manifest's limit changes were rewritten")
    for unit, field in ((None, "maxTotalRequests"), ("usd", "maxTotalUsd")):
        if la.get(field) != lb.get(field) and not any(c.get("unit") == unit and c.get("to") == lb.get(field) for c in changes_b[len(changes_a):]):
            finding(f"{label}: the manifest's {field} changed from {la.get(field)} to {lb.get(field)} with no change on the record")
    moved = []
    for name in LOGS:
        before, torn = whole_lines(read_bytes(os.path.join(a_dir, name)))
        after = read_bytes(os.path.join(b_dir, name))
        if torn:
            finding(f"{label}: {name} ends with a cut-off line; check it by hand")
        if not after.startswith(before):
            finding(f"{label}: {name} is not an extension of the earlier copy")
        elif name == "runs.superseded.jsonl":
            moved = lines_of(after[len(before):])
    before, torn = whole_lines(read_bytes(os.path.join(a_dir, "runs.jsonl")))
    if torn:
        finding(f"{label}: runs.jsonl ends with a cut-off line; check it by hand")
    kept = lines_of(before)
    for line in moved:
        if line in kept:
            kept.remove(line)
        elif since is None or str(json.loads(line).get("at", "")) < since:
            finding(f"{label}: a record moved aside by a re-run was not in the earlier runs.jsonl")
    after = lines_of(read_bytes(os.path.join(b_dir, "runs.jsonl")))
    if after[: len(kept)] != kept:
        finding(f"{label}: runs.jsonl does not keep the earlier records, less those a re-run moved aside, in their order")
    return {"kept": kept, "moved": moved, "new": after[len(kept):] if after[: len(kept)] == kept else []}


snaps = []
for d in A.snapshot:
    snaps.append((len(preflights_of(d)), d))
snaps.sort()
covered = [n_ for n_, _ in snaps]
if len(set(covered)) != len(covered):
    finding(f"two window copies hold the same number of invocations: {covered}")
for n_, d in snaps:
    if not 1 <= n_ < N:
        finding(f"window copy {d} holds {n_} invocations; the run has {N}")
missing = [k for k in range(1, N) if k not in covered]
if missing:
    (note if A.partial_history else finding)(f"no window copy after invocation(s) {missing}: the history before them is not checked against a copy")
states = [(0, None)] + [(n_, d) for n_, d in snaps if 1 <= n_ < N] + [(N, RUN)]
history = []
logged_lines = {}  # invocation -> the records it logged, in order, as text (from the window copies)
moved_at = {}  # invocation -> the records a re-run moved aside at its start
for (na, da), (nb, db) in zip(states, states[1:]):
    label = f"invocations {na + 1}..{nb}" if nb > na + 1 else f"invocation {nb}"
    if da is None:
        new = lines_of(read_bytes(os.path.join(db, "runs.jsonl")))
        if nb == N:
            new = None  # without a copy, what each invocation logged is read from the times below
        rel = {"kept": [], "moved": [], "new": new}
    else:
        rel = compare_states(da, db, label, since=inv_at[na] if nb > na + 1 else None)
        # The copy itself must hold exactly the invocations it says, and the later state must agree with it on them.
        pa = jl(os.path.join(da, "pacing.jsonl"))
        if [p.get("id") for p in pa] != [p.get("id") for p in pacing[: len(pa)]]:
            finding(f"{label}: the earlier copy's pacing entries are not the run's first ones")
    history.append({"from": na, "to": nb, "kept": len(rel["kept"]), "moved": len(rel["moved"]), "new": None if rel["new"] is None else len(rel["new"])})
    if nb == na + 1 and rel["new"] is not None:
        logged_lines[nb] = rel["new"]
        moved_at[nb] = rel["moved"]
info["history"] = {"copies": [{"invocations": n_, "dir": d} for n_, d in snaps], "steps": history}

# --- 4. The ledger --------------------------------------------------------------------------------------------------
# Every process that wrote to the ledger, by its time: each invocation, and each launch the harness refused that raised.
WRITERS = sorted({(str(x.get("invocation")).split("~")[0], x.get("invocation")) for x in ledger if isinstance(x.get("invocation"), str)})


def first_writer_after(at):
    return next((i for t_, i in WRITERS if t_ > at), None)


def describe(invocation):
    if invocation in inv_of_id:
        return f"invocation {inv_of_id[invocation]}"
    return f"a refused launch ({invocation})" if invocation in refused else f"{invocation!r}"


reserves, finals, order = {}, {}, []
line_of = {}
last_at = ""
for i, line in enumerate(ledger):
    if line.get("at", "") < last_at:
        finding(f"requests.jsonl line {i + 1}: time goes backwards")
    last_at = line.get("at", last_at)
    req = line.get("request")
    owner = inv_of_id.get(line.get("invocation"))
    if not isinstance(req, str) or "#" not in req:
        finding(f"requests.jsonl line {i + 1}: no request id")
        continue
    req_owner = inv_of_id.get(req.split("#")[0])
    if "adjust" in line:
        if req in finals:
            finding(f"{req}: finalized twice")
        if req not in reserves:
            finding(f"{req}: finalized before it was reserved")
        if line.get("reason") == NEVER_READ:
            # Written for a request an invocation left open by the first process after it to write to the ledger,
            # which raises every request it finds open: the next invocation, or a launch the harness refused after
            # raising it, or a later one if those between them died before writing anything.
            raiser = line.get("invocation")
            expected = first_writer_after(inv_at[req_owner - 1]) if req_owner is not None else None
            if req_owner is None:
                finding(f"{req}: raised as never read, but no invocation sent it")
            elif raiser != expected:
                finding(f"{req}: left open by invocation {req_owner}, raised as never read by {describe(raiser)}, not by the first process after it to write to the ledger ({describe(expected)})")
        elif owner != req_owner:
            finding(f"requests.jsonl line {i + 1}: {req} settled by another invocation")
        finals[req] = line
        line_of[(req, "final")] = i
    elif set(line) == {"at", "invocation", "request", "usd"}:
        if req in reserves:
            finding(f"{req}: reserved twice")
        if owner != req_owner:
            finding(f"requests.jsonl line {i + 1}: request id does not belong to its invocation")
        reserves[req] = line
        order.append(req)
        line_of[(req, "reserve")] = i
    else:
        finding(f"requests.jsonl line {i + 1}: unrecognized line {sorted(line)}")

by_inv = defaultdict(list)
for req in order:
    by_inv[inv_of_id.get(reserves[req]["invocation"])].append(req)
ledger_invs = [inv_of_id.get(reserves[r]["invocation"]) for r in order]
if ledger_invs != sorted(ledger_invs, key=lambda k: k or 0):
    finding("requests.jsonl interleaves invocations")
unsent = {}  # invocation -> its last request, recorded but never sent (it stopped between the two)
for k, reqs in by_inv.items():
    for n_, req in enumerate(reqs, 1):
        if req != f"{id_of_inv.get(k)}#{n_}":
            finding(f"{req}: request numbers are not consecutive within invocation {k}")
    p = pacing_of.get(k)
    if p is not None:
        t = p["telemetry"]["pacing"]
        last_final = finals.get(reqs[-1]) if reqs else None
        if t["sent"] == len(reqs) - 1 and (p.get("stopped") or {}).get("reason") == "error" and (last_final is None or (last_final.get("reason") == NEVER_READ and inv_of_id.get(last_final.get("invocation")) != k)):
            # A lost lock, or a reservation whose line reached the disk but could not be synced, stops the invocation
            # after the request's line is written and before it is counted or sent; the next resume raises it.
            unsent[k] = reqs[-1]
            note(f"invocation {k}: its last request {reqs[-1]} was recorded but never sent ({p['stopped']['message'][:80]}...)")
        elif t["sent"] != len(reqs):
            finding(f"invocation {k}: its pacing says {t['sent']} sent, the ledger holds {len(reqs)}")
        if len(reqs) - (1 if k in unsent else 0) > t["maxRequests"]:
            finding(f"invocation {k}: {len(reqs)} requests, past its cap of {t['maxRequests']}")
for k in range(1, N + 1):
    if pacing_of.get(k) is not None and pacing_of[k]["telemetry"]["pacing"]["sent"] > 0 and not by_inv.get(k):
        finding(f"invocation {k} reported requests the ledger does not hold")
    # A raise for a request left open is the first thing the next invocation writes.
    raises = [i for i, l in enumerate(ledger) if l.get("reason") == NEVER_READ and inv_of_id.get(l.get("invocation")) == k]
    own = [line_of[(r, "reserve")] for r in by_inv.get(k, [])]
    if raises and own and max(raises) > min(own):
        finding(f"invocation {k} raised a request left open after it had sent its own")

# One request at a time: each is finalized before the next is reserved; only a killed or broken invocation's last
# request may be left for the next invocation to raise.
for a, b in zip(order, order[1:]):
    if a in finals and finals[a].get("reason") != NEVER_READ and line_of[(a, "final")] > line_of[(b, "reserve")]:
        finding(f"{a} was finalized after {b} was reserved")
open_left = []
in_flight = []  # the run so far: the last request of a last invocation stopped inside it, for the next resume to raise
reasons = Counter()
for req in order:
    r, f = reserves[req], finals.get(req)
    k = inv_of_id.get(r["invocation"])
    if f is None:
        if k is not None and req == by_inv[k][-1] and invocations[k - 1]["ended"] in ("killed", "error") and first_writer_after(inv_at[k - 1]) is None:
            in_flight.append(req)
            note(f"{req}: {'recorded and never sent' if unsent.get(k) == req else 'in flight'} when invocation {k} stopped ({invocations[k - 1]['ended']}); the next process to write to the ledger raises it to the most a request can cost")
        else:
            finding(f"{req}: reserved and never finalized")
        continue
    reasons[f["reason"]] += 1
    if nano(r["usd"]) + nano(f["adjust"]) != nano(f["final"]):
        finding(f"{req}: reserve {r['usd']} + adjust {f['adjust']} != final {f['final']}")
    if f["reason"] == RELEASED and nano(f["final"]) != 0:
        finding(f"{req}: released at {f['final']}, not zero")
    if f["reason"] == UNVERIFIED and nano(f["final"]) < nano(r["usd"]):
        finding(f"{req}: an unverified request settled below its reservation")
    if f["reason"] == UNVERIFIED and nano(f["final"]) < CALL_BOUND_NANO:
        finding(f"{req}: held at {f['final']}, below the most one call can cost (${CALL_BOUND_NANO / 1e9}), the least the harness holds a reply it cannot trust at")
    if f["reason"] == NEVER_READ:
        open_left.append(req)
        if nano(f["final"]) != max(REQUEST_BOUND_NANO, nano(r["usd"])):
            finding(f"{req}: a request left open was raised to {f['final']}, not the most a request can cost")
        if req != by_inv[k][-1] or (pacing_of.get(k) is not None and (pacing_of[k].get("stopped") or {}).get("reason") != "error"):
            finding(f"{req}: left open, but it is not the last request of an invocation stopped from outside or by a write it could not make")
    if f["reason"] not in (SETTLED, RELEASED, UNVERIFIED, NEVER_READ):
        finding(f"{req}: unexpected reason {f['reason']!r}")
    if f["reason"] == SETTLED and f.get("servedModel") != MODEL:
        finding(f"{req}: settled on {f.get('servedModel')!r}")
    if "servedModel" in f and f["servedModel"] != served:
        finding(f"{req}: its settlement names {f['servedModel']!r}, the run measures {served!r}")
    if nano(f["final"]) < 0:
        finding(f"{req}: final below nothing")
committed_nano = sum(nano(finals[r]["final"]) for r in order if r in finals)
by_day = defaultdict(int)
for r in order:
    if r in finals:
        by_day[finals[r]["at"][:10]] += nano(finals[r]["final"])
info["ledger"] = {
    "lines": len(ledger),
    "reserved": len(reserves),
    "finalized": len(finals),
    "reasons": dict(reasons),
    "committedUsd": committed_nano / 1e9,
    "byUtcDay": {d: v / 1e9 for d, v in sorted(by_day.items())},
    "invocations": {k: {"requests": len(reqs), "committedUsd": sum(nano(finals[r]["final"]) for r in reqs if r in finals) / 1e9} for k, reqs in sorted(by_inv.items(), key=lambda x: x[0] or 0)},
    "unverified": [{"request": r, "reservedUsd": reserves[r]["usd"], "finalUsd": finals[r]["final"], "at": finals[r]["at"]} for r in order if r in finals and finals[r]["reason"] == UNVERIFIED],
    "leftOpen": open_left,
    "inFlight": in_flight,
    "recordedNotSent": {str(k): v for k, v in sorted(unsent.items())},
    "pendingRaiseUsd": len(in_flight) * REQUEST_BOUND_NANO / 1e9,
}
req_sum = (summary_file or {}).get("requests") or {}
limits = manifest.get("limits") or {}


def counted_through(k):
    """The requests the harness had counted when invocation k ended: every line through k's, less a last request k
    recorded but never sent, which it had not counted (the next resume counts it, raised)."""
    return sum(len(by_inv.get(j, [])) for j in range(1, k + 1)) - (1 if unsent.get(k) else 0)


if summary_owner is not None and not SUMMARY_CURRENT:
    # summary.json is an earlier invocation's: it holds what the ledger held when that invocation ended.
    if req_sum.get("sent") != counted_through(summary_owner):
        finding(f"summary requests.sent {req_sum.get('sent')} != {counted_through(summary_owner)} requests the run had sent through invocation {summary_owner}, whose summary it is")
    note(f"summary.json is invocation {summary_owner}'s, not the last invocation's ({N}): its dollars and figures are not compared")
elif SUMMARY_CURRENT:
    if req_sum.get("sent") != counted_through(N):
        finding(f"summary requests.sent {req_sum.get('sent')} != {counted_through(N)} reserved")
    # A request the last invocation sent and could not settle (an unwritable settlement) still counts at its reservation.
    pending = sum(nano(reserves[r]["usd"]) for r in in_flight if r != unsent.get(N))
    if req_sum.get("usd") is None or nano(req_sum["usd"]) != committed_nano + pending:
        finding(f"summary requests.usd {req_sum.get('usd')} != committed {(committed_nano + pending) / 1e9}")
    if req_sum.get("cap") != limits.get("maxTotalRequests") or req_sum.get("capUsd") != limits.get("maxTotalUsd"):
        finding(f"summary caps {req_sum.get('cap')}/{req_sum.get('capUsd')} != the manifest's {limits.get('maxTotalRequests')}/{limits.get('maxTotalUsd')}")
if len(reserves) > limits.get("maxTotalRequests", 0) or committed_nano > nano(limits.get("maxTotalUsd", 0)):
    finding("the ledger exceeds the run's caps")
# A cap stop is due only when the next cell's worst case (CELL_BOUND requests) no longer fits: the harness refuses a
# cell before its first request rather than cut it off inside (live/pacing.ts reserve).
for k in range(1, N + 1):
    stopped = (pacing_of.get(k) or {}).get("stopped") or {}
    if stopped.get("reason") != "cap":
        continue
    t = pacing_of[k]["telemetry"]["pacing"]
    message = str(stopped.get("message"))
    if "for this invocation" in message:
        if not t["sent"] + CELL_BOUND > t["maxRequests"]:
            finding(f"invocation {k} stopped at its own cap with {t['sent']} of {t['maxRequests']} requests sent, though a cell's worst case ({CELL_BOUND}) still fit")
    elif "cumulative cap" in message:
        cap = int(re.search(r"cumulative cap of (\d+)", message).group(1))
        if not counted_through(k) + CELL_BOUND > cap:
            finding(f"invocation {k} stopped at the run's cap of {cap} with {counted_through(k)} requests sent, though a cell's worst case ({CELL_BOUND}) still fit")
    else:
        note(f"invocation {k} stopped at the run's dollar ceiling; whether it was due is not recomputed here")

# --- 5. The records -------------------------------------------------------------------------------------------------
records = jl(os.path.join(RUN, "runs.jsonl"))
superseded = jl(os.path.join(RUN, "runs.superseded.jsonl"))
keyed = Counter(key_of(r) for r in records)
for k_, n_ in keyed.items():
    if n_ > 1:
        finding(f"{'|'.join(k_)}: completed {n_} times in runs.jsonl")
unplanned = [k_ for k_ in keyed if k_ not in PLANNED_INDEX]
if unplanned:
    finding(f"{len(unplanned)} records are for cells the run never planned, e.g. {unplanned[:3]}")
missing_cells = [k_ for k_ in PLANNED if k_ not in keyed]
if missing_cells:
    complete = pacing_of.get(N) is not None and not pacing_of[N].get("stopped")
    (finding if A.complete or complete else note)(f"{len(missing_cells)} planned cells have no record yet, e.g. {missing_cells[:3]}")
for r in records + superseded:
    if r["reference"] not in REFERENCES or r["provider"] != PROVIDER_ID:
        finding(f"{cell(r)}: reference {r['reference']} or provider {r['provider']} is not the run's")
    cp = corpus_prompts.get(r["prompt"])
    if cp is None or r["expected"] != {"intent": cp["intent"].get(r["reference"]), "block": cp["block"]}:
        finding(f"{r['prompt']}: the record's expected labels differ from the frozen corpus")
fresh_of = {(r["reference"], r["arm"], r["prompt"]): r for r in records if r["condition"] == "fresh"}


def provider_calls(r):
    return [c for c in r["calls"] if c.get("source") == "provider"]


whole = lambda v: isinstance(v, int) and not isinstance(v, bool)


def turned_away(q):
    """The busy gateway's refusal on the last try of a schedule: the one call it turned away, unspent and unnamed."""
    return len(q) == 1 and q[0].get("source") == "provider" and q[0].get("outcome") == "provider-error" and q[0].get("model") is None and not whole(q[0].get("inputTokens")) and not whole(q[0].get("outputTokens"))


for r in records + superseded:
    pc = provider_calls(r)
    unreported = sum(1 for c in pc if not (whole(c.get("inputTokens")) and whole(c.get("outputTokens"))))
    tin = sum(c["inputTokens"] for c in pc if whole(c.get("inputTokens")))
    tout = sum(c["outputTokens"] for c in pc if whole(c.get("outputTokens")))
    free = sum(1 for c in r["calls"] if c.get("source") != "provider")
    mine = {"input": tin, "output": tout, "providerCalls": len(pc), "unreportedCalls": unreported, "modelFreeCalls": free}
    if r["status"] == "completed" and mine != r["tokens"]:
        finding(f"{cell(r)}: tokens {r['tokens']} != recomputed {mine}")
    for i, c in enumerate(pc):
        # The busy gateway's turned-away call names no model; it may only be the last provider call of a cell that
        # failed on it.
        if c.get("model") != MODEL and not (turned_away([c]) and i == len(pc) - 1 and (r.get("failure") or {}).get("kind") in ("provider", "policy")):
            finding(f"{cell(r)}: a provider call on {c.get('model')!r}" + (" (a turned-away call, but not the last of a cell that failed on it)" if turned_away([c]) else ""))
    if r["condition"] == "fresh" and r["status"] == "completed" and r.get("plan"):
        if [c for c in r["calls"] if c["operation"] == "plan"] != r["plan"]["calls"]:
            finding(f"{cell(r)}: the plan's calls differ from the record's plan calls")

# Superseded records: what a re-run moved aside, each replaced once, by a cell logged after it.
for r in superseded:
    f_ = r.get("failure") or {}
    fresh_rerun = any(s["condition"] == "fresh" and (s.get("failure") or {}).get("rerunEligible") and (s["reference"], s["arm"], s["prompt"]) == (r["reference"], r["arm"], r["prompt"]) for s in superseded)
    if not (f_.get("rerunEligible") or (r["status"] == "skipped" and r["condition"] != "fresh" and fresh_rerun)):
        finding(f"{cell(r)}: moved aside by a re-run, but it was neither a re-run eligible failure nor a refinement skipped for one")
    if keyed.get(key_of(r)) is None and not A.complete:
        note(f"{cell(r)}: moved aside by a re-run, and not run again yet")
    elif keyed.get(key_of(r)) != 1:
        finding(f"{cell(r)}: moved aside by a re-run, but runs.jsonl does not hold its replacement once")
    else:
        replacement = next(x for x in records if key_of(x) == key_of(r))
        if replacement["at"] < r["at"]:
            finding(f"{cell(r)}: its replacement was logged before it")

# --- 6. Each invocation's cells, and its requests ---------------------------------------------------------------------
# What each invocation logged, in order: from the window copies where they exist; otherwise from the times, between
# one invocation's preflight and the next.
by_text = {}
for r in records + superseded:
    by_text.setdefault(js_stringify(r), r)


def parse_lines(lines):
    out = []
    for line in lines:
        r = json.loads(line)
        out.append(r)
    return out


all_logged = sorted(records + superseded, key=lambda r: r["at"])
logged = {}
for k in range(1, N + 1):
    window = [r for r in all_logged if r["at"] >= inv_at[k - 1] and (k == N or r["at"] < inv_at[k])]
    if k in logged_lines:
        exact = parse_lines(logged_lines[k])
        if sorted(js_stringify(r) for r in exact) != sorted(js_stringify(r) for r in window):
            finding(f"invocation {k}: the records its window copy shows it logged are not the records stamped within its time")
        logged[k] = exact
    else:
        logged[k] = window
        if k < N or (k == N and N > 1 and (N - 1) not in [n_ for n_, _ in snaps]):
            note(f"invocation {k}: what it logged is read from the record times, as no window copy bounds it")

# The cells left to do at each invocation's start, in planned order: each invocation must run exactly a prefix of them.
done = {}
unplaced = [(key_of(r), r["at"]) for r in superseded]  # moved aside by a re-run, at an invocation's start not yet known
for k in range(1, N + 1):
    keys = [key_of(r) for r in logged[k]]
    moved_keys = Counter()
    if k in moved_at:
        moved_keys = Counter(key_of(json.loads(x)) for x in moved_at[k])
        for x in moved_at[k]:
            r = json.loads(x)
            if (key_of(r), r["at"]) in unplaced:
                unplaced.remove((key_of(r), r["at"]))
    else:
        # Without a copy: a re-run moves aside, as an invocation starts, the re-run eligible failures logged before it
        # (and the refinements skipped for one). Once moved, they are the first cells left to do again, so the
        # invocation's own cells say whether it moved those not yet placed: if it logged none, the next one decides.
        candidates = [x for x in unplaced if x[1] < inv_at[k - 1]]
        if candidates and keys:
            moving = Counter(x[0] for x in candidates)
            with_move = [c for c in PLANNED if c not in done or c in moving]
            if keys == with_move[: len(keys)] and keys != [c for c in PLANNED if c not in done][: len(keys)]:
                moved_keys = moving
                for x in candidates:
                    unplaced.remove(x)
    for k_ in moved_keys:
        if k_ not in done:
            finding(f"invocation {k}: a re-run moved aside {'|'.join(k_)}, which was not done")
        done.pop(k_, None)
    remaining = [c for c in PLANNED if c not in done]
    if keys != remaining[: len(keys)]:
        bad = next((i for i, (a, b) in enumerate(zip(keys, remaining)) if a != b), min(len(keys), len(remaining)))
        finding(f"invocation {k}: logged {'|'.join(keys[bad]) if bad < len(keys) else 'more cells'} where the next cell left to do was {'|'.join(remaining[bad]) if bad < len(remaining) else 'none'}")
    ended = invocations[k - 1]["ended"]
    if ended == "complete" and len(keys) != len(remaining):
        finding(f"invocation {k} ended complete with {len(remaining) - len(keys)} cells left to do")
    invocations[k - 1]["cellsAtStart"] = len(PLANNED) - len(remaining)
    invocations[k - 1]["logged"] = len(keys)
    invocations[k - 1]["moved"] = sum(moved_keys.values())
    invocations[k - 1]["nextCell"] = "|".join(remaining[len(keys)]) if len(keys) < len(remaining) else None
    for r in logged[k]:
        done[key_of(r)] = r
reused_at_last = invocations[N - 1]["cellsAtStart"]


request_cache = {}


def requests_of(r):
    """A record's gateway requests in order: a call that is no Worker sub-call begins one; a parse retry joins it."""
    if id(r) in request_cache:
        return request_cache[id(r)]
    out = request_cache[id(r)] = []
    for c in r["calls"]:
        if c.get("source") == "provider" and c.get("subCall", 0) > 0:
            if not out or out[-1][-1].get("source") != "provider" or out[-1][-1]["operation"] != c["operation"]:
                finding(f"{cell(r)}: a Worker sub-call with no request before it")
            out[-1].append(c)
        else:
            out.append([c])
    return out


mapping = {}
orphans = []
mapped_cost_nano = defaultdict(int)
list_cost = defaultdict(float)
chains = {}
w = {}
for k in range(1, N + 1):
    cells = [r for r in logged[k] if r["status"] == "completed"]
    seq = [(r, q) for r in cells for q in requests_of(r)]
    reqs = by_inv.get(k, [])
    if len(seq) > len(reqs):
        finding(f"invocation {k}: its cells made {len(seq)} requests, the ledger has {len(reqs)}")
    prev_at = inv_at[k - 1]
    prev_cell = None
    mismatches = 0
    groups = []  # per request: the cell it belongs to (None for an orphan), and whether it was released
    for i, (r, q) in enumerate(seq):
        if i >= len(reqs):
            break
        req = reqs[i]
        res, fin = reserves[req], finals.get(req, {})
        if prev_cell is not r:
            if res["at"] < prev_at:
                finding(f"{req}: reserved before the previous cell was logged")
                mismatches += 1
            prev_cell = r
        if fin.get("at", "") > r["at"]:
            finding(f"{req}: finalized after its cell {cell(r)} was logged")
            mismatches += 1
        if q[0].get("source") != "provider" or turned_away(q):
            if fin.get("reason") != RELEASED:
                finding(f"{req}: a refused call in {cell(r)}, but the ledger says {fin.get('reason')!r}")
                mismatches += 1
            if turned_away(q) and q is not requests_of(r)[-1]:
                finding(f"{req}: the gateway turned away a call that was not its cell's last")
                mismatches += 1
        else:
            cost = sum(c["inputTokens"] * NANO_IN + c["outputTokens"] * NANO_OUT for c in q if whole(c.get("inputTokens")) and whole(c.get("outputTokens")))
            if fin.get("reason") != SETTLED or nano(fin.get("final", -1)) != cost:
                finding(f"{req}: {cell(r)} reported {cost / 1e9:.9f}, the ledger settled {fin.get('final')} ({fin.get('reason')})")
                mismatches += 1
            if any(c.get("model") != fin.get("servedModel") for c in q):
                finding(f"{req}: the call's model differs from the ledger's servedModel")
                mismatches += 1
            mapped_cost_nano[k] += cost
            list_cost[k] += sum(c["inputTokens"] * 1e-6 + c["outputTokens"] * 5e-6 for c in q if whole(c.get("inputTokens")) and whole(c.get("outputTokens")))
        mapping[req] = {"cell": cell(r), "calls": len(q), "operation": q[0]["operation"], "reason": fin.get("reason")}
        groups.append((id(r), fin.get("reason") == RELEASED, r))
        prev_at = r["at"]
    leftover = reqs[len(seq):]
    for req in leftover:
        fin = finals.get(req, {})
        orphans.append({"invocation": k, "request": req, "reason": fin.get("reason"), "finalUsd": fin.get("final"), "reservedAt": reserves[req]["at"], "finalAt": fin.get("at")})
        groups.append((None, fin.get("reason") == RELEASED, None))
    ended = invocations[k - 1]["ended"]
    if leftover:
        # Requests no logged cell made: the cell in flight when the invocation stopped inside it, abandoned, its record
        # never logged. Only a stop inside a cell leaves them: a call the run cannot trust, an error, or a kill.
        if ended not in ("integrity", "error", "killed"):
            finding(f"invocation {k} ended {ended}, yet {len(leftover)} of its requests belong to no logged cell")
        if len(leftover) > CELL_BOUND:
            finding(f"invocation {k}: {len(leftover)} requests belong to no logged cell, more than one cell can make ({CELL_BOUND})")
        if ended == "integrity" and finals.get(leftover[-1], {}).get("reason") not in (UNVERIFIED, SETTLED):
            finding(f"invocation {k} stopped on a call the run cannot trust, but its last request ended {finals.get(leftover[-1], {}).get('reason')!r}")
        for req in leftover[:-1]:
            if finals.get(req, {}).get("reason") not in (SETTLED, RELEASED):
                finding(f"{req}: an abandoned cell's request ended {finals.get(req, {}).get('reason')!r} before its last")
    elif ended == "integrity":
        finding(f"invocation {k} stopped on a call the run cannot trust, but every request belongs to a logged cell")
    # The backoff each refused request waited: a refusal retried waits the next step of the schedule; a request refused
    # through the whole schedule fails its cell, its last refusal waiting nothing; a refusal no retry follows waits
    # nothing either.
    expected = []
    exhausted = []
    i = 0
    while i < len(groups):
        owner, released, r = groups[i]
        if not released:
            i += 1
            continue
        j = i
        while j < len(groups) and groups[j][1] and groups[j][0] == owner:
            j += 1
        n_ = j - i
        retried = j < len(groups) and groups[j][0] == owner
        if retried:
            if n_ > STEPS:
                finding(f"invocation {k}: a request refused {n_} times in a row was retried past the schedule's {STEPS} steps")
            expected += SCHEDULE[:n_]
        elif owner is not None:
            # The chain ends its cell: the cell failed on its last refusal.
            failure = (r.get("failure") or {}).get("kind")
            if failure not in ("provider", "policy"):
                finding(f"invocation {k}: {cell(r)} ended on a refused request, yet it did not fail as a provider or policy failure")
            if n_ == STEPS + 1:
                exhausted.append(cell(r))
                expected += SCHEDULE[:STEPS]
            elif n_ > STEPS + 1:
                finding(f"invocation {k}: {cell(r)} was refused {n_} times in a row, past the schedule")
                expected += SCHEDULE[:STEPS]
            else:
                expected += SCHEDULE[: n_ - 1]
        else:
            # A chain cut off by a stop inside its cell: whether its last refusal waited is not on the record.
            expected += SCHEDULE[: n_ - 1]
            note(f"invocation {k}: its last requests were refused and nothing followed them")
        i = j
    chains[k] = exhausted
    released_n = sum(1 for g in groups if g[1])
    w[k] = {
        "recordsLogged": len(logged[k]),
        "completed": len(cells),
        "skipped": len(logged[k]) - len(cells),
        "requestsFromCells": len(seq),
        "ledgerRequests": len(reqs),
        "orphans": leftover,
        "mappingMismatches": mismatches,
        "settledFromCellsUsd": mapped_cost_nano[k] / 1e9,
        "listUsd": round(list_cost[k], 9),
        "committedUsd": sum(nano(finals[r]["final"]) for r in reqs if r in finals) / 1e9,
        "firstCell": cell(logged[k][0]) if logged[k] else None,
        "lastCell": cell(logged[k][-1]) if logged[k] else None,
        "providerCalls": sum(len(provider_calls(r)) for r in cells),
        "workerParseRetries": sum(1 for r in cells for c in provider_calls(r) if c.get("subCall", 0) > 0),
        "releasedRefusals": released_n,
        "exhaustedSchedules": exhausted,
        "inputTokens": sum(r["tokens"]["input"] for r in cells),
        "outputTokens": sum(r["tokens"]["output"] for r in cells),
    }
    p = pacing_of.get(k)
    if p is not None:
        t = p["telemetry"]["pacing"]
        backoffs = [x["ms"] for x in t["waits"] if x["reason"] != "spacing"]
        w[k]["backoffMs"] = backoffs
        w[k]["waits"] = dict(Counter(x["reason"] for x in t["waits"]))
        if expected is not None and backoffs != expected:
            finding(f"invocation {k}: backoffs {backoffs} ms, but its refusals call for {expected}")
info["invocations"] = invocations
info["windows"] = w
info["orphans"] = orphans
info["exhaustedSchedules"] = {k: v for k, v in chains.items() if v}
for o in orphans:
    if o["reason"] is None and o["request"] not in in_flight:
        finding(f"{o['request']}: never finalized")
held_nano = sum(nano(o["finalUsd"]) for o in orphans if o["finalUsd"] is not None)
cells_nano = sum(mapped_cost_nano.values())
info["cost"] = {
    "listUsdLoggedCells": round(sum(list_cost.values()), 9),
    "withFeeUsdLoggedCells": cells_nano / 1e9,
    "heldUsd": held_nano / 1e9,
    "cellsPlusHeldUsd": (cells_nano + held_nano) / 1e9,
    "committedUsd": committed_nano / 1e9,
}
if cells_nano + held_nano != committed_nano:
    finding(f"logged cells {cells_nano / 1e9} + held {held_nano / 1e9} != committed {committed_nano / 1e9}")


# --- 7. The add and remove check and the surface digests, re-derived from the surfaces ------------------------------
def is_node(v):
    return isinstance(v, dict) and isinstance(v.get("component"), str)


def root_of(surface):
    if isinstance(surface, dict) and surface.get("root") is not None:
        return surface["root"]
    return surface


def id_key(node):
    i = node.get("id")
    return f"{node['component']}({i})" if isinstance(i, str) and i else None


def id_counts(surface):
    out = Counter()

    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
            return
        if not isinstance(v, dict):
            return
        k = id_key(v) if is_node(v) else None
        if k:
            out[k] += 1
        for child in v.values():
            walk(child)

    walk(root_of(surface))
    return out


def shared_ids(*surfaces):
    counts = [id_counts(s) for s in surfaces]
    first_, rest = counts[0], counts[1:]
    return {k for k, n in first_.items() if n == 1 and all(c.get(k) == 1 for c in rest)}


def list_lengths(surface, ids_):
    out = {}

    def anchor(node):
        k = id_key(node)
        return k if k and k in ids_ else None

    def walk(v, at):
        if isinstance(v, list):
            out[at] = len(v)
            ranks = Counter()
            for i, item in enumerate(v):
                if not is_node(item):
                    walk(item, f"{at}[{i}]")
                    continue
                a = anchor(item)
                if a:
                    walk(item, a)
                    continue
                rank = ranks[item["component"]]
                ranks[item["component"]] += 1
                walk(item, f"{at}>{item['component']}{'#' + str(rank) if rank > 0 else ''}")
            return
        if not isinstance(v, dict):
            return
        for key, child in v.items():
            walk(child, f"{at}.{key}")

    root = root_of(surface)
    walk(root, (anchor(root) or root["component"]) if is_node(root) else "root")
    return out


def check_operation(requested, prior, refined):
    ids_ = shared_ids(prior, refined)
    before, after = list_lengths(prior, ids_), list_lengths(refined, ids_)
    deltas = {}
    for key in sorted(set(before) | set(after)):
        d = after.get(key, 0) - before.get(key, 0)
        if d:
            deltas[key] = d
    grew = any(d > 0 for d in deltas.values())
    shrank = any(d < 0 for d in deltas.values())
    return {"requested": requested, "observed": "mixed" if grew and shrank else "add" if grew else "remove" if shrank else "none", "deltas": deltas}


def missed(op):
    return op["observed"] == "none" or (op["observed"] != "mixed" and op["observed"] != op["requested"])


def performed(op):
    return op["observed"] == op["requested"]


digest_mismatch = 0
op_mismatch = 0
changed_mismatch = 0
ops = {}
okey = lambda r: (r["reference"], cell(r))
for r in records:
    if r.get("passed") and r.get("surface") is not None:
        if hashlib.sha256(js_stringify(r["surface"]).encode("utf-8")).hexdigest() != r.get("surfaceDigest"):
            digest_mismatch += 1
            finding(f"{cell(r)}: surfaceDigest does not match its surface")
    if r["condition"] == "fresh" or not r.get("passed"):
        if "operation" in r or "changed" in r:
            finding(f"{cell(r)}: carries an operation or changed it should not")
        continue
    prior = fresh_of[(r["reference"], r["arm"], r["prompt"])]
    changed = r["surfaceDigest"] != prior["surfaceDigest"]
    if changed != r.get("changed"):
        changed_mismatch += 1
        finding(f"{cell(r)}: changed {r.get('changed')} != recomputed {changed}")
    if r["condition"] in ADD_REMOVE:
        mine = check_operation("add" if r["condition"] == "refine-add" else "remove", prior["surface"], r["surface"])
        ops[okey(r)] = mine
        if mine != r.get("operation"):
            op_mismatch += 1
            finding(f"{cell(r)}: operation {r.get('operation')} != recomputed {mine}")
info["surfaceChecks"] = {"digestMismatches": digest_mismatch, "operationMismatches": op_mismatch, "changedMismatches": changed_mismatch, "operationsRecomputed": len(ops)}

# --- 7b. Parity, recomputed from each surface and its checklist (live/parity.ts, live/arms.ts) ----------------------
# The checklist: the prompt's labels, a refinement's expected text, and the prompt's components for the reference. The
# surface's text is its text nodes and string props, never a key that names structure; from
# aestheticfunction/dspack-studio#102 on (--parity-reading arrays) also the strings arrays hold, such as a table's
# column labels.
STRUCTURE_KEYS = {"component", "id", "dspackSurface", "system", "intent"}
REFINEMENT_KIND = {"refine-content": "content", "refine-add": "add", "refine-remove": "remove", "refine-structural": "structural"}


def surface_texts(surface, arrays):
    out = []

    def walk(node, key=None):
        if isinstance(node, str):
            if arrays and (key is None or key not in STRUCTURE_KEYS):
                out.append(node)
            return
        if isinstance(node, list):
            for item in node:
                walk(item, key)
            return
        if not isinstance(node, dict):
            return
        if isinstance(node.get("text"), str):
            out.append(node["text"])
        for k, v in node.items():
            if k == "text":
                continue
            if arrays:
                walk(v, k)
            elif isinstance(v, str):
                if k not in STRUCTURE_KEYS:
                    out.append(v)
            elif isinstance(v, (dict, list)):
                walk(v)

    walk(root_of(surface))
    return out


def surface_components(surface):
    out = set()

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        if isinstance(node.get("component"), str):
            out.add(node["component"])
        for v in node.values():
            if isinstance(v, (dict, list)):
                walk(v)

    walk(root_of(surface))
    return out


def checklist_of(r):
    p = corpus_prompts[r["prompt"]]
    labels = list(p["parity"]["labels"])
    if r["condition"] != "fresh":
        templates = corpus["refinements"].get(p["block"] if p["block"] is not None else "null") or corpus["refinements"]["null"]
        expect = templates[REFINEMENT_KIND[r["condition"]]].get("expectText")
        if expect:
            labels.append(expect)
    c = p["parity"].get("components")
    return labels, ([] if not c else c if isinstance(c, list) else c.get(r["reference"], []))


def check_parity(surface, labels, components, arrays):
    haystack = "\n".join(surface_texts(surface, arrays)).lower()
    present = surface_components(surface)
    satisfied, missing_ = [], []
    for label in labels:
        (satisfied if label.lower() in haystack else missing_).append(f"label:{label}")
    for c in components:
        (satisfied if c in present else missing_).append(f"component:{c}")
    total = len(satisfied) + len(missing_)
    return {"score": 1 if total == 0 else len(satisfied) / total, "satisfied": satisfied, "missing": missing_}


ARRAYS = A.parity_reading == "arrays"
parity_mismatch = 0
other_score = {}  # id(record) -> its parity score under the other reading, for the record
for logged_, r in [(True, x) for x in records] + [(False, x) for x in superseded]:
    if r["prompt"] not in corpus_prompts:
        continue
    surface = r.get("surface") if r.get("passed") else None
    labels, components = checklist_of(r)
    mine = check_parity(surface, labels, components, ARRAYS) if surface is not None else None
    if mine != r.get("parity"):
        parity_mismatch += 1
        finding(f"{cell(r)}: its parity {r.get('parity')} differs from its parity recomputed from its surface ({A.parity_reading}): {mine}")
    if surface is not None and logged_:
        other_score[id(r)] = check_parity(surface, labels, components, not ARRAYS)["score"]
info["parity"] = {"reading": A.parity_reading, "mismatches": parity_mismatch}

# --- 8. Scoring and the arm statistics ----------------------------------------------------------------------------
for r in records + superseded:
    if r["status"] == "completed" and r.get("outcome") == "failed-adapter":
        kind = r["failure"]["kind"]
        if r["failure"]["rerunEligible"] != (kind in ("provider", "policy")):
            finding(f"{cell(r)}: rerunEligible does not follow its kind {kind}")
for r in records:
    if r.get("failure", {}).get("rerunEligible"):
        (finding if A.complete else note)(f"{cell(r)}: a re-run eligible failure ({r['failure']['kind']}) in the decision records: resume with --rerun-failed")


def gate_passed(r):
    return bool(r.get("passed")) or r.get("outcome") == "passed"


def score(recs, failing):
    """The records as a reading counts them: failing(r, op) says whether a passing add or remove fails."""
    out = []
    for r in recs:
        op = ops.get(okey(r))
        if r.get("passed") and r["condition"] in ADD_REMOVE and failing(r, op):
            r = dict(r, passed=False)
        out.append(r)
    return out


READINGS = {
    "none": lambda r, op: False,
    "binding (missed or unchecked)": lambda r, op: op is None or missed(op),
    "missed-and-mixed": lambda r, op: op is None or not performed(op),
    "changed-missed (unchanged misses excused)": lambda r, op: op is None or (missed(op) and r.get("changed") is not False),
    "changed-missed-and-mixed": lambda r, op: op is None or (missed(op) and r.get("changed") is not False) or op["observed"] == "mixed",
}
binding = (corpus.get("scoring") or {}).get("operation") == "binding"
scored = score(records, READINGS["binding (missed or unchecked)"] if binding else READINGS["none"])


def other_parity_mean(arm):
    """The arm's parity mean as the summary takes it (its passing evaluated results with a check), under the other
    reading: for a run before aestheticfunction/dspack-studio#102, the corrected figure."""
    ev = [r for r in scored if r["arm"] == arm and r["status"] == "completed" and not r.get("failure", {}).get("rerunEligible") and r["passed"]]
    ev = [r for r in ev if isinstance((r.get("parity") or {}).get("score"), (int, float)) and len(r["parity"]["satisfied"]) + len(r["parity"]["missing"]) > 0]
    return mean([other_score[id(r)] for r in ev if id(r) in other_score])


info["parity"]["otherReading"] = {"reading": "no-arrays" if ARRAYS else "arrays", "meanScore": {a: other_parity_mean(a) for a in ARMS}}


def evaluated_of(recs):
    return [r for r in recs if r["status"] == "completed" and not r.get("failure", {}).get("rerunEligible")]


def metered(r):
    return r["tokens"]["unreportedCalls"] == 0


def tok(r):
    return r["tokens"]["input"] + r["tokens"]["output"]


def arm_stats(recs):
    completed = [r for r in recs if r["status"] == "completed"]
    ev = evaluated_of(recs)
    passed = [r for r in ev if r["passed"]]
    met = [r for r in ev if metered(r)]
    met_s = [r for r in met if r["passed"]]
    reported = any(r["tokens"]["providerCalls"] > 0 for r in met)
    per = lambda pick: None if not reported or not met_s else sum(pick(r) for r in met) / len(met_s)
    refinements = [r for r in completed if r["condition"] != "fresh"]
    refined_passed = [r for r in refinements if gate_passed(r)]
    block_prior = [r for r in refinements if r.get("refinement") and r["refinement"]["mode"] != "primitive"]
    checks = lambda r: len(r["parity"]["satisfied"]) + len(r["parity"]["missing"]) if r.get("parity") else 0
    parity_scored = [r for r in passed if isinstance(r.get("parity", {}).get("score"), (int, float)) and checks(r) > 0]

    def operations(runs):
        checked = [r for r in runs if gate_passed(r) and okey(r) in ops]
        return {
            "checked": len(checked),
            "performed": sum(1 for r in checked if performed(ops[okey(r)])),
            "mixed": sum(1 for r in checked if ops[okey(r)]["observed"] == "mixed"),
            "missed": sum(1 for r in checked if missed(ops[okey(r)])),
            "unchanged": sum(1 for r in checked if missed(ops[okey(r)]) and r.get("changed") is False),
            "unchecked": sum(1 for r in runs if gate_passed(r) and r["condition"] in ADD_REMOVE and okey(r) not in ops),
        }

    adds_removes = [r for r in ev if gate_passed(r) and r["condition"] in ADD_REMOVE]
    by_block = {}
    for b in dict.fromkeys((r["expected"]["block"] or "null") for r in adds_removes):
        by_block[b] = operations([r for r in adds_removes if (r["expected"]["block"] or "null") == b])
    paths = {}
    for r in completed:
        p = r.get("path") or "primitive"
        e = paths.setdefault(p, {"n": 0, "passed": 0})
        e["n"] += 1
        e["passed"] += 1 if r["passed"] else 0
    brf = Counter(str(r["budgetRemainingAtFallback"]) for r in completed if "budgetRemainingAtFallback" in r)
    fbc = Counter(r["trace"]["fallback"]["classification"] for r in completed if (r.get("trace") or {}).get("fallback", {}).get("classification"))
    exe = lambda key: median([r["timings"]["execution"][key] for r in completed if r["timings"].get("execution") and isinstance(r["timings"]["execution"].get(key), (int, float))])
    rerun_by_kind = Counter(r["failure"]["kind"] for r in completed if r.get("failure", {}).get("rerunEligible"))
    return {
        "n": len(recs),
        "skipped": len(recs) - len(completed),
        "completed": len(completed),
        "rerunEligible": sum(1 for r in completed if r.get("failure", {}).get("rerunEligible")),
        "rerunByKind": dict(rerun_by_kind),
        "evaluated": len(ev),
        "passed": len(passed),
        "passRate": ratio(len(passed), len(ev)),
        "firstAttemptPassed": sum(1 for r in passed if r["attempts"] == 1),
        "firstAttemptPassRate": ratio(sum(1 for r in passed if r["attempts"] == 1), len(ev)),
        "repairsPerSuccess": None if not passed else sum(max(0, r["attempts"] - 1) for r in passed) / len(passed),
        "meteredRuns": len(met),
        "meteredSuccesses": len(met_s),
        "meteredTokens": sum(tok(r) for r in met),
        "unmeteredRuns": len(ev) - len(met),
        "unmeteredSuccesses": len(passed) - len(met_s),
        "tokensPerSuccess": per(tok),
        "inputTokensPerSuccess": per(lambda r: r["tokens"]["input"]),
        "outputTokensPerSuccess": per(lambda r: r["tokens"]["output"]),
        "tokensPerPassingRun": None if not reported else mean([tok(r) for r in met_s]),
        "providerCallsPerRun": mean([r["tokens"]["providerCalls"] for r in completed]),
        "requestBytesPerRun": mean([r["requestBytes"] for r in completed]),
        "latency": {
            "totalMs": exe("totalMs"),
            "firstGatedAttemptMs": exe("firstGatedAttemptMs"),
            "blockPhaseMs": exe("blockPhaseMs"),
            "emitMs": exe("emitMs"),
            "planMs": exe("planMs"),
            "pacingMs": median([r["timings"]["pacingMs"] for r in completed if isinstance(r["timings"].get("pacingMs"), (int, float))]),
            "wallTotalMs": median([r["timings"]["totalMs"] for r in completed]),
        },
        "parity": {"meanScore": mean([r["parity"]["score"] for r in parity_scored]), "scored": len(parity_scored), "fullyParityPassed": sum(1 for r in parity_scored if r["parity"]["score"] == 1), "noChecks": sum(1 for r in passed if r.get("parity") and checks(r) == 0)},
        "operation": operations(ev),
        "operationByBlock": by_block,
        "paths": paths,
        "budgetRemainingAtFallback": dict(brf),
        "fallbackByClassification": dict(fbc),
        "invariantFailures": sum(1 for r in completed if r.get("outcome") == "invariant-failure"),
        "budgetExhausted": sum(1 for r in completed if r.get("failure", {}).get("kind") == "budget"),
        "changedRate": None if not refinements else ratio(sum(1 for r in refined_passed if r.get("changed")), len(refined_passed)),
        "changed": sum(1 for r in refined_passed if r.get("changed")),
        "refinedPassed": len(refined_passed),
        "retention": None if not block_prior else ratio(sum(1 for r in block_prior if r["refinement"]["retained"]), len(block_prior)),
        "retained": sum(1 for r in block_prior if r["refinement"]["retained"]),
        "onBlockPrior": len(block_prior),
    }


# --- 9. The decision and its intervals ------------------------------------------------------------------------------
def thread_sums(recs, arm):
    out = {}
    for r in recs:
        if r["arm"] != arm or r["status"] != "completed" or r.get("failure", {}).get("rerunEligible"):
            continue
        t = out.setdefault(r["prompt"], {"evaluated": 0, "passed": 0, "metered": 0, "meteredSuccesses": 0, "meteredTokens": 0, "reported": False})
        t["evaluated"] += 1
        t["passed"] += 1 if r["passed"] else 0
        if metered(r):
            t["metered"] += 1
            t["meteredTokens"] += tok(r)
            t["meteredSuccesses"] += 1 if r["passed"] else 0
            t["reported"] = t["reported"] or r["tokens"]["providerCalls"] > 0
    return out


def pooled_over(sums, sample):
    ev = pa = ms = mt = 0
    rep = False
    for p in sample:
        t = sums.get(p)
        if not t:
            continue
        ev += t["evaluated"]
        pa += t["passed"]
        ms += t["meteredSuccesses"]
        mt += t["meteredTokens"]
        rep = rep or t["reported"]
    return {"passRate": ratio(pa, ev), "tokensPerSuccess": None if not rep or ms == 0 else mt / ms}


M32 = 0xFFFFFFFF


def seeded(label):
    """FNV-1a of the label seeding mulberry32: the generator the addendum's interval is specified with."""
    h = 2166136261
    for ch in label:
        h = ((h ^ ord(ch)) * 16777619) & M32
    state = [h]

    def rnd():
        state[0] = (state[0] + 0x6D2B79F5) & M32
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & M32
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rnd


def percentile_interval(values, level, prompts):
    if not values:
        return None
    s = sorted(values)

    def at(q):
        i = q * (len(s) - 1)
        lo, hi = int(i // 1), -int(-i // 1)
        return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (i - lo)

    return {"low": at((1 - level) / 2), "high": at(1 - (1 - level) / 2), "resamples": len(values), "prompts": prompts}


def shared_prompts(sums):
    maps = list(sums.values())
    return sorted(p for p in maps[0] if all(p in m for m in maps[1:]))


def bootstrap(sums, statistics, draw, resamples=2000, level=0.95):
    prompts = shared_prompts(sums)
    values = {k: [] for k in statistics}
    if not prompts:
        return {k: None for k in statistics}
    for _ in range(resamples):
        sample = [prompts[draw(len(prompts))] for _ in range(len(prompts))]
        p = {arm: pooled_over(m, sample) for arm, m in sums.items()}
        for k, f in statistics.items():
            v = f(p)
            if v is not None and v == v and abs(v) != float("inf"):
                values[k].append(v)
    return {k: percentile_interval(v, level, len(prompts)) for k, v in values.items()}


def spec_draw(label):
    rnd = seeded(label)
    return lambda n: int(rnd() * n)


def reduction(other):
    def f(p):
        b, o = p["block"]["tokensPerSuccess"], p[other]["tokensPerSuccess"]
        return None if b is None or o is None or o <= 0 else 1 - b / o
    return f


def pass_diff(other):
    def f(p):
        b, o = p["block"]["passRate"], p[other]["passRate"]
        return None if b is None or o is None else b - o
    return f


DECISION_STATS = {"reductionVsProduction": reduction("production"), "reductionVsCapped": reduction("capped"), "passDiffVsProduction": pass_diff("production"), "passDiffVsCapped": pass_diff("capped")}
EPS = 1e-9


def clarity_of(iv, threshold, enough):
    if not iv:
        return "n/a"
    if not enough:
        return "insufficient"
    return "clear-pass" if iv["low"] >= threshold - EPS else "clear-fail" if iv["high"] < threshold - EPS else "uncertain"


def paired_counts(first_, second):
    out = {"prompts": 0, "passRate": {"better": 0, "same": 0, "worse": 0}, "tokensPerSuccess": {"lower": 0, "same": 0, "higher": 0, "comparable": 0}}
    for p, a in first_.items():
        b = second.get(p)
        if not b or a["evaluated"] == 0 or b["evaluated"] == 0:
            continue
        out["prompts"] += 1
        ra, rb = a["passed"] / a["evaluated"], b["passed"] / b["evaluated"]
        out["passRate"]["better" if ra > rb else "worse" if ra < rb else "same"] += 1
        if a["reported"] and b["reported"] and a["meteredSuccesses"] > 0 and b["meteredSuccesses"] > 0:
            ta, tb = a["meteredTokens"] / a["meteredSuccesses"], b["meteredTokens"] / b["meteredSuccesses"]
            out["tokensPerSuccess"]["comparable"] += 1
            out["tokensPerSuccess"]["lower" if ta < tb else "higher" if ta > tb else "same"] += 1
    return out


def decide(recs, label, draw=None, resamples=2000):
    recs = [r for r in recs if r["arm"] in DECISION_ARMS]
    st = {a: arm_stats([r for r in recs if r["arm"] == a]) for a in DECISION_ARMS}
    sums = {a: thread_sums(recs, a) for a in DECISION_ARMS}
    threads = {a: sum(1 for t in sums[a].values() if t["evaluated"] > 0) for a in DECISION_ARMS}
    metered_threads = {a: sum(1 for t in sums[a].values() if t["metered"] > 0) for a in DECISION_ARMS}
    shared = shared_prompts(sums)
    metered_cohort = sum(1 for p in shared if sums["block"][p]["metered"] > 0 and sums["production"][p]["metered"] > 0)
    tps = {a: st[a]["tokensPerSuccess"] for a in DECISION_ARMS}
    rates = {a: st[a]["passRate"] for a in DECISION_ARMS}
    red_p = None if tps["block"] is None or not tps["production"] else 1 - tps["block"] / tps["production"]
    red_c = None if tps["block"] is None or not tps["capped"] else 1 - tps["block"] / tps["capped"]
    below = any(n < OPTIONS["minimum"] for n in threads.values()) or any(n < OPTIONS["minimum"] and n < threads[a] for a, n in metered_threads.items())
    if below:
        verdict = "insufficient"
    elif red_p is None:
        verdict = "insufficient"
    else:
        verdict = "pass" if red_p >= OPTIONS["reduction"] - EPS else "fail"
        for other in ("production", "capped"):
            if rates["block"] is None or rates[other] is None:
                verdict = "insufficient"
            elif rates["block"] < rates[other] - OPTIONS["margin"] - EPS and verdict != "insufficient":
                verdict = "fail"
    # The decision's reasons, worded as live/metrics.ts decide words them.
    minimum, reduction_pct, margin_pts = OPTIONS["minimum"], js_num(100 * OPTIONS["reduction"]), js_num(100 * OPTIONS["margin"])
    evaluated = {a: st[a]["evaluated"] for a in DECISION_ARMS}
    metered = {a: st[a]["meteredRuns"] for a in DECISION_ARMS}
    reasons = []
    for a in DECISION_ARMS:
        if threads[a] < minimum:
            reasons.append(f"{a}: {threads[a]} prompt {'thread' if threads[a] == 1 else 'threads'} ({evaluated[a]} cells), fewer than the {minimum} the rule needs")
    for a in DECISION_ARMS:
        if metered_threads[a] < minimum and metered_threads[a] < threads[a]:
            reasons.append(f"{a}: {metered_threads[a]} metered prompt {'thread' if metered_threads[a] == 1 else 'threads'} ({metered[a]} metered {'cell' if metered[a] == 1 else 'cells'}) in the token cohort, fewer than the {minimum} the rule needs")
    if not reasons:
        if red_p is None:
            reasons.append("tokens per success is not measurable: a metered passing run is missing in the block arm or the production arm (scripted or unreported usage)")
        elif red_p < OPTIONS["reduction"] - EPS:
            reasons.append(f"tokens per success fell {to_fixed1(100 * red_p)}% against production; the rule needs {reduction_pct}%")
        else:
            reasons.append(f"tokens per success fell {to_fixed1(100 * red_p)}% against production (needs {reduction_pct}%)")
        for other in ("production", "capped"):
            if rates["block"] is None or rates[other] is None:
                reasons.append(f"pass rate unavailable for the {other} comparison")
            elif rates["block"] < rates[other] - OPTIONS["margin"] - EPS:
                reasons.append(f"pass rate {to_fixed1(100 * rates['block'])}% is more than {margin_pts} points below {other} ({to_fixed1(100 * rates[other])}%)")
            else:
                reasons.append(f"pass rate {to_fixed1(100 * rates['block'])}% is within {margin_pts} points of {other} ({to_fixed1(100 * rates[other])}%)")
    iv = bootstrap(sums, DECISION_STATS, draw or spec_draw(label), resamples)
    enough = len(shared) >= OPTIONS["minimum"]
    clarity = {
        "tokens": clarity_of(iv["reductionVsProduction"], OPTIONS["reduction"], enough and metered_cohort >= OPTIONS["minimum"]),
        "vsProduction": clarity_of(iv["passDiffVsProduction"], -OPTIONS["margin"], enough),
        "vsCapped": clarity_of(iv["passDiffVsCapped"], -OPTIONS["margin"], enough),
    }
    crit = list(clarity.values())
    agrees = (verdict == "pass" and all(c == "clear-pass" for c in crit)) or (verdict == "fail" and "clear-fail" in crit)
    clarity["overall"] = "insufficient" if not enough or below else "clear" if agrees else "uncertain"
    return {
        "verdict": verdict,
        "reasons": reasons,
        "options": OPTIONS,
        "tokens": {**tps, "reductionVsProduction": red_p, "reductionVsCapped": red_c},
        "passRates": rates,
        "evaluated": {a: st[a]["evaluated"] for a in DECISION_ARMS},
        "metered": {a: st[a]["meteredRuns"] for a in DECISION_ARMS},
        "threads": threads,
        "meteredThreads": metered_threads,
        "counts": {"passed": {a: st[a]["passed"] for a in DECISION_ARMS}, "meteredTokens": {a: st[a]["meteredTokens"] for a in DECISION_ARMS}, "meteredSuccesses": {a: st[a]["meteredSuccesses"] for a in DECISION_ARMS}},
        "cohort": len(shared),
        "meteredCohort": metered_cohort,
        "intervals": iv,
        "clarity": clarity,
        "paired": {"vsProduction": paired_counts(sums["block"], sums["production"]), "vsCapped": paired_counts(sums["block"], sums["capped"])},
    }


# --- 10. Compare with summary.json ---------------------------------------------------------------------------------
def compare(label, mine, theirs, tol=1e-9):
    if isinstance(mine, dict) and isinstance(theirs, dict):
        for k in sorted(set(mine) | set(theirs)):
            if k in ("reference", "provider", "arm", "condition"):
                continue
            if k not in mine or k not in theirs:
                finding(f"{label}.{k}: present on one side only (mine {k in mine}, summary {k in theirs})")
                continue
            compare(f"{label}.{k}", mine[k], theirs[k], tol)
    elif isinstance(mine, list) and isinstance(theirs, list) and len(mine) == len(theirs) and any(isinstance(x, (dict, list, float)) for x in mine + theirs):
        for i, (a_, b_) in enumerate(zip(mine, theirs)):
            compare(f"{label}[{i}]", a_, b_, tol)
    elif isinstance(mine, (int, float)) and isinstance(theirs, (int, float)) and not isinstance(mine, bool) and not isinstance(theirs, bool):
        if not close(float(mine), float(theirs), tol):
            finding(f"{label}: mine {mine} != summary {theirs}")
    elif mine != theirs:
        finding(f"{label}: mine {mine!r} != summary {theirs!r}")


def entries(name, rows, expected, key):
    """The summary's entries in one list, by key: each the records make once, and none they do not make."""
    found = defaultdict(list)
    for x in rows or []:
        found[key(x)].append(x)
    for k_ in found:
        if k_ not in expected:
            finding(f"summary: {name} holds an entry for {'|'.join(map(str, k_))}, which the run's records do not make")
    out = {}
    for k_ in expected:
        if len(found.get(k_, [])) != 1:
            finding(f"summary: {len(found.get(k_, []))} {name} entries for {'|'.join(map(str, k_))}")
        else:
            out[k_] = found[k_][0]
    return out


# The ways a decision is read again with add and remove refinements counted as failures (live/metrics.ts
# operationSensitivity): "none" is the pipeline's pass alone; the others count more of them as failures on top of the
# corpus's scoring, where the record carries an operation.
HARNESS_FAILING = {
    "missed": lambda op, r: missed(op),
    "missed-and-mixed": lambda op, r: not performed(op),
    "changed-missed": lambda op, r: missed(op) and r.get("changed") is not False,
    "changed-missed-and-mixed": lambda op, r: (missed(op) and r.get("changed") is not False) or op["observed"] == "mixed",
}
VERDICT_SCORING = READINGS["binding (missed or unchecked)"] if binding else READINGS["none"]


def sensitivity_records(recs, way):
    if way == "none":
        return recs
    return [dict(r, passed=False) if r.get("passed") and okey(r) in ops and HARNESS_FAILING[way](ops[okey(r)], r) else r for r in score(recs, VERDICT_SCORING)]


def sensitivity_ways(recs, operation):
    """The readings the harness lists for a decision: under binding scoring, the pipeline's pass alone if the scoring
    failed any pass, and the mixed ones failing too if a decision arm has one; otherwise each way that changes a count."""
    present = lambda f: any(o[f] > 0 for o in operation.values())
    if binding:
        scored_out = any(a_.get("passed") != b_.get("passed") for a_, b_ in zip(score(recs, VERDICT_SCORING), recs))
        return (["none"] if scored_out else []) + (["missed-and-mixed"] if present("mixed") else [])
    return (["missed"] if present("missed") else []) + (["missed-and-mixed"] if present("mixed") else []) + (["changed-missed"] if present("unchanged") else []) + (["changed-missed-and-mixed"] if present("unchanged") and present("mixed") else [])


results = {}
summary_decisions = summary_pooled = summary_arms = summary_selection = summary_encodings = summary_sensitivity = {}
if SUMMARY_CURRENT:
    if S.get("scoring") != ("binding" if binding else "beside"):
        finding(f"summary scoring {S.get('scoring')!r} is not the corpus's {'binding' if binding else 'beside'}")
    made = [r for r in scored]
    decided = {(r["reference"], r["provider"]) for r in made if r["arm"] in DECISION_ARMS}
    summary_decisions = entries("decisions", S.get("decisions"), decided, lambda x: (x.get("reference"), x.get("provider")))
    summary_sensitivity = entries("sensitivity", S.get("sensitivity"), decided, lambda x: (x.get("reference"), x.get("provider")))
    summary_pooled = entries("pooled", S.get("pooled"), {(r["reference"], r["arm"]) for r in made}, lambda x: (x.get("reference"), x.get("arm")))
    summary_arms = entries("arms", S.get("arms"), {(r["reference"], r["arm"], r["condition"]) for r in made}, lambda x: (x.get("reference"), x.get("arm"), x.get("condition")))
    selected = {(r["reference"], r["provider"]) for r in made if r["arm"] == "block" and r["condition"] == "fresh" and r["status"] == "completed" and r.get("selection")}
    summary_selection = entries("selection", S.get("selection"), selected, lambda x: (x.get("reference"), x.get("provider")))
    encoded = {(r["reference"], r["provider"]) for r in made if r["arm"] == "block-positional"}
    encoded = {k_ for k_ in encoded if any(r["arm"] == "block" and (r["reference"], r["provider"]) == k_ and r["status"] == "completed" and not r.get("failure", {}).get("rerunEligible") for r in made)}
    summary_encodings = entries("encodings", S.get("encodings"), encoded, lambda x: (x.get("reference"), x.get("provider")))
    for x in S.get("pooled") or []:
        if x.get("provider") != PROVIDER_ID:
            finding(f"summary: a pooled entry for provider {x.get('provider')}")
    for x in S.get("arms") or []:
        if x.get("provider") != PROVIDER_ID:
            finding(f"summary: an arms entry for provider {x.get('provider')}")
for ref in REFERENCES:
    label = f"{ref}|{PROVIDER_ID}"
    mine_recs = [r for r in scored if r["reference"] == ref]
    pooled = {a: arm_stats([r for r in mine_recs if r["arm"] == a]) for a in ARMS}
    per_condition = {(a, c): arm_stats([r for r in mine_recs if r["arm"] == a and r["condition"] == c]) for a in ARMS for c in CONDITIONS}
    decision = decide(mine_recs, label)
    robustness = None
    if not A.quick:
        indep = decide(mine_recs, label, draw=random.Random(20261013).randrange, resamples=20000)["intervals"]
        seed_runs = []
        for seed in range(200):
            d = decide(mine_recs, label, draw=random.Random(seed).randrange, resamples=2000)
            seed_runs.append((d["intervals"], d["clarity"]))
        seed_summary = {}
        for k in DECISION_STATS:
            ivs = [iv[k] for iv, _ in seed_runs if iv[k]]
            seed_summary[k] = None if not ivs else {"lowMin": min(x["low"] for x in ivs), "lowMax": max(x["low"] for x in ivs), "highMin": min(x["high"] for x in ivs), "highMax": max(x["high"] for x in ivs)}
        seed_summary["overallClarity"] = dict(Counter(c["overall"] for _, c in seed_runs))
        seed_summary["criteria"] = {k: dict(Counter(c[k] for _, c in seed_runs)) for k in ("tokens", "vsProduction", "vsCapped")}
        robustness = {"independent20000": indep, "seeds200x2000": seed_summary}
    readings = {}
    for name, failing in READINGS.items():
        d = decide(score([r for r in records if r["reference"] == ref], failing), label)
        readings[name] = {"verdict": d["verdict"], "overall": d["clarity"]["overall"], "passed": d["counts"]["passed"], "evaluated": d["evaluated"], "reductionVsProduction": d["tokens"]["reductionVsProduction"], "passRates": d["passRates"], "intervals": {k: (v["low"], v["high"]) if v else None for k, v in d["intervals"].items()}}
    named, positional = thread_sums(mine_recs, "block"), thread_sums(mine_recs, "block-positional")
    enc_iv = bootstrap(
        {"named": named, "positional": positional},
        {
            "passDiff": lambda p: None if p["positional"]["passRate"] is None or p["named"]["passRate"] is None else p["positional"]["passRate"] - p["named"]["passRate"],
            "tokenReduction": lambda p: None if p["positional"]["tokensPerSuccess"] is None or not p["named"]["tokensPerSuccess"] else 1 - p["positional"]["tokensPerSuccess"] / p["named"]["tokensPerSuccess"],
        },
        spec_draw(f"{label}|encoding"),
    )
    encoding = {"paired": paired_counts(positional, named), "intervals": enc_iv}
    selection = {"n": 0, "correct": 0, "hit": 0, "missedToNull": 0, "wrongBlock": 0, "nullCorrect": 0, "falseBlock": 0, "explicitNull": 0, "omitted": 0, "rejected": 0, "planningFailed": 0, "intentCorrect": 0}
    for r in records:
        if r["reference"] != ref or r["arm"] != "block" or r["condition"] != "fresh" or r["status"] != "completed" or not r.get("selection"):
            continue
        s = r["selection"]
        selection["n"] += 1
        if s.get("planningFailed"):
            selection["planningFailed"] += 1
            continue
        answer = s.get("rejected") or s.get("chosen")
        exp = r["expected"]["block"]
        selection["correct"] += 1 if answer == exp else 0
        if exp:
            selection["hit" if answer == exp else "missedToNull" if answer is None else "wrongBlock"] += 1
        else:
            selection["nullCorrect" if answer is None else "falseBlock"] += 1
        if s.get("source") == "omitted":
            selection["omitted"] += 1
        elif answer is None:
            selection["explicitNull"] += 1
        if s.get("rejected"):
            selection["rejected"] += 1
        if r["plan"].get("intent") == r["expected"]["intent"]:
            selection["intentCorrect"] += 1
        planned = (r["plan"].get("block") or {}).get("id")
        if planned != s.get("chosen"):
            finding(f"{cell(r)}: selection.chosen {s.get('chosen')} != plan.block.id {planned}")
    selection["accuracy"] = ratio(selection["correct"], selection["n"])
    selection["intentAccuracy"] = ratio(selection["intentCorrect"], selection["n"])

    results[ref] = {"decision": decision, "pooled": pooled, "perCondition": {f"{a}|{c}": v for (a, c), v in per_condition.items()}, "selection": selection, "encoding": encoding, "readings": readings, "bootstrapRobustness": robustness}
    if not SUMMARY_CURRENT:
        continue
    decision_recs = [r for r in records if r["reference"] == ref and r["arm"] in DECISION_ARMS]
    if decision_recs:
        theirs = summary_decisions.get((ref, PROVIDER_ID))
        if theirs:
            compare(f"{ref}.decision", decision, theirs)
    for a in ARMS:
        t = summary_pooled.get((ref, a))
        if t:
            compare(f"{ref}.pooled.{a}", pooled[a], t)
    for (a, c), mine in per_condition.items():
        t = summary_arms.get((ref, a, c))
        if t:
            compare(f"{ref}.arms.{a}.{c}", mine, t)
    t = summary_selection.get((ref, PROVIDER_ID))
    if t:
        compare(f"{ref}.selection", selection, t)
    t = summary_encodings.get((ref, PROVIDER_ID))
    if t:
        compare(f"{ref}.encodings", encoding, t)
    sens = summary_sensitivity.get((ref, PROVIDER_ID))
    if sens:
        operation = {a: arm_stats([r for r in decision_recs if r["arm"] == a])["operation"] for a in DECISION_ARMS}
        compare(f"{ref}.sensitivity.operation", operation, sens["operation"])
        ways = sensitivity_ways(decision_recs, operation)
        if [x.get("failing") for x in sens.get("readings") or []] != ways:
            finding(f"{ref}: the summary's sensitivity readings are {[x.get('failing') for x in sens.get('readings') or []]}, the records call for {ways}")
        mine_readings = []
        for way in ways:
            d = decide(sensitivity_records(decision_recs, way), label)
            mine_readings.append({"failing": way, "reading": {"verdict": d["verdict"], "overall": d["clarity"]["overall"], "passed": d["counts"]["passed"], "evaluated": d["evaluated"], "reductionVsProduction": d["tokens"]["reductionVsProduction"]}})
        if len(mine_readings) == len(sens.get("readings") or []):
            compare(f"{ref}.sensitivity.readings", mine_readings, sens["readings"])
        holds = all(x["reading"]["verdict"] == decision["verdict"] for x in mine_readings)
        clear = all(x["reading"]["overall"] == decision["clarity"]["overall"] for x in mine_readings)
        compare(f"{ref}.sensitivity", {"verdictHolds": holds, "clarityHolds": clear, "robust": holds and clear}, {k: sens.get(k) for k in ("verdictHolds", "clarityHolds", "robust")})
    # The report states the verdict the decision reached (live/report.ts).
    heading = f"### {ref} on {PROVIDER_ID}: **{decision['verdict']}** ({'too few prompts behind it to call' if decision['clarity']['overall'] == 'insufficient' else decision['clarity']['overall']})"
    report_path = os.path.join(RUN, "REPORT.md")
    if not os.path.exists(report_path):
        (finding if A.complete else note)("REPORT.md: none beside summary.json")
    else:
        stated = [line for line in read_bytes(report_path).decode("utf-8").split("\n") if line.startswith(f"### {ref} on ")]
        if stated != [heading]:
            finding(f"REPORT.md states {stated}, not the decision recomputed here: {heading!r}")

totals = {
    "records": len(records),
    "completed": sum(1 for r in records if r["status"] == "completed"),
    "providerCalls": sum(r["tokens"]["providerCalls"] for r in records if r["status"] == "completed"),
    "inputTokens": sum(r["tokens"]["input"] for r in records if r["status"] == "completed"),
    "outputTokens": sum(r["tokens"]["output"] for r in records if r["status"] == "completed"),
    "requestBytes": sum(r["requestBytes"] for r in records if r["status"] == "completed"),
}
if SUMMARY_CURRENT:
    compare("totals", totals, S.get("totals"))
cells_expected = {"total": len(PLANNED), "done": len(records), "reused": reused_at_last}
if SUMMARY_CURRENT and summary_file.get("cells") != cells_expected:
    finding(f"summary cells {summary_file.get('cells')} != {cells_expected}")
unique_sup = list({js_stringify(r): r for r in superseded}.values())
spend = {"records": len(unique_sup), "providerCalls": sum(r["tokens"]["providerCalls"] for r in unique_sup), "inputTokens": sum(r["tokens"]["input"] for r in unique_sup), "outputTokens": sum(r["tokens"]["output"] for r in unique_sup), "requestBytes": sum(r["requestBytes"] for r in unique_sup)}
if SUMMARY_CURRENT:
    compare("superseded", spend, summary_file.get("superseded"))
    if summary_file.get("invocations") != pacing:
        finding("summary invocations differ from pacing.jsonl")
    if summary_file.get("stopped") != pacing_of[N].get("stopped"):
        finding(f"summary stopped {summary_file.get('stopped')} != the last invocation's {pacing_of[N].get('stopped')}")
    # The summary's telemetry is the last invocation's own, which its pacing entry also holds.
    compare("telemetry", pacing_of[N].get("telemetry"), summary_file.get("telemetry"))
    if summary_file.get("servedModel") != manifest.get("servedModel"):
        finding("summary servedModel differs from the manifest's")
    if summary_file.get("runId") != manifest["runId"] or summary_file.get("corpus") != manifest["corpus"] or summary_file.get("provider") != manifest["provider"]:
        finding("summary run id, corpus or provider differs from the manifest's")
    unknown = sorted(set(summary_file) - {"runId", "provider", "corpus", "cells", "stopped", "servedModel", "setAside", "telemetry", "invocations", "requests", "superseded", "summary"})
    if unknown:
        finding(f"summary.json holds fields this verifier does not know: {unknown}")
    unknown = sorted(set(S) - {"scoring", "arms", "pooled", "selection", "decisions", "sensitivity", "encodings", "totals"})
    if unknown:
        finding(f"summary.json's summary holds fields this verifier does not know: {unknown}")
# --- 10b. The monitor's events logs (--monitor-events), against the run ------------------------------------------------
# Each names its window (monitor up: window k), the invocation it opened (window opened <preflight time>), every live
# build it read, and, last, what it had seen: its count of the window's requests comes from the ledger lines it read,
# so a request the run's files no longer hold shows here.
def epoch_of(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


monitored = []
PINNED = None
if A.monitor_config:
    with open(A.monitor_config, encoding="utf-8") as f:
        PINNED = {k: v for k, v in json.load(f).items() if k not in ("note", "expect")}
for path in A.monitor_events:
    lines = [x.rstrip("\n") for x in open(path, encoding="utf-8") if x.strip()]
    events = []
    for x in lines:
        stamp, _, message = x.partition(" ")
        try:
            events.append((epoch_of(stamp), message))
        except ValueError:
            finding(f"monitor events {path}: an unreadable line {x[:80]!r}")
    up = next((m_ for _, msg in events for m_ in [re.match(r"monitor up: window (\d+),.*limits (\{.*\})$", msg)] if m_), None)
    if up is None:
        finding(f"monitor events {path}: no \"monitor up\" line naming its window and limits")
        continue
    k = int(up.group(1))
    limits_ = json.loads(up.group(2))
    if PINNED is not None and limits_ != PINNED:
        differ = {key: (limits_.get(key), PINNED.get(key)) for key in sorted(set(limits_) | set(PINNED)) if limits_.get(key) != PINNED.get(key)}
        finding(f"monitor events {path}: it ran with limits other than {A.monitor_config}'s: {differ}")
        limits_ = PINNED
    entry = {"events": path, "window": k}
    monitored.append(entry)
    if not 1 <= k <= N:
        finding(f"monitor events {path}: window {k}, but the run has {N} invocations")
        continue
    opened = [(t_, m_.group(1)) for t_, msg in events for m_ in [re.match(r"window opened (\S+):", msg)] if m_]
    if not opened:
        note(f"monitor events {path}: window {k}'s monitor stopped before it opened the window")
        continue
    if opened[0][1] != inv_at[k - 1]:
        finding(f"monitor events {path}: it watched the window opened {opened[0][1]}, but invocation {k}'s preflight is {inv_at[k - 1]}")
    progress = [m_ for _, msg in events for m_ in [re.search(r"(\d+) cells, (\d+) requests sent", msg)] if m_]
    final = events[-1][1]
    entry["last"] = final[:120]
    if final.startswith("handing back"):
        note(f"monitor events {path}: the monitor handed back while invocation {k} ran; what it saw is not all of it")
    elif progress:
        seen = int(progress[-1].group(2))
        entry["requestsSeen"] = seen
        if seen != len(by_inv.get(k, [])):
            finding(f"monitor events {path}: the monitor saw {seen} requests from invocation {k}, the ledger holds {len(by_inv.get(k, []))}")
    else:
        finding(f"monitor events {path}: no closing line with what the monitor saw")
    expected_build = deployment["buildId"]
    readings = [(t_, m_.group(1)) for t_, msg in events for m_ in [re.fullmatch(r"build (\S+)", msg)] if m_]
    readings += [(t_, None) for t_, msg in events if msg.startswith("the live build could not be read")]
    readings.sort()
    entry["buildReadings"] = len(readings)
    other = sorted({b for _, b in readings if b is not None and b != expected_build})
    stops = [msg for _, msg in events if msg.startswith(("STOP (", "HOLD ("))]
    entry["stops"] = stops
    if other:
        # The cells that settled requests after the last reading of the baseline's build may have been measured on
        # another deployment; the owner decides what becomes of them.
        good = [t_ for t_, b in readings if b == expected_build]
        settled_after = [r for r in by_inv.get(k, []) if r in finals and (not good or epoch_of(finals[r]["at"]) > max(good))]
        finding(f"monitor events {path}: the live build changed during invocation {k} to {other}; {len(settled_after)} of its requests settled after the monitor last read {expected_build}, so their cells may have been measured on another deployment")
    # The build is read every buildCheckSeconds on a thread of its own (each reading at most two 10 s fetches): no
    # stretch of the window may go longer than twice that without a reading.
    bound = 2 * limits_.get("buildCheckSeconds", 30) + 25
    times = [opened[0][0]] + [t_ for t_, _ in readings] + [events[-1][0]]
    gap = max((b_ - a_ for a_, b_ in zip(times, times[1:])), default=0)
    entry["longestGapSeconds"] = round(gap, 3)
    if gap > bound:
        finding(f"monitor events {path}: {gap:.0f} s passed without a live build reading during invocation {k} (at most {bound:.0f} s)")
    unconfirmed = sum(1 for _, b in readings if b is None)
    if unconfirmed:
        note(f"monitor events {path}: {unconfirmed} build readings during invocation {k} could not be read")
    early = [r for r in by_inv.get(k, []) if readings and epoch_of(reserves[r]["at"]) < readings[0][0] - bound]
    if early:
        note(f"monitor events {path}: {len(early)} of invocation {k}'s requests came before the monitor's first build reading")
if A.monitor_events or PINNED is not None:
    windows_ = [e["window"] for e in monitored]
    if len(set(windows_)) != len(windows_):
        finding(f"two monitor events logs name the same window (a restarted monitor appends to its window's log): {sorted(windows_)}")
    if PINNED is not None:
        for k in range(1, N + 1):
            if k not in windows_:
                finding(f"invocation {k} has no monitor events log")
info["monitorEvents"] = monitored

for path in TORN:
    (finding if A.complete or os.path.dirname(path) != RUN.rstrip("/") else note)(f"{path} ends with a cut-off line, which the next resume sets aside")

result = {"findings": findings, "notes": notes, "references": results, "totals": totals, "mapping": mapping, **info}
with open(A.out, "w") as f:
    json.dump(result, f, indent=1, sort_keys=False)

# --- 11. Print -------------------------------------------------------------------------------------------------------
L = info["ledger"]
print(f"run {manifest['runId']}: {N} invocations, {len(records)} of {len(PLANNED)} planned cells, {len(superseded)} moved aside by re-runs")
print(f"ledger: {L['reserved']} reserved, {L['finalized']} finalized, reasons {L['reasons']}, committed ${L['committedUsd']:.9f}, by UTC day {L['byUtcDay']}")
for e in invocations:
    k = e["invocation"]
    x = w[k]
    print(f"invocation {k} ({e['ended']}): {x['recordsLogged']} records ({x['completed']} completed, {x['skipped']} skipped), {e['moved']} moved aside at its start, {x['requestsFromCells']} requests from cells vs {x['ledgerRequests']} in the ledger, orphans {len(x['orphans'])}, released {x['releasedRefusals']}, backoffs {x.get('backoffMs')}, exhausted {x['exhaustedSchedules']}, committed ${x['committedUsd']:.9f}; first {x['firstCell']}, next {e['nextCell']}")
print(f"orphans: {[(o['request'].split('~')[1][:8] + '#' + o['request'].split('#')[1], o['reason']) for o in orphans]}")
print(f"cost: {info['cost']}")
print(f"history: {info['history']['steps']}")
print(f"surfaces: {info['surfaceChecks']}")
for ref, res in results.items():
    d = res["decision"]
    print(f"{ref}: decision {d['verdict']} ({d['clarity']['overall']}); tokens/success {d['tokens']}; pass {d['passRates']}; threads {d['threads']}; cohort {d['cohort']}/{d['meteredCohort']}")
    for k, v in d["intervals"].items():
        if v:
            print(f"  {k}: spec [{v['low']:.6f}, {v['high']:.6f}]")
print(f"totals {totals}")
print(f"NOTES: {len(notes)}")
for n_ in notes:
    print(" -", n_)
print(f"FINDINGS: {len(findings)}")
for f_ in findings:
    print(" -", f_)
sys.exit(1 if findings else 0)
