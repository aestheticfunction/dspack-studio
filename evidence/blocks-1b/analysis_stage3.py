#!/usr/bin/env python3
"""Decision-packet tables and validity/sensitivity readings for the Astryx Stage-3 run, from runs.jsonl alone.

Standalone, like verify_stage3.py: no harness code. The binding scoring reads each record's add and remove check, which
verify_stage3.py re-derived from the saved surfaces with no disagreement. Every reading other than the frozen one is a
sensitivity check, labelled post hoc where the frozen rule does not define it; none replaces the verdict.

Usage: python3 -I analysis_stage3.py <run dir> <corpus json> <out json> <out md>
"""
import json
import os
import random
import sys
from collections import Counter, defaultdict

RUN, CORPUS_PATH, OUT_JSON, OUT_MD = sys.argv[1:5]
records = [json.loads(l) for l in open(os.path.join(RUN, "runs.jsonl"), encoding="utf-8") if l.strip()]
corpus = json.load(open(CORPUS_PATH))
P = {p["id"]: p for p in corpus["prompts"]}
manifest = json.load(open(os.path.join(RUN, "manifest.json")))
PROMPTS = manifest["selection"]["promptIds"]
ARMS = ["block", "block-positional", "capped", "production"]
DEC = ["block", "capped", "production"]
CONDS = ["fresh", "refine-content", "refine-add", "refine-remove", "refine-structural"]
ADD_REMOVE = {"refine-add", "refine-remove"}
FAMILY = lambda p: P[p]["block"] or "null"
OPT = manifest["decision"]
EPS = 1e-9
LABEL = "astryx|hosted-ai:claude-haiku-4.5"


def missed(op):
    return op["observed"] == "none" or (op["observed"] != "mixed" and op["observed"] != op["requested"])


def performed(op):
    return op["observed"] == op["requested"]


def score(recs, failing):
    out = []
    for r in recs:
        if r.get("passed") and r["condition"] in ADD_REMOVE and failing(r, r.get("operation")):
            r = dict(r, passed=False)
        out.append(r)
    return out


READINGS = {
    "ordinary (the pipeline's pass alone)": lambda r, op: False,
    "binding (frozen v2 rule)": lambda r, op: op is None or missed(op),
    "unchanged misses excused": lambda r, op: op is None or (missed(op) and r.get("changed") is not False),
}
binding = score(records, READINGS["binding (frozen v2 rule)"])
ordinary = score(records, READINGS["ordinary (the pipeline's pass alone)"])
evaluated = lambda recs: [r for r in recs if r["status"] == "completed" and not (r.get("failure") or {}).get("rerunEligible")]
tok = lambda r: r["tokens"]["input"] + r["tokens"]["output"]
usd = lambda r: sum(c["inputTokens"] * 1e-6 + c["outputTokens"] * 5e-6 for c in r["calls"] if c.get("source") == "provider")
plan_tok = lambda r: sum(c["inputTokens"] + c["outputTokens"] for c in r["calls"] if c.get("source") == "provider" and c["operation"] == "plan")


def ratio(a, b):
    return None if b == 0 else a / b


def median(v):
    v = sorted(v)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def stats(recs, measure=tok):
    ev = evaluated(recs)
    passed = [r for r in ev if r["passed"]]
    met = [r for r in ev if r["tokens"]["unreportedCalls"] == 0]
    succ = [r for r in met if r["passed"]]
    return {
        "n": len(recs),
        "evaluated": len(ev),
        "passed": len(passed),
        "passRate": ratio(len(passed), len(ev)),
        "measure": sum(measure(r) for r in met),
        "successes": len(succ),
        "perSuccess": None if not succ else sum(measure(r) for r in met) / len(succ),
        "firstAttempt": sum(1 for r in passed if r["attempts"] == 1),
        "repairs": sum(max(0, r["attempts"] - 1) for r in passed),
    }


# --- the decision over any subset of cells, with the spec's paired cluster bootstrap ------------------------------
M32 = 0xFFFFFFFF


def seeded(label):
    h = 2166136261
    for ch in label:
        h = ((h ^ ord(ch)) * 16777619) & M32
    s = [h]

    def rnd():
        s[0] = (s[0] + 0x6D2B79F5) & M32
        t = s[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & M32
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return lambda n: int(rnd() * n)


def interval(values):
    s = sorted(values)
    if not s:
        return None

    def at(q):
        i = q * (len(s) - 1)
        lo, hi = int(i // 1), -int(-i // 1)
        return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (i - lo)

    return (at(0.025), at(0.975))


def sums_by(recs, arm, unit, measure=tok):
    out = {}
    for r in evaluated(recs):
        if r["arm"] != arm:
            continue
        t = out.setdefault(unit(r), [0, 0, 0, 0])  # evaluated, passed, measure over metered, metered successes
        t[0] += 1
        t[1] += 1 if r["passed"] else 0
        if r["tokens"]["unreportedCalls"] == 0:
            t[2] += measure(r)
            t[3] += 1 if r["passed"] else 0
    return out


def decide(recs, unit=lambda r: r["prompt"], measure=tok, draw=None, resamples=2000, arms=("block", "capped", "production")):
    a, c, p = arms
    recs = [r for r in recs if r["arm"] in arms]
    st = {x: stats([r for r in recs if r["arm"] == x], measure) for x in arms}
    sums = {x: sums_by(recs, x, unit, measure) for x in arms}
    units = sorted(u for u in sums[a] if all(u in sums[x] for x in arms))
    threads = {x: len({r["prompt"] for r in evaluated(recs) if r["arm"] == x}) for x in arms}
    red = None if not st[a]["perSuccess"] or not st[p]["perSuccess"] else 1 - st[a]["perSuccess"] / st[p]["perSuccess"]
    red_c = None if not st[a]["perSuccess"] or not st[c]["perSuccess"] else 1 - st[a]["perSuccess"] / st[c]["perSuccess"]
    d_p = st[a]["passRate"] - st[p]["passRate"]
    d_c = st[a]["passRate"] - st[c]["passRate"]
    below = min(threads.values()) < OPT["minimum"]
    verdict = "insufficient" if below or red is None else ("pass" if red >= OPT["reduction"] - EPS and d_p >= -OPT["margin"] - EPS and d_c >= -OPT["margin"] - EPS else "fail")
    draw = draw or seeded(LABEL)
    vals = {"red": [], "redC": [], "dP": [], "dC": []}
    for _ in range(resamples):
        sample = [units[draw(len(units))] for _ in range(len(units))]
        agg = {}
        for x in arms:
            e = pa = m = s = 0
            for u in sample:
                t = sums[x][u]
                e += t[0]
                pa += t[1]
                m += t[2]
                s += t[3]
            agg[x] = (pa / e if e else None, m / s if s else None)
        if agg[a][1] is not None and agg[p][1]:
            vals["red"].append(1 - agg[a][1] / agg[p][1])
        if agg[a][1] is not None and agg[c][1]:
            vals["redC"].append(1 - agg[a][1] / agg[c][1])
        vals["dP"].append(agg[a][0] - agg[p][0])
        vals["dC"].append(agg[a][0] - agg[c][0])
    iv = {k: interval(v) for k, v in vals.items()}
    enough = len(units) >= OPT["minimum"]

    def clarity(ivl, thr):
        if ivl is None:
            return "n/a"
        if not enough:
            return "insufficient"
        return "clear-pass" if ivl[0] >= thr - EPS else "clear-fail" if ivl[1] < thr - EPS else "uncertain"

    cl = {"tokens": clarity(iv["red"], OPT["reduction"]), "vsProduction": clarity(iv["dP"], -OPT["margin"]), "vsCapped": clarity(iv["dC"], -OPT["margin"])}
    agrees = (verdict == "pass" and all(v == "clear-pass" for v in cl.values())) or (verdict == "fail" and "clear-fail" in cl.values())
    overall = "insufficient" if not enough or below else "clear" if agrees else "uncertain"
    return {
        "verdict": verdict,
        "overall": overall,
        "clarity": cl,
        "units": len(units),
        "threads": threads,
        "passed": {x: st[x]["passed"] for x in arms},
        "evaluated": {x: st[x]["evaluated"] for x in arms},
        "passRate": {x: st[x]["passRate"] for x in arms},
        "perSuccess": {x: st[x]["perSuccess"] for x in arms},
        "reductionVsProduction": red,
        "reductionVsCapped": red_c,
        "passDiffVsProduction": d_p,
        "passDiffVsCapped": d_c,
        "intervals": iv,
    }


R = {}
# 1. The frozen decision and the readings beside it.
R["readings"] = {name: decide(score(records, f)) for name, f in READINGS.items()}

# 2. Post-hoc subsets: none of these is part of the frozen rule.
destructive = {"nb-01", "nb-02", "nb-03"}
subsets = {
    "all cells (frozen)": lambda r: True,
    "without the 18 add/remove cells on nb-01..nb-03 (no list to act on)": lambda r: not (r["prompt"] in destructive and r["condition"] in ADD_REMOVE),
    "without nb-01..nb-03 entirely": lambda r: r["prompt"] not in destructive,
    "without the structural condition": lambda r: r["condition"] != "refine-structural",
    "fresh builds only": lambda r: r["condition"] == "fresh",
    "refinements only": lambda r: r["condition"] != "fresh",
    "block prompts only (18; blocks apply)": lambda r: FAMILY(r["prompt"]) != "null",
    "null prompts only (6; every arm primitive)": lambda r: FAMILY(r["prompt"]) == "null",
}
R["subsets"] = {}
for name, keep in subsets.items():
    R["subsets"][name] = {
        "binding": decide([r for r in binding if keep(r)]),
        "ordinary": decide([r for r in ordinary if keep(r)]),
    }

# 3. Other measures of cost (post hoc): list dollars, input only, output only, without the planning call.
R["measures"] = {
    "tokens (frozen)": decide(binding),
    "list dollars": decide(binding, measure=usd),
    "input tokens only": decide(binding, measure=lambda r: r["tokens"]["input"]),
    "output tokens only": decide(binding, measure=lambda r: r["tokens"]["output"]),
    "tokens without the planning call": decide(binding, measure=lambda r: tok(r) - plan_tok(r)),
}

# 4. Leave one prompt out, and one family out.
loo = {}
for p in PROMPTS:
    d = decide([r for r in binding if r["prompt"] != p])
    loo[p] = {k: d[k] for k in ("verdict", "overall", "reductionVsProduction", "passDiffVsProduction", "passDiffVsCapped")} | {"clarity": d["clarity"], "intervals": d["intervals"]}
R["leaveOnePromptOut"] = loo
R["leaveOneFamilyOut"] = {}
for fam in ["records-table", "auth-form", "guide-steps", "null"]:
    d = decide([r for r in binding if FAMILY(r["prompt"]) != fam])
    R["leaveOneFamilyOut"][fam] = {k: d[k] for k in ("verdict", "overall", "units", "reductionVsProduction", "passDiffVsProduction", "passDiffVsCapped")} | {"clarity": d["clarity"], "intervals": d["intervals"]}

# 5. Near-duplicate prompts, and the bootstrap with near-duplicate clusters as the unit.
STOP = set("a an the of with and for to in on by their his her its all one before after into as at from or is are be that this".split())
words = {p: {w.strip(",.").lower() for w in P[p]["goal"].split()} - STOP for p in PROMPTS}
pairs = []
for i, a in enumerate(PROMPTS):
    for b in PROMPTS[i + 1:]:
        j = len(words[a] & words[b]) / len(words[a] | words[b])
        if j >= 0.3:
            pairs.append((a, b, round(j, 2)))
R["nearDuplicates"] = pairs
parent = {p: p for p in PROMPTS}


def find(x):
    while parent[x] != x:
        x = parent[x]
    return x


for a, b, _ in pairs:
    parent[find(a)] = find(b)
clusters = defaultdict(list)
for p in PROMPTS:
    clusters[find(p)].append(p)
cluster_of = {p: find(p) for p in PROMPTS}
R["clusters"] = sorted(clusters.values(), key=len, reverse=True)
d = decide(binding, unit=lambda r: cluster_of[r["prompt"]])
R["clusterBootstrap"] = {"units": d["units"], "clarity": d["clarity"], "overall": d["overall"], "intervals": d["intervals"]}
d = decide(binding, unit=lambda r: FAMILY(r["prompt"]))
R["familyBootstrap"] = {"units": d["units"], "clarity": d["clarity"], "overall": d["overall"], "intervals": d["intervals"], "note": "4 clusters: not interpretable (the addendum)"}
# Near-duplicates by reading, not by shared words: sign-in forms, sign-up forms, and the three destructive confirmations.
JUDGED = [["af-01", "af-05", "af-06"], ["af-02", "af-04"], ["nb-01", "nb-02", "nb-03"]]
judged_of = {p: p for p in PROMPTS}
for group in JUDGED:
    for p in group:
        judged_of[p] = group[0]
d = decide(binding, unit=lambda r: judged_of[r["prompt"]])
R["judgedClusterBootstrap"] = {"clusters": JUDGED, "units": d["units"], "clarity": d["clarity"], "overall": d["overall"], "intervals": d["intervals"], "note": "below the minimum's 20 units, so the rule would call it insufficient; read for the width of the intervals only"}

# 6. Per-prompt tokens per success and reductions; how concentrated the token sums are.
pp = {}
for p in PROMPTS:
    row = {}
    for a in ARMS:
        s = stats([r for r in binding if r["arm"] == a and r["prompt"] == p])
        row[a] = {"passed": s["passed"], "evaluated": s["evaluated"], "tps": s["perSuccess"], "tokens": s["measure"]}
    row["reductionVsProduction"] = None if not row["block"]["tps"] or not row["production"]["tps"] else 1 - row["block"]["tps"] / row["production"]["tps"]
    pp[p] = row
R["perPrompt"] = pp
share = {}
for a in DEC:
    total = sum(pp[p][a]["tokens"] for p in PROMPTS)
    top = sorted(PROMPTS, key=lambda p: -pp[p][a]["tokens"])[:3]
    share[a] = {"top3": top, "top3Share": sum(pp[p][a]["tokens"] for p in top) / total}
R["tokenConcentration"] = share

# 7. Per arm x condition and per arm x family, binding and ordinary side by side.
def table(group):
    out = {}
    for a in ARMS:
        for g in group["values"]:
            b = stats([r for r in binding if r["arm"] == a and group["key"](r) == g])
            o = stats([r for r in ordinary if r["arm"] == a and group["key"](r) == g])
            out[f"{a}|{g}"] = {"binding": b, "ordinary": o}
    return out


R["byCondition"] = table({"values": CONDS, "key": lambda r: r["condition"]})
R["byFamily"] = table({"values": ["records-table", "auth-form", "guide-steps", "null"], "key": lambda r: FAMILY(r["prompt"])})
R["byFamilyCondition"] = {}
for a in ARMS:
    for fam in ["records-table", "auth-form", "guide-steps", "null"]:
        for c in CONDS:
            s = stats([r for r in binding if r["arm"] == a and FAMILY(r["prompt"]) == fam and r["condition"] == c])
            R["byFamilyCondition"][f"{a}|{fam}|{c}"] = [s["passed"], s["evaluated"], s["perSuccess"]]

# 8. Paths, fallback, retention and repairs.
paths = Counter()
fallback = Counter()
retention = Counter()
for r in records:
    if r["status"] != "completed":
        continue
    paths[(r["arm"], r["condition"], r.get("path") or "primitive")] += 1
    fb = (r.get("trace") or {}).get("fallback")
    if fb:
        fallback[(r["arm"], r["condition"], fb.get("classification"), fb.get("reason"), r.get("budgetRemainingAtFallback"), r["passed"])] += 1
    if r.get("refinement"):
        retention[(r["arm"], r["condition"], FAMILY(r["prompt"]), r["refinement"]["mode"], r["refinement"]["retained"])] += 1
R["paths"] = [list(k) + [v] for k, v in sorted(paths.items())]
R["fallback"] = [list(k) + [v] for k, v in sorted(fallback.items(), key=str)]
R["retention"] = [list(k) + [v] for k, v in sorted(retention.items(), key=str)]

# 9. Latency (execution time, the harness's pacing taken out), medians in ms.
lat = {}
for a in ARMS:
    for scope, keep in [("all", lambda r: True), ("fresh", lambda r: r["condition"] == "fresh"), ("refinements", lambda r: r["condition"] != "fresh")]:
        rs = [r for r in records if r["arm"] == a and r["status"] == "completed" and keep(r) and r["timings"].get("execution")]
        ex = lambda k: median([r["timings"]["execution"][k] for r in rs if isinstance(r["timings"]["execution"].get(k), (int, float))])
        lat[f"{a}|{scope}"] = {k: ex(k) for k in ("totalMs", "firstGatedAttemptMs", "blockPhaseMs", "emitMs", "planMs")} | {"n": len(rs)}
R["latency"] = lat

# 10. Parity (the committed structural checklist), over the passing cells scored, binding.
par = {}
for a in ARMS:
    for c in CONDS + ["all"]:
        rs = [r for r in evaluated(binding) if r["arm"] == a and r["passed"] and (c == "all" or r["condition"] == c) and r.get("parity") and (len(r["parity"]["satisfied"]) + len(r["parity"]["missing"])) > 0]
        par[f"{a}|{c}"] = {"scored": len(rs), "mean": ratio(sum(r["parity"]["score"] for r in rs), len(rs)), "full": sum(1 for r in rs if r["parity"]["score"] == 1)}
R["parity"] = par
missing = Counter()
for r in evaluated(binding):
    if r["passed"] and r.get("parity"):
        for m in r["parity"]["missing"]:
            missing[(r["arm"], r["prompt"], m)] += 1
R["parityMissing"] = [list(k) + [v] for k, v in sorted(missing.items())]

# 11. Operation outcomes per arm, with where every miss is.
ops = {}
for a in ARMS:
    rs = [r for r in evaluated(records) if r["arm"] == a and r["condition"] in ADD_REMOVE and (r.get("passed") or r.get("outcome") == "passed")]
    ops[a] = {
        "checked": sum(1 for r in rs if r.get("operation")),
        "performed": sum(1 for r in rs if r.get("operation") and performed(r["operation"])),
        "mixed": sum(1 for r in rs if r.get("operation") and r["operation"]["observed"] == "mixed"),
        "missed": sum(1 for r in rs if r.get("operation") and missed(r["operation"])),
        "unchanged": sum(1 for r in rs if r.get("operation") and missed(r["operation"]) and r.get("changed") is False),
        "unchecked": sum(1 for r in rs if not r.get("operation")),
        "misses": [f"{r['prompt']} {r['condition'][7:]} ({r['operation']['observed']}{', unchanged' if r.get('changed') is False else ''})" for r in rs if r.get("operation") and missed(r["operation"])],
    }
R["operations"] = ops

# 12. C2's premise on the auth-form removes: what each arm removed, by node id (Astryx nodes carry ids).
def nodes(surface):
    out = {}

    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            if isinstance(v.get("component"), str) and v.get("id"):
                props = v.get("props") or {}
                out[v["id"]] = (v["component"], str(props.get("label") or props.get("text") or v.get("text") or props.get("type") or "")[:40])
            for x in v.values():
                walk(x)

    walk(surface.get("root"))
    return out


fresh = {(r["arm"], r["prompt"]): r for r in records if r["condition"] == "fresh"}
c2 = []
for r in records:
    if r["condition"] == "refine-remove" and FAMILY(r["prompt"]) == "auth-form" and r["status"] == "completed":
        if not r.get("surface"):
            c2.append([r["arm"], r["prompt"], r.get("outcome"), None, None])
            continue
        before, after = nodes(fresh[(r["arm"], r["prompt"])]["surface"]), nodes(r["surface"])
        removed = [before[i] for i in before if i not in after]
        added = [after[i] for i in after if i not in before]
        c2.append([r["arm"], r["prompt"], r.get("outcome"), removed, added])
R["c2Removes"] = c2

# 13. Structural cells: what each arm did, with D1-D3's impossible elements on Astryx.
R["structural"] = {a: {"passed": sum(1 for r in binding if r["arm"] == a and r["condition"] == "refine-structural" and r["passed"]), "failures": [f"{r['prompt']} {r.get('outcome')} via {r.get('path')}" for r in binding if r["arm"] == a and r["condition"] == "refine-structural" and r["status"] == "completed" and not r["passed"]]} for a in ARMS}

# 14. The null prompts as an A/A check: the block arm runs the production configuration on them.
aa = {}
for a in ["block", "production", "capped", "block-positional"]:
    s = stats([r for r in binding if r["arm"] == a and FAMILY(r["prompt"]) == "null"])
    o = stats([r for r in ordinary if r["arm"] == a and FAMILY(r["prompt"]) == "null"])
    aa[a] = {"binding": [s["passed"], s["evaluated"], s["perSuccess"]], "ordinary": [o["passed"], o["evaluated"], o["perSuccess"]]}
null_paths = Counter((r["arm"], r.get("path")) for r in records if FAMILY(r["prompt"]) == "null" and r["status"] == "completed")
R["nullAA"] = {"stats": aa, "paths": [list(k) + [v] for k, v in sorted(null_paths.items(), key=str)]}

# 15. Named against positional, per condition and family (binding).
enc = {}
for g, keep in [("all", lambda r: True)] + [(c, (lambda c: lambda r: r["condition"] == c)(c)) for c in CONDS] + [(f, (lambda f: lambda r: FAMILY(r["prompt"]) == f)(f)) for f in ["records-table", "auth-form", "guide-steps", "null"]]:
    n = stats([r for r in binding if r["arm"] == "block" and keep(r)])
    q = stats([r for r in binding if r["arm"] == "block-positional" and keep(r)])
    enc[g] = {"named": [n["passed"], n["evaluated"], n["perSuccess"]], "positional": [q["passed"], q["evaluated"], q["perSuccess"]]}
R["encoding"] = enc

json.dump(R, open(OUT_JSON, "w"), indent=1, default=str)


# --- Markdown tables for the packet -----------------------------------------------------------------------------------
def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def pts(x):
    return "n/a" if x is None else f"{100 * x:+.1f}"


def ivp(iv):
    return "n/a" if iv is None else f"{100 * iv[0]:.1f}% to {100 * iv[1]:.1f}%"


def ivd(iv):
    return "n/a" if iv is None else f"{100 * iv[0]:+.1f} to {100 * iv[1]:+.1f}"


lines = []
w = lines.append
w("## Readings of the add and remove check (all cells)\n")
w("| Reading | Verdict | Clarity | Pass: block / capped / production | Token cut vs production (95% interval) | Block − production, pts (interval) | Block − capped, pts (interval) |")
w("| --- | --- | --- | --- | --- | --- | --- |")
for name, d in R["readings"].items():
    w(f"| {name} | {d['verdict']} | {d['overall']} | {d['passed']['block']}/{d['evaluated']['block']} · {d['passed']['capped']}/{d['evaluated']['capped']} · {d['passed']['production']}/{d['evaluated']['production']} | {pct(d['reductionVsProduction'])} ({ivp(d['intervals']['red'])}) | {pts(d['passDiffVsProduction'])} ({ivd(d['intervals']['dP'])}) | {pts(d['passDiffVsCapped'])} ({ivd(d['intervals']['dC'])}) |")
w("\n## Post-hoc subsets (binding; ordinary in brackets)\n")
w("| Cells kept | Prompts | Verdict, clarity | Token cut vs production (interval) | Block − production, pts (interval) | Block − capped, pts (interval) | Ordinary: verdict, clarity |")
w("| --- | ---: | --- | --- | --- | --- | --- |")
for name, x in R["subsets"].items():
    d, o = x["binding"], x["ordinary"]
    w(f"| {name} | {d['units']} | {d['verdict']}, {d['overall']} | {pct(d['reductionVsProduction'])} ({ivp(d['intervals']['red'])}) | {pts(d['passDiffVsProduction'])} ({ivd(d['intervals']['dP'])}) | {pts(d['passDiffVsCapped'])} ({ivd(d['intervals']['dC'])}) | {o['verdict']}, {o['overall']} |")
w("\n## Other cost measures (binding)\n")
w("| Measure | Block | Capped | Production | Cut vs production (interval) | Cut vs capped (interval) |")
w("| --- | ---: | ---: | ---: | --- | --- |")
for name, d in R["measures"].items():
    f = (lambda v: f"${v:.5f}") if "dollar" in name else (lambda v: f"{v:,.0f}")
    w(f"| {name} | {f(d['perSuccess']['block'])} | {f(d['perSuccess']['capped'])} | {f(d['perSuccess']['production'])} | {pct(d['reductionVsProduction'])} ({ivp(d['intervals']['red'])}) | {pct(d['reductionVsCapped'])} ({ivp(d['intervals']['redC'])}) |")
w("\n## Leave one prompt out (binding)\n")
flips = {p: x for p, x in R["leaveOnePromptOut"].items() if x["verdict"] != "pass" or x["overall"] != "clear"}
w(f"Verdict pass in {sum(1 for x in R['leaveOnePromptOut'].values() if x['verdict'] == 'pass')} of 24 drops; clear in {sum(1 for x in R['leaveOnePromptOut'].values() if x['overall'] == 'clear')} of 24.")
rng = lambda k: (min(x[k] for x in R["leaveOnePromptOut"].values()), max(x[k] for x in R["leaveOnePromptOut"].values()))
w(f"Range: token cut {pct(rng('reductionVsProduction')[0])} to {pct(rng('reductionVsProduction')[1])}; block − production {pts(rng('passDiffVsProduction')[0])} to {pts(rng('passDiffVsProduction')[1])} pts; block − capped {pts(rng('passDiffVsCapped')[0])} to {pts(rng('passDiffVsCapped')[1])} pts.")
for p, x in flips.items():
    w(f"- without {p}: {x['verdict']}, {x['overall']} ({x['clarity']}); intervals {json.dumps({k: [round(v, 4) for v in iv] for k, iv in x['intervals'].items()})}")
w("\n## Leave one family out (binding)\n")
for fam, x in R["leaveOneFamilyOut"].items():
    w(f"- without {fam} ({x['units']} prompts): {x['verdict']}, {x['overall']}; cut {pct(x['reductionVsProduction'])} ({ivp(x['intervals']['red'])}); block − production {pts(x['passDiffVsProduction'])} ({ivd(x['intervals']['dP'])}); block − capped {pts(x['passDiffVsCapped'])} ({ivd(x['intervals']['dC'])})")
w("\n## Near-duplicates and clustering\n")
w(f"Pairs with Jaccard ≥ 0.3 on content words: {R['nearDuplicates']}")
w(f"Clusters: {R['clusters']}")
cb = R["clusterBootstrap"]
w(f"Bootstrap over {cb['units']} near-duplicate clusters: {cb['overall']} {cb['clarity']}; cut {ivp(cb['intervals']['red'])}; block − production {ivd(cb['intervals']['dP'])}; block − capped {ivd(cb['intervals']['dC'])}")
jb = R["judgedClusterBootstrap"]
w(f"Bootstrap over {jb['units']} clusters judged by reading ({jb['clusters']} merged): {jb['clarity']}; cut {ivp(jb['intervals']['red'])}; block − production {ivd(jb['intervals']['dP'])}; block − capped {ivd(jb['intervals']['dC'])}")
w(f"Token concentration (top 3 prompts' share of each arm's metered tokens): {json.dumps(R['tokenConcentration'])}")
open(OUT_MD, "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
