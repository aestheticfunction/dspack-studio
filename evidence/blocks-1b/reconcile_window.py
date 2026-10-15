"""An independent reconciliation of a hosted Phase 1B run's window from its raw files: the ledger (requests.jsonl), the
cell records (runs.jsonl), the pacing entries, the manifest and preflights, the operator's invocation record and the
monitor's events log. It shares no code with the harness or verify_run.py. No network.

    python3 -I reconcile.py <run dir> <invocations.txt> <monitor events log> <out.json>
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

RUN, INVOCATIONS, EVENTS, OUT = sys.argv[1:5]
SETTLED = "settled at the reported usage"
RELEASED = "refused before any provider call"
UNVERIFIED = "usage not verified"
NEVER_READ = "a request whose reply was never read"
IN, OUTP, FEE = 1e-6, 5e-6, 1.05  # Claude Haiku 4.5's list prices per token, and Cloudflare's 5% credit fee
nano = lambda usd: round(usd * 1e9)


def jl(name):
    path = os.path.join(RUN, name)
    if not os.path.exists(path):
        return []
    return [json.loads(x) for x in open(path, encoding="utf-8") if x.strip()]


manifest = json.load(open(os.path.join(RUN, "manifest.json")))
preflights = sorted([f for f in os.listdir(RUN) if re.fullmatch(r"preflight(\.resume-\d+)?\.json", f)])
pre = {f: json.load(open(os.path.join(RUN, f))) for f in preflights}
ledger = jl("requests.jsonl")
records = jl("runs.jsonl")
pacing = jl("pacing.jsonl")
summary = json.load(open(os.path.join(RUN, "summary.json"))) if os.path.exists(os.path.join(RUN, "summary.json")) else None

# The ledger: one reservation and one final per request.
reserves, finals, dup = {}, {}, []
for x in ledger:
    target = finals if "adjust" in x else reserves
    if x["request"] in target:
        dup.append(x["request"])
    target[x["request"]] = x
open_ = sorted(set(reserves) - set(finals), key=lambda r: int(r.rsplit("#", 1)[1]))
orphan_finals = sorted(set(finals) - set(reserves))
invocations = sorted({x["invocation"] for x in reserves.values()})
by_reason = defaultdict(lambda: {"requests": 0, "nanos": 0})
models_settled = Counter()
for r, f in finals.items():
    b = by_reason[f["reason"]]
    b["requests"] += 1
    b["nanos"] += nano(f["final"])
    if f["reason"] == SETTLED:
        models_settled[f.get("servedModel")] += 1
    # Each final is its reservation adjusted: final = reserved + adjust.
arith = [r for r, f in finals.items() if r in reserves and abs(nano(reserves[r]["usd"]) + nano(f["adjust"]) - nano(f["final"])) > 1]
released_nonzero = [r for r, f in finals.items() if f["reason"] == RELEASED and nano(f["final"]) != 0]
committed = sum(nano(f["final"]) for f in finals.values()) + sum(nano(reserves[r]["usd"]) for r in open_)
settled_nanos = by_reason[SETTLED]["nanos"]

# The cell records: calls, tokens and models, priced as the ledger prices a settled reply.
calls = []
for rec in records:
    # A record's calls include its planning calls (plan.calls lists them again, so it is not added).
    for c in rec.get("calls") or []:
        calls.append((rec, c))
provider_calls = [c for _, c in calls if c.get("source") == "provider"]
tok_in = sum(c.get("inputTokens") or 0 for c in provider_calls)
tok_out = sum(c.get("outputTokens") or 0 for c in provider_calls)
priced_records = sum(nano(((c.get("inputTokens") or 0) * IN + (c.get("outputTokens") or 0) * OUTP) * FEE) for c in provider_calls)
models_calls = Counter(c.get("model") for c in provider_calls)
outcomes = Counter((rec.get("arm"), rec.get("condition"), rec.get("status")) for rec in records)
statuses = Counter(rec.get("status") for rec in records)
passed = sum(1 for rec in records if rec.get("passed"))
arms = Counter(rec.get("arm") for rec in records)
conditions = Counter(rec.get("condition") for rec in records)

# The operator's record and the monitor's events.
operator = [x.strip() for x in open(INVOCATIONS, encoding="utf-8") if x.strip()] if os.path.exists(INVOCATIONS) else []
events = [x.rstrip("\n") for x in open(EVENTS, encoding="utf-8") if x.strip()] if os.path.exists(EVENTS) else []
stops = [e for e in events if re.search(r" (STOP|HOLD) \(", e)]
released_lines = [e for e in events if "released" in e and "refus" in e.lower()]
builds = Counter(m.group(1) for e in events for m in [re.search(r" build (\S+)$", e)] if m)

out = {
    "run": RUN,
    "manifest": {k: manifest.get(k) for k in ("reference", "corpus", "codeIdentity", "deployment", "servedModel", "limits", "provider") if k in manifest},
    "preflights": {f: {k: p.get(k) for k in ("at", "buildId", "models", "drafts") if k in p} | {"worker": (p.get("worker") or {}).get("shape")} for f, p in pre.items()},
    "ledger": {
        "invocations": len(invocations),
        "reservations": len(reserves),
        "finals": len(finals),
        "open": open_,
        "duplicates": dup,
        "orphanFinals": orphan_finals,
        "arithmeticMismatches": arith,
        "releasedAboveZero": released_nonzero,
        "byReason": {k: {"requests": v["requests"], "usd": v["nanos"] / 1e9} for k, v in by_reason.items()},
        "committedUsd": committed / 1e9,
        "settledUsd": settled_nanos / 1e9,
        "settledUsdAtList": settled_nanos / 1e9 / FEE,
        "servedModels": dict(models_settled),
        "reservedUsd": sum(nano(x["usd"]) for x in reserves.values()) / 1e9,
    },
    "records": {
        "cells": len(records),
        "statuses": dict(statuses),
        "passed": passed,
        "arms": dict(arms),
        "conditions": dict(conditions),
        "providerCalls": len(provider_calls),
        "nonProviderCalls": len(calls) - len(provider_calls),
        "inputTokens": tok_in,
        "outputTokens": tok_out,
        "callModels": dict(models_calls),
        "pricedUsd": priced_records / 1e9,
        "settledMinusPriced": (settled_nanos - priced_records) / 1e9,
    },
    "pacing": pacing,
    "summaryTotals": (summary or {}).get("requests") if summary else None,
    "operator": operator,
    "monitor": {"lines": len(events), "stopsAndHolds": stops, "releaseLines": released_lines, "buildReadings": dict(builds), "last": events[-1] if events else None},
}
with open(OUT, "w") as f:
    json.dump(out, f, indent=1)

L = out["ledger"]
R = out["records"]
print(f"ledger: {L['reservations']} reservations, {L['finals']} finals, open {L['open'] or 'none'}, duplicates {L['duplicates'] or 'none'}, orphan finals {L['orphanFinals'] or 'none'}, arithmetic mismatches {L['arithmeticMismatches'] or 'none'}, releases above $0 {L['releasedAboveZero'] or 'none'}")
for k, v in L["byReason"].items():
    print(f"  {k}: {v['requests']} requests, ${v['usd']:.9f}")
print(f"  committed ${L['committedUsd']:.9f}; settled at usage ${L['settledUsd']:.9f} (${L['settledUsdAtList']:.6f} at list); served models {L['servedModels']}")
print(f"records: {R['cells']} cells, statuses {R['statuses']}, passed {R['passed']}; arms {R['arms']}; conditions {R['conditions']}")
print(f"  provider calls {R['providerCalls']} (non-provider {R['nonProviderCalls']}), tokens in {R['inputTokens']:,} out {R['outputTokens']:,}, call models {R['callModels']}")
print(f"  the records' calls priced ${R['pricedUsd']:.9f}; settled minus priced ${R['settledMinusPriced']:.9f} (the requests of a cell left unrecorded at the stop, if any)")
for p in pacing:
    t = (p.get("telemetry") or {}).get("pacing") or {}
    print(f"pacing: invocation {p.get('id', '')[:40]}… stopped {p.get('stopped')} | sent {t.get('sent')} | max {t.get('maxRequests')} | spacing {t.get('spacingMs')} ms")
print(f"operator: {operator}")
print(f"monitor: {len(events)} lines, STOP/HOLD {stops or 'none'}, builds {dict(builds)}, last: {(events[-1] if events else '')[:300]}")
