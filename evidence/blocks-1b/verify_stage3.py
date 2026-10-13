#!/usr/bin/env python3
"""Independent verification of the Astryx Stage-3 run (corpus blocks-1b v2), from its preserved artifacts alone.

Nothing here imports, runs or reads the harness's code. Every figure is recomputed from the raw files (requests.jsonl,
runs.jsonl, pacing.jsonl, manifest.json) and the frozen corpus, following the written definitions (ADR-B3, its
addendum, and amendment 2):
- the ledger, request by request, and the cell-to-request mapping for each invocation separately;
- settlement arithmetic in whole nanodollars, models, tokens and costs;
- the add and remove check, re-derived from the saved prior and refined surfaces, and the surface digests;
- binding scoring, the pooled and per-condition arm statistics, and the ADR-B3 decision;
- the paired cluster bootstrap, replicated exactly as specified (seeded, 2,000 resamples) and again with an independent
  generator and many seeds;
- the paired counts, selection, retention, fallback, repairs, latency, parity and the named-against-positional comparison.
Each is compared with summary.json, and every disagreement is listed. It writes a JSON result and prints a summary.

Usage: python3 -I verify_stage3.py <run dir> <window-1 evidence copy of the run dir> <corpus json> <out json>
"""
import hashlib
import json
import os
import random
import sys
from collections import Counter, defaultdict

RUN, W1, CORPUS_PATH, OUT = sys.argv[1:5]

# Claude Haiku 4.5 list prices, $1 and $5 per million tokens, with Cloudflare's 5% credit fee, in whole nanodollars.
NANO_IN, NANO_OUT = 1050, 5250
MODEL = "claude-haiku-4-5-20251001"
PROVIDER = "hosted-ai:claude-haiku-4.5"
ADD_REMOVE = {"refine-add", "refine-remove"}
ARMS = ["block", "block-positional", "capped", "production"]
DECISION_ARMS = ["block", "capped", "production"]
CONDITIONS = ["fresh", "refine-content", "refine-add", "refine-remove", "refine-structural"]
SETTLED, RELEASED, UNVERIFIED = "settled at the reported usage", "refused before any provider call", "usage not verified"

findings = []  # disagreements and integrity issues: the verification passes only if this stays empty
info = {}


def finding(message):
    findings.append(message)


def jl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


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


# --- 1. Files ------------------------------------------------------------------------------------------------------
files = {}
for name in sorted(os.listdir(RUN)):
    p = os.path.join(RUN, name)
    with open(p, "rb") as f:
        data = f.read()
    files[name] = {"bytes": len(data), "lines": data.count(b"\n"), "sha256": hashlib.sha256(data).hexdigest()}
info["files"] = files

# Window 1's copy must be an exact prefix of each append-only log, and the run's identity files must be unchanged.
prefix = {}
for name in ["requests.jsonl", "runs.jsonl", "pacing.jsonl"]:
    with open(os.path.join(W1, name), "rb") as f:
        before = f.read()
    with open(os.path.join(RUN, name), "rb") as f:
        after = f.read()
    ok = after.startswith(before)
    prefix[name] = {"window1Bytes": len(before), "finalBytes": len(after), "prefix": ok}
    if not ok:
        finding(f"{name}: window 1's content is not a prefix of the final file")
for name in ["manifest.json", "preflight.json"]:
    same = sha256_file(os.path.join(W1, name)) == sha256_file(os.path.join(RUN, name))
    prefix[name] = {"unchanged": same}
    if not same:
        finding(f"{name} changed after window 1")
info["appendOnly"] = prefix

manifest = json.load(open(os.path.join(RUN, "manifest.json")))
summary_file = json.load(open(os.path.join(RUN, "summary.json")))
S = summary_file["summary"]
corpus = json.load(open(CORPUS_PATH))
corpus_prompts = {p["id"]: p for p in corpus["prompts"]}

# --- 2. The ledger ---------------------------------------------------------------------------------------------------
ledger = jl(os.path.join(RUN, "requests.jsonl"))
reserves, finals, order = {}, {}, []
line_of = {}
last_at = ""
for i, line in enumerate(ledger):
    if line["at"] < last_at:
        finding(f"requests.jsonl line {i + 1}: time goes backwards")
    last_at = line["at"]
    req = line.get("request")
    if not req or not req.startswith(line.get("invocation", "") + "#"):
        finding(f"requests.jsonl line {i + 1}: request id does not belong to its invocation")
    if "adjust" in line:
        if req in finals:
            finding(f"{req}: finalized twice")
        if req not in reserves:
            finding(f"{req}: finalized before it was reserved")
        finals[req] = line
        line_of[(req, "final")] = i
    elif set(line) == {"at", "invocation", "request", "usd"}:
        if req in reserves:
            finding(f"{req}: reserved twice")
        reserves[req] = line
        order.append(req)
        line_of[(req, "reserve")] = i
    else:
        finding(f"requests.jsonl line {i + 1}: unrecognized line {sorted(line)}")

nano = lambda usd: round(usd * 1e9)  # the ledger counts whole nanodollars
invocations = []
for req in order:
    inv = reserves[req]["invocation"]
    if inv not in invocations:
        invocations.append(inv)
by_inv = {inv: [r for r in order if reserves[r]["invocation"] == inv] for inv in invocations}
for inv, reqs in by_inv.items():
    for n, req in enumerate(reqs, 1):
        if req != f"{inv}#{n}":
            finding(f"{req}: request numbers are not consecutive within {inv}")
# Serial: each request is finalized before the next one is reserved.
for a, b in zip(order, order[1:]):
    if a in finals and line_of[(a, "final")] > line_of[(b, "reserve")]:
        finding(f"{a} was finalized after {b} was reserved")
reasons = Counter()
for req in order:
    r, f = reserves[req], finals.get(req)
    if f is None:
        finding(f"{req}: reserved and never finalized")
        continue
    reasons[f["reason"]] += 1
    if nano(r["usd"]) + nano(f["adjust"]) != nano(f["final"]):
        finding(f"{req}: reserve {r['usd']} + adjust {f['adjust']} != final {f['final']}")
    if f["reason"] == RELEASED and nano(f["final"]) != 0:
        finding(f"{req}: released at {f['final']}, not zero")
    if f["reason"] == UNVERIFIED and nano(f["final"]) < nano(r["usd"]):
        finding(f"{req}: an unverified request settled below its reservation")
    if f["reason"] not in (SETTLED, RELEASED, UNVERIFIED):
        finding(f"{req}: unexpected reason {f['reason']!r}")
    if f["reason"] == SETTLED and f.get("servedModel") != MODEL:
        finding(f"{req}: settled on {f.get('servedModel')!r}")
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
    "invocations": {inv: {"requests": len(reqs), "committedUsd": sum(nano(finals[r]["final"]) for r in reqs) / 1e9} for inv, reqs in by_inv.items()},
    "unverified": [{"request": r, "reservedUsd": reserves[r]["usd"], "finalUsd": finals[r]["final"], "at": finals[r]["at"]} for r in order if finals[r]["reason"] == UNVERIFIED],
}
if summary_file["requests"]["sent"] != len(reserves):
    finding(f"summary requests.sent {summary_file['requests']['sent']} != {len(reserves)} reserved")
if nano(summary_file["requests"]["usd"]) != committed_nano:
    finding(f"summary requests.usd {summary_file['requests']['usd']} != committed {committed_nano / 1e9}")
if len(reserves) > manifest["limits"]["maxTotalRequests"] or committed_nano > nano(manifest["limits"]["maxTotalUsd"]):
    finding("the ledger exceeds the run's caps")

# --- 3. The records --------------------------------------------------------------------------------------------------
records = jl(os.path.join(RUN, "runs.jsonl"))
keyed = Counter((r["arm"], r["prompt"], r["condition"]) for r in records)
prompt_ids = manifest["selection"]["promptIds"]
grid = {(a, p, c) for a in ARMS for p in prompt_ids for c in CONDITIONS}
if set(keyed) != grid or any(n != 1 for n in keyed.values()):
    finding(f"the records are not the 480-cell grid exactly once: missing {len(grid - set(keyed))}, extra {len(set(keyed) - grid)}, repeated {sum(1 for n in keyed.values() if n > 1)}")
for r in records:
    if r["reference"] != "astryx" or r["provider"] != PROVIDER:
        finding(f"{r['arm']}|{r['prompt']}|{r['condition']}: reference or provider differs")
    cp = corpus_prompts[r["prompt"]]
    if r["expected"] != {"intent": cp["intent"]["astryx"], "block": cp["block"]}:
        finding(f"{r['prompt']}: the record's expected labels differ from the frozen corpus")
times = [r["at"] for r in records]
if times != sorted(times):
    finding("runs.jsonl is not in time order")
fresh_of = {(r["arm"], r["prompt"]): r for r in records if r["condition"] == "fresh"}
cell = lambda r: f"{r['arm']}|{r['prompt']}|{r['condition']}"


def provider_calls(r):
    return [c for c in r["calls"] if c.get("source") == "provider"]


# Tokens, calls and models, from each record's own calls.
for r in records:
    pc = provider_calls(r)
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool)
    unreported = sum(1 for c in pc if not (whole(c.get("inputTokens")) and whole(c.get("outputTokens"))))
    tin = sum(c["inputTokens"] for c in pc if whole(c.get("inputTokens")))
    tout = sum(c["outputTokens"] for c in pc if whole(c.get("outputTokens")))
    free = sum(1 for c in r["calls"] if c.get("source") != "provider")
    mine = {"input": tin, "output": tout, "providerCalls": len(pc), "unreportedCalls": unreported, "modelFreeCalls": free}
    if r["status"] == "completed" and mine != r["tokens"]:
        finding(f"{cell(r)}: tokens {r['tokens']} != recomputed {mine}")
    for c in pc:
        if c.get("model") != MODEL:
            finding(f"{cell(r)}: a provider call on {c.get('model')!r}")
    if r["condition"] == "fresh" and r["status"] == "completed":
        if [c for c in r["calls"] if c["operation"] == "plan"] != r["plan"]["calls"]:
            finding(f"{cell(r)}: the plan's calls differ from the record's plan calls")

# --- 4. Cells to requests, per invocation -----------------------------------------------------------------------------
inv_start = {inv: inv.split("~")[0] for inv in invocations}
starts = sorted(invocations, key=lambda i: inv_start[i])


def invocation_of(r):
    owner = None
    for inv in starts:
        if r["at"] >= inv_start[inv]:
            owner = inv
    return owner


def requests_of(r):
    """A record's gateway requests in order: a call that is no Worker sub-call begins one; a parse retry joins it."""
    out = []
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
w = {}
for inv in starts:
    cells = [r for r in records if r["status"] == "completed" and invocation_of(r) == inv]
    logged = [r for r in records if invocation_of(r) == inv]
    seq = [(r, q) for r in cells for q in requests_of(r)]
    reqs = by_inv[inv]
    if len(seq) > len(reqs):
        finding(f"{inv}: its cells made {len(seq)} requests, the ledger has {len(reqs)}")
    prev_at = inv_start[inv]
    prev_cell = None
    mismatches = 0
    for k, (r, q) in enumerate(seq):
        if k >= len(reqs):
            break
        req = reqs[k]
        res, fin = reserves[req], finals[req]
        if prev_cell is not r:
            # The cell's first request is reserved after the previous cell was logged.
            if res["at"] < prev_at:
                finding(f"{req}: reserved before the previous cell was logged")
                mismatches += 1
            prev_cell = r
        if fin["at"] > r["at"]:
            finding(f"{req}: finalized after its cell {cell(r)} was logged")
            mismatches += 1
        if q[0].get("source") != "provider":
            if fin["reason"] != RELEASED:
                finding(f"{req}: a refused call in {cell(r)}, but the ledger says {fin['reason']!r}")
                mismatches += 1
        else:
            cost = sum(c["inputTokens"] * NANO_IN + c["outputTokens"] * NANO_OUT for c in q)
            if fin["reason"] != SETTLED or nano(fin["final"]) != cost:
                finding(f"{req}: {cell(r)} reported {cost / 1e9:.9f}, the ledger settled {fin['final']} ({fin['reason']})")
                mismatches += 1
            if any(c.get("model") != fin.get("servedModel") for c in q):
                finding(f"{req}: the call's model differs from the ledger's servedModel")
                mismatches += 1
            mapped_cost_nano[inv] += cost
            list_cost[inv] += sum(c["inputTokens"] * 1e-6 + c["outputTokens"] * 5e-6 for c in q)
        mapping[req] = {"cell": cell(r), "calls": len(q), "operation": q[0]["operation"], "reason": fin["reason"]}
        prev_at = r["at"]
    leftover = reqs[len(seq):]
    for req in leftover:
        orphans.append({"request": req, "reason": finals[req]["reason"], "finalUsd": finals[req]["final"], "reservedAt": reserves[req]["at"], "finalAt": finals[req]["at"]})
    w[inv] = {
        "recordsLogged": len(logged),
        "completed": len(cells),
        "skipped": len(logged) - len(cells),
        "requestsFromCells": len(seq),
        "ledgerRequests": len(reqs),
        "orphans": leftover,
        "mappingMismatches": mismatches,
        "settledFromCellsUsd": mapped_cost_nano[inv] / 1e9,
        "listUsd": round(list_cost[inv], 9),
        "committedUsd": sum(nano(finals[r]["final"]) for r in reqs) / 1e9,
        "firstCell": cell(logged[0]) if logged else None,
        "lastCell": cell(logged[-1]) if logged else None,
        "providerCalls": sum(len(provider_calls(r)) for r in cells),
        "workerParseRetries": sum(1 for r in cells for c in provider_calls(r) if c.get("subCall", 0) > 0),
        "releasedRefusals": sum(1 for r in cells for c in r["calls"] if c.get("source") != "provider"),
        "inputTokens": sum(r["tokens"]["input"] for r in cells),
        "outputTokens": sum(r["tokens"]["output"] for r in cells),
    }
info["invocations"] = w
info["orphans"] = orphans
for o in orphans:
    if o["reason"] == SETTLED:
        finding(f"{o['request']}: settled but belongs to no logged cell")
held_nano = sum(nano(o["finalUsd"]) for o in orphans)
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

# The pacer's waits.
pacing = jl(os.path.join(RUN, "pacing.jsonl"))
info["pacing"] = []
for p in pacing:
    t = p["telemetry"]["pacing"]
    waits = Counter(x["reason"] for x in t["waits"])
    backoffs = [x for x in t["waits"] if x["reason"] != "spacing"]
    info["pacing"].append({"invocation": p["id"], "sent": t["sent"], "waits": dict(waits), "backoffSeconds": [x["ms"] / 1000 for x in backoffs]})
    if t["sent"] != len(by_inv.get(p["id"], [])):
        finding(f"pacing {p['id']}: sent {t['sent']} != ledger {len(by_inv.get(p['id'], []))}")
    released = sum(1 for r in by_inv.get(p["id"], []) if finals[r]["reason"] == RELEASED)
    if len(backoffs) != released:
        finding(f"pacing {p['id']}: {len(backoffs)} backoffs, {released} released refusals")
    if any(x["ms"] != t["backoffMs"][0] for x in backoffs):
        finding(f"pacing {p['id']}: a backoff beyond the first step")


# --- 5. The add and remove check and the surface digests, re-derived from the surfaces ------------------------------
def js_stringify(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


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
    first, rest = counts[0], counts[1:]
    return {k for k, n in first.items() if n == 1 and all(c.get(k) == 1 for c in rest)}


def list_lengths(surface, ids):
    out = {}

    def anchor(node):
        k = id_key(node)
        return k if k and k in ids else None

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
    ids = shared_ids(prior, refined)
    before, after = list_lengths(prior, ids), list_lengths(refined, ids)
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
for r in records:
    if r.get("passed") and r.get("surface") is not None:
        if hashlib.sha256(js_stringify(r["surface"]).encode("utf-8")).hexdigest() != r.get("surfaceDigest"):
            digest_mismatch += 1
            finding(f"{cell(r)}: surfaceDigest does not match its surface")
    if r["condition"] == "fresh" or not r.get("passed"):
        if "operation" in r or "changed" in r:
            finding(f"{cell(r)}: carries an operation or changed it should not")
        continue
    prior = fresh_of[(r["arm"], r["prompt"])]
    changed = r["surfaceDigest"] != prior["surfaceDigest"]
    if changed != r.get("changed"):
        changed_mismatch += 1
        finding(f"{cell(r)}: changed {r.get('changed')} != recomputed {changed}")
    if r["condition"] in ADD_REMOVE:
        mine = check_operation("add" if r["condition"] == "refine-add" else "remove", prior["surface"], r["surface"])
        ops[cell(r)] = mine
        if mine != r.get("operation"):
            op_mismatch += 1
            finding(f"{cell(r)}: operation {r.get('operation')} != recomputed {mine}")
info["surfaceChecks"] = {"digestMismatches": digest_mismatch, "operationMismatches": op_mismatch, "changedMismatches": changed_mismatch, "operationsRecomputed": len(ops)}

# --- 6. Scoring and the arm statistics ----------------------------------------------------------------------------
for r in records:
    if r["status"] == "completed" and r.get("outcome") == "failed-adapter":
        kind = r["failure"]["kind"]
        if r["failure"]["rerunEligible"] != (kind in ("provider", "policy")):
            finding(f"{cell(r)}: rerunEligible does not follow its kind {kind}")
    if r.get("failure", {}).get("rerunEligible"):
        finding(f"{cell(r)}: a re-run eligible failure ({r['failure']['kind']}) in the decision records")


def gate_passed(r):
    return bool(r.get("passed")) or r.get("outcome") == "passed"


def score(recs, failing):
    """The records as a reading counts them: failing(r, op) says whether a passing add or remove fails."""
    out = []
    for r in recs:
        op = ops.get(cell(r))
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
scored = score(records, READINGS["binding (missed or unchecked)"])


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
        checked = [r for r in runs if gate_passed(r) and cell(r) in ops]
        return {
            "checked": len(checked),
            "performed": sum(1 for r in checked if performed(ops[cell(r)])),
            "mixed": sum(1 for r in checked if ops[cell(r)]["observed"] == "mixed"),
            "missed": sum(1 for r in checked if missed(ops[cell(r)])),
            "unchanged": sum(1 for r in checked if missed(ops[cell(r)]) and r.get("changed") is False),
            "unchecked": sum(1 for r in runs if gate_passed(r) and r["condition"] in ADD_REMOVE and cell(r) not in ops),
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
    return {
        "n": len(recs),
        "skipped": len(recs) - len(completed),
        "completed": len(completed),
        "rerunEligible": 0,
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


pooled = {a: arm_stats([r for r in scored if r["arm"] == a]) for a in ARMS}
per_condition = {(a, c): arm_stats([r for r in scored if r["arm"] == a and r["condition"] == c]) for a in ARMS for c in CONDITIONS}


# --- 7. The decision and its intervals ------------------------------------------------------------------------------
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
OPTIONS = manifest["decision"]


def clarity_of(iv, threshold, enough):
    if not iv:
        return "n/a"
    if not enough:
        return "insufficient"
    return "clear-pass" if iv["low"] >= threshold - EPS else "clear-fail" if iv["high"] < threshold - EPS else "uncertain"


def paired_counts(first, second):
    out = {"prompts": 0, "passRate": {"better": 0, "same": 0, "worse": 0}, "tokensPerSuccess": {"lower": 0, "same": 0, "higher": 0, "comparable": 0}}
    for p, a in first.items():
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


def decide(recs, label="astryx|" + PROVIDER, draw=None, resamples=2000):
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


decision = decide(scored)

# The same intervals from an independent generator (Python's Mersenne Twister), 20,000 resamples.
indep = decide(scored, draw=random.Random(20261013).randrange, resamples=20000)["intervals"]
# And across 200 seeds of 2,000 resamples each: does any seed change a criterion's clarity?
seed_runs = []
for seed in range(200):
    d = decide(scored, draw=random.Random(seed).randrange, resamples=2000)
    seed_runs.append((d["intervals"], d["clarity"]))
seed_summary = {}
for k in DECISION_STATS:
    lows = [iv[k]["low"] for iv, _ in seed_runs]
    highs = [iv[k]["high"] for iv, _ in seed_runs]
    seed_summary[k] = {"lowMin": min(lows), "lowMax": max(lows), "highMin": min(highs), "highMax": max(highs)}
seed_summary["overallClarity"] = dict(Counter(c["overall"] for _, c in seed_runs))
seed_summary["criteria"] = {k: dict(Counter(c[k] for _, c in seed_runs)) for k in ("tokens", "vsProduction", "vsCapped")}
info["bootstrapRobustness"] = {"independent20000": indep, "seeds200x2000": seed_summary}

# The readings beside the verdict.
readings = {}
for name, failing in READINGS.items():
    d = decide(score(records, failing))
    readings[name] = {"verdict": d["verdict"], "overall": d["clarity"]["overall"], "passed": d["counts"]["passed"], "evaluated": d["evaluated"], "reductionVsProduction": d["tokens"]["reductionVsProduction"], "passRates": d["passRates"], "intervals": {k: (v["low"], v["high"]) for k, v in d["intervals"].items()}}
info["readings"] = readings

# Named against positional (ADR-B2).
named, positional = thread_sums(scored, "block"), thread_sums(scored, "block-positional")
enc_sums = {"named": named, "positional": positional}
enc_iv = bootstrap(
    enc_sums,
    {
        "passDiff": lambda p: None if p["positional"]["passRate"] is None or p["named"]["passRate"] is None else p["positional"]["passRate"] - p["named"]["passRate"],
        "tokenReduction": lambda p: None if p["positional"]["tokensPerSuccess"] is None or not p["named"]["tokensPerSuccess"] else 1 - p["positional"]["tokensPerSuccess"] / p["named"]["tokensPerSuccess"],
    },
    spec_draw(f"astryx|{PROVIDER}|encoding"),
)
encoding = {"paired": paired_counts(positional, named), "intervals": enc_iv}

# Selection (block arm, fresh, completed).
sel = {"n": 0, "correct": 0, "hit": 0, "missedToNull": 0, "wrongBlock": 0, "nullCorrect": 0, "falseBlock": 0, "explicitNull": 0, "omitted": 0, "rejected": 0, "planningFailed": 0, "intentCorrect": 0}
for r in records:
    if r["arm"] != "block" or r["condition"] != "fresh" or r["status"] != "completed" or not r.get("selection"):
        continue
    s = r["selection"]
    sel["n"] += 1
    if s.get("planningFailed"):
        sel["planningFailed"] += 1
        continue
    answer = s.get("rejected") or s.get("chosen")
    exp = r["expected"]["block"]
    sel["correct"] += 1 if answer == exp else 0
    if exp:
        sel["hit" if answer == exp else "missedToNull" if answer is None else "wrongBlock"] += 1
    else:
        sel["nullCorrect" if answer is None else "falseBlock"] += 1
    if s.get("source") == "omitted":
        sel["omitted"] += 1
    elif answer is None:
        sel["explicitNull"] += 1
    if s.get("rejected"):
        sel["rejected"] += 1
    if r["plan"].get("intent") == r["expected"]["intent"]:
        sel["intentCorrect"] += 1
    # The planner's answer, re-derived from the plan itself.
    planned = (r["plan"].get("block") or {}).get("id")
    if planned != s.get("chosen"):
        finding(f"{cell(r)}: selection.chosen {s.get('chosen')} != plan.block.id {planned}")
sel["accuracy"] = ratio(sel["correct"], sel["n"])
sel["intentAccuracy"] = ratio(sel["intentCorrect"], sel["n"])

totals = {
    "records": len(records),
    "completed": sum(1 for r in records if r["status"] == "completed"),
    "providerCalls": sum(r["tokens"]["providerCalls"] for r in records if r["status"] == "completed"),
    "inputTokens": sum(r["tokens"]["input"] for r in records if r["status"] == "completed"),
    "outputTokens": sum(r["tokens"]["output"] for r in records if r["status"] == "completed"),
    "requestBytes": sum(r["requestBytes"] for r in records if r["status"] == "completed"),
}


# --- 8. Compare with summary.json -----------------------------------------------------------------------------------
def compare(label, mine, theirs, tol=1e-9):
    if isinstance(mine, dict) and isinstance(theirs, dict):
        for k in sorted(set(mine) | set(theirs)):
            if k in ("reference", "provider", "arm", "condition", "options", "reasons", "rerunByKind"):
                continue
            if k not in mine or k not in theirs:
                finding(f"{label}.{k}: present on one side only (mine {k in mine}, summary {k in theirs})")
                continue
            compare(f"{label}.{k}", mine[k], theirs[k], tol)
    elif isinstance(mine, (int, float)) and isinstance(theirs, (int, float)) and not isinstance(mine, bool):
        if not close(float(mine), float(theirs), tol):
            finding(f"{label}: mine {mine} != summary {theirs}")
    elif mine != theirs:
        finding(f"{label}: mine {mine!r} != summary {theirs!r}")


compare("decision", decision, {k: v for k, v in S["decisions"][0].items()})
for a in ARMS:
    theirs = next(x for x in S["pooled"] if x["arm"] == a)
    compare(f"pooled.{a}", pooled[a], theirs)
for (a, c), mine in per_condition.items():
    theirs = next(x for x in S["arms"] if x["arm"] == a and x["condition"] == c)
    compare(f"arms.{a}.{c}", mine, theirs)
compare("selection", sel, S["selection"][0])
compare("encodings", encoding, S["encodings"][0])
compare("totals", totals, S["totals"])
sens = S["sensitivity"][0]
compare("sensitivity.operation", {a: pooled[a]["operation"] for a in DECISION_ARMS}, sens["operation"])
their_none = next(x["reading"] for x in sens["readings"] if x["failing"] == "none")
mine_none = readings["none"]
compare("sensitivity.none", {"verdict": mine_none["verdict"], "overall": mine_none["overall"], "passed": mine_none["passed"], "evaluated": mine_none["evaluated"], "reductionVsProduction": mine_none["reductionVsProduction"]}, their_none)
if any(x["failing"] != "none" for x in sens["readings"]):
    finding("the summary lists a reading beyond 'none', but no decision arm has a mixed change")
if summary_file["cells"] != {"total": 480, "done": 480, "reused": w[starts[0]]["recordsLogged"]}:
    finding(f"summary cells {summary_file['cells']} disagree")
if summary_file["stopped"] is not None:
    finding("the final summary records a stop")

result = {
    "findings": findings,
    "decision": decision,
    "pooled": pooled,
    "perCondition": {f"{a}|{c}": v for (a, c), v in per_condition.items()},
    "selection": sel,
    "encoding": encoding,
    "totals": totals,
    "mapping": mapping,
    **info,
}
with open(OUT, "w") as f:
    json.dump(result, f, indent=1, sort_keys=False)

# --- 9. Print --------------------------------------------------------------------------------------------------------
L = info["ledger"]
print(f"ledger: {L['reserved']} reserved, {L['finalized']} finalized, reasons {L['reasons']}, committed ${L['committedUsd']:.9f}, by UTC day {L['byUtcDay']}")
for inv in starts:
    x = w[inv]
    print(f"invocation {inv}: {x['recordsLogged']} records ({x['completed']} completed, {x['skipped']} skipped), {x['requestsFromCells']} requests from cells vs {x['ledgerRequests']} in the ledger, orphans {x['orphans']}, mismatches {x['mappingMismatches']}, provider calls {x['providerCalls']} ({x['workerParseRetries']} Worker parse retries), released {x['releasedRefusals']}, tokens {x['inputTokens']}/{x['outputTokens']}, list ${x['listUsd']:.6f}, settled ${x['settledFromCellsUsd']:.9f}, committed ${x['committedUsd']:.9f}; first {x['firstCell']}, last {x['lastCell']}")
print(f"orphans: {orphans}")
print(f"cost: {info['cost']}")
print(f"pacing: {info['pacing']}")
print(f"append-only: {info['appendOnly']}")
print(f"surfaces: {info['surfaceChecks']}")
d = decision
print(f"decision: {d['verdict']} ({d['clarity']['overall']}); tokens/success {d['tokens']}; pass {d['passRates']}; counts {d['counts']}; threads {d['threads']}; cohort {d['cohort']}/{d['meteredCohort']}")
for k, v in d["intervals"].items():
    print(f"  {k}: spec [{v['low']:.6f}, {v['high']:.6f}] | independent 20k [{indep[k]['low']:.6f}, {indep[k]['high']:.6f}] | 200 seeds low {seed_summary[k]['lowMin']:.4f}..{seed_summary[k]['lowMax']:.4f} high {seed_summary[k]['highMin']:.4f}..{seed_summary[k]['highMax']:.4f}")
print(f"  clarity {d['clarity']}; over 200 seeds {seed_summary['overallClarity']} {seed_summary['criteria']}")
print(f"  paired {d['paired']}")
for name, x in readings.items():
    print(f"reading {name}: {x['verdict']} ({x['overall']}), passed {x['passed']}, reduction {x['reductionVsProduction']:.4f}")
print(f"selection {sel}")
print(f"encoding {encoding}")
print(f"totals {totals}")
print(f"FINDINGS: {len(findings)}")
for f_ in findings:
    print(" -", f_)
