#!/usr/bin/env python3
"""Operator monitor for one window (one invocation) of a Phase 1B hosted run. Read-only on the run directory; it only
ever signals the harness's process group.

The harness stops itself, cleanly, at a cap (exit 0), at a call it cannot trust (exit 3) and on an error (exit 1). The
monitor stops it (SIGTERM to its process group) on the owner's other conditions, from what the harness writes as it
goes (requests.jsonl, runs.jsonl, the manifest and this window's preflight) and from the live deployment:

Immediate stops:
- settlement: a request settled any way but at its reported usage or as a refusal released at no cost (a hold such as
  "usage not verified"); a settlement whose arithmetic does not hold in whole nanodollars; a release not at zero; a
  settlement for a request not in flight; two requests in flight; a line it cannot read;
- model: a settlement, or a provider call in a cell, on a model other than the one the window expects, or a manifest
  that records another, or one set aside;
- build: the live deployment, this window's preflight or the manifest naming another build than the baseline's;
- corpus: a manifest pinning another corpus, a record for another reference or provider, or with labels other than
  the frozen corpus's;
- integrity: another code identity, the manifest's identity changing while the window runs, an invariant failure, or
  a request in flight far longer than any reply can take.

Refusals (the gateway's zero-cost busy and limiter refusals, which the harness releases and retries after a backoff):
- a refusal released and then answered within the backoff schedule is allowed, and logged with the wait it costs;
- a request refused through its whole schedule (len(backoff) + 1 times in a row) stops the window;
- so do repeated refusals: the window's maxReleased-th release, or the backoff its refusals imply reaching
  maxBackoffSeconds, so that refusals never silently eat the rest of a daily window.
A release is the safest moment to stop: the harness is then waiting out its backoff, or its spacing after a schedule
spent, with no request in flight, so the stop holds nothing.

Failures: a policy or unknown failure stops the window at once; a provider failure is allowed maxProviderFailures
times per window (each is re-run later with --rerun-failed), and the next stops it. Ordinary arm results (a lint
exhaustion, a gate failure, an unusable output) never stop a run.

A stop that lands while a request is in flight leaves it open: the next resume raises it to the most a request can
cost ($1.118208), and repeats its cell from its beginning. The monitor allows exactly that raise at the start of the
next window, before its first request, and logs it.

Exit codes: 0 the harness exited by itself; 10 the monitor stopped it; 20 handing back while the harness still runs;
2 a usage error. Usage:
  monitor_run.py --run <run dir> --pgid <harness process group> --preflights <N, this window's preflight count>
      --config <monitor config json> --corpus <frozen corpus json> --events <events log> [--hand-back-after <s>]
      [--poll <s>] [--build-url <url, or file:// for tests>]
"""
import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime

SETTLED, RELEASED, UNVERIFIED = "settled at the reported usage", "refused before any provider call", "usage not verified"
NEVER_READ = "a request whose reply was never read"
NANO_IN, NANO_OUT = 1050, 5250
REQUEST_BOUND_NANO = 2 * (204_800 * NANO_IN + 65_536 * NANO_OUT)
IDENTITY = ["runId", "startedAt", "provider", "corpus", "references", "code", "model", "deployment", "selection", "decision"]
nano = lambda usd: round(usd * 1e9)
whole = lambda v: isinstance(v, int) and not isinstance(v, bool)


class Stop(Exception):
    """A condition the window stops on: its rule and what was seen."""

    def __init__(self, rule, message):
        super().__init__(f"{rule}: {message}")
        self.rule = rule
        self.message = message


def epoch(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


class Monitor:
    """The monitor's judgement, fed one event at a time; the loop in main() feeds it from the run directory."""

    def __init__(self, config, corpus=None, log=print):
        self.c = config
        self.expect = config["expect"]
        self.schedule = config["backoffMs"]
        self.corpus = {p["id"]: p for p in corpus["prompts"]} if corpus else None
        self.log = log
        self.inv = None  # this window's invocation time: its preflight's, which opens its id
        self.identity = None
        self.reserved = {}
        self.open = None  # (request, since in epoch seconds)
        self.sent = 0
        self.settled = 0
        self.released = 0
        self.in_a_row = 0
        self.backoff_s = 0.0
        self.provider_failures = 0
        self.cells = 0
        self.outcomes = Counter()
        self.raised = []

    # --- the window's identity ---------------------------------------------------------------------------------
    def begin(self, manifest, preflight):
        e = self.expect
        self.inv = preflight["at"]
        if manifest["corpus"] != e["corpus"]:
            raise Stop("corpus", f"the run pins {manifest['corpus']}, the window expects {e['corpus']}")
        if [r["id"] for r in manifest["references"]] != [e["reference"]]:
            raise Stop("corpus", f"the run measures {[r['id'] for r in manifest['references']]}, the window expects {e['reference']}")
        if manifest["provider"] != e["provider"]:
            raise Stop("integrity", f"the run's provider is {manifest['provider']}, the window expects {e['provider']}")
        if manifest["code"]["sha256"] != e["code"]:
            raise Stop("integrity", f"the run's code identity is {manifest['code']['sha256']}, the window expects {e['code']}")
        if manifest["deployment"]["buildId"] != e["build"] or manifest["deployment"]["worker"] != "per-call-model":
            raise Stop("build", f"the run was started against build {manifest['deployment']['buildId']} ({manifest['deployment']['worker']}), the window expects {e['build']}")
        if preflight.get("buildId") != e["build"] or (preflight.get("worker") or {}).get("shape") != "per-call-model" or preflight.get("models") != e["models"]:
            raise Stop("build", f"this window's preflight found build {preflight.get('buildId')}, Worker {(preflight.get('worker') or {}).get('shape')}, models {preflight.get('models')}")
        self.check_manifest(manifest)
        self.identity = {k: manifest.get(k) for k in IDENTITY}
        self.log(f"window opened {self.inv}: build {e['build']}, code {e['code'][:12]}, corpus {e['corpus']['id']} v{e['corpus']['version']}, {e['reference']}")

    def check_manifest(self, manifest):
        served = (manifest.get("servedModel") or {}).get("id")
        if served is not None and served != self.expect["model"]:
            raise Stop("model", f"the manifest records {served!r} as the model measured")
        if manifest.get("setAside"):
            raise Stop("model", f"a resume set aside a served model: {manifest['setAside']}")
        if self.identity is not None and {k: manifest.get(k) for k in IDENTITY} != self.identity:
            raise Stop("integrity", "the manifest's identity changed while the window ran")

    def live_build(self, build):
        if build is None:
            self.log("the live build could not be read this time (logged, not a stop)")
        elif build != self.expect["build"]:
            raise Stop("build", f"the live deployment is build {build}, the window expects {self.expect['build']}")

    # --- the ledger -----------------------------------------------------------------------------------------------
    def mine(self, line):
        return str(line.get("invocation", "")).startswith(f"{self.inv}~")

    def ledger(self, line):
        if not self.mine(line):
            return  # an earlier window's line
        req = line.get("request")
        if not isinstance(req, str):
            raise Stop("settlement", f"a ledger line with no request: {json.dumps(line)[:200]}")
        if "adjust" not in line:
            if set(line) != {"at", "invocation", "request", "usd"} or not isinstance(line["usd"], (int, float)):
                raise Stop("settlement", f"an unrecognized ledger line: {json.dumps(line)[:200]}")
            if self.open is not None:
                raise Stop("settlement", f"{req} reserved while {self.open[0]} was still in flight")
            self.reserved[req] = nano(line["usd"])
            self.open = (req, epoch(line["at"]))
            self.sent += 1
            return
        reason = line.get("reason")
        if reason == NEVER_READ and not req.startswith(f"{self.inv}~") and self.sent == 0:
            # The request an earlier window left in flight, raised by this one before it sends anything.
            if nano(line["final"]) < REQUEST_BOUND_NANO:
                raise Stop("settlement", f"{req} left in flight was raised to {line['final']}, below the most a request can cost")
            self.raised.append(req)
            self.log(f"the request an earlier window left in flight, {req}, raised to ${line['final']:.6f} (expected after a stop with a request in flight)")
            return
        if self.open is None or self.open[0] != req:
            raise Stop("settlement", f"a settlement for {req}, which is not the request in flight")
        if self.reserved[req] + nano(line["adjust"]) != nano(line["final"]):
            raise Stop("settlement", f"{req}: reserve + adjust {line['adjust']} != final {line['final']}")
        self.open = None
        if reason == RELEASED:
            if nano(line["final"]) != 0:
                raise Stop("settlement", f"{req} released at {line['final']}, not zero")
            self.on_release(req)
            return
        self.in_a_row = 0
        if reason != SETTLED:
            raise Stop("settlement", f"{req} ended {reason!r} (final {line.get('final')}), not settled at its reported usage")
        if line.get("servedModel") != self.expect["model"]:
            raise Stop("model", f"{req} settled on {line.get('servedModel')!r}")
        self.settled += 1

    def on_release(self, req):
        self.released += 1
        self.in_a_row += 1
        steps = len(self.schedule)
        if self.in_a_row > steps:
            raise Stop("refusals", f"{req} was refused {self.in_a_row} times in a row: its whole backoff schedule ({', '.join(f'{ms // 1000} s' for ms in self.schedule)}) is spent")
        wait = self.schedule[self.in_a_row - 1] / 1000
        self.backoff_s += wait
        if self.released >= self.c["maxReleased"]:
            raise Stop("refusals", f"{self.released} refusals released in this window (at most {self.c['maxReleased'] - 1} allowed); the last, {req}")
        if self.backoff_s >= self.c["maxBackoffSeconds"]:
            raise Stop("refusals", f"this window's refusals have cost {self.backoff_s:.0f} s of backoff (at most {self.c['maxBackoffSeconds']} s); the last, {req}")
        self.log(f"a refusal released at no cost: {req}, {self.in_a_row} in a row; the harness waits {wait:.0f} s before retrying ({self.released} released, {self.backoff_s:.0f} s of backoff in this window)")

    # --- the cells ------------------------------------------------------------------------------------------------
    def record(self, rec):
        self.cells += 1
        self.in_a_row = 0
        key = f"{rec.get('reference')}|{rec.get('arm')}|{rec.get('prompt')}|{rec.get('condition')}"
        outcome = rec.get("outcome") or rec.get("status")
        self.outcomes[outcome] += 1
        e = self.expect
        if rec.get("reference") != e["reference"] or rec.get("provider") != e["provider"].split("@")[0]:
            raise Stop("corpus", f"{key}: a record for {rec.get('reference')} on {rec.get('provider')}")
        if self.corpus is not None:
            p = self.corpus.get(rec.get("prompt"))
            if p is None or rec.get("expected") != {"intent": p["intent"].get(e["reference"]), "block": p["block"]}:
                raise Stop("corpus", f"{key}: its expected labels {rec.get('expected')} are not the frozen corpus's")
        for c in rec.get("calls") or []:
            if c.get("source") != "provider":
                continue
            turned_away = c.get("outcome") == "provider-error" and c.get("model") is None and not whole(c.get("inputTokens")) and not whole(c.get("outputTokens"))
            if c.get("model") != e["model"] and not turned_away:
                raise Stop("model", f"{key}: a provider call on {c.get('model')!r}")
        if outcome == "invariant-failure" or rec.get("path") == "invariant":
            raise Stop("integrity", f"{key}: an invariant failure")
        failure = rec.get("failure")
        if failure:
            kind = failure.get("kind")
            message = str(failure.get("message"))[:200]
            if kind == "provider":
                self.provider_failures += 1
                if self.provider_failures > self.c["maxProviderFailures"]:
                    raise Stop("failures", f"{key}: provider failure {self.provider_failures} in this window: {message}")
                self.log(f"a provider failure in {key} ({self.provider_failures} of {self.c['maxProviderFailures']} allowed; re-run it with --rerun-failed): {message}")
            elif kind == "policy" or kind == "unknown" or failure.get("rerunEligible"):
                raise Stop("failures", f"{key}: a {kind} failure: {message}")
        if self.cells % self.c["progressEvery"] == 0:
            self.log(self.progress())

    def tick(self, now):
        if self.open is not None and now - self.open[1] > self.c["openRequestSeconds"]:
            raise Stop("integrity", f"{self.open[0]} in flight {now - self.open[1]:.0f} s with no settlement")

    def progress(self):
        return f"{self.cells} cells, {self.sent} requests sent, {self.settled} settled, {self.released} released ({self.backoff_s:.0f} s of backoff), {self.provider_failures} provider failures, outcomes {dict(self.outcomes)}"


# --- The loop: the run directory and the live deployment ---------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Monitor one window of a Phase 1B hosted run.")
    ap.add_argument("--run", required=True)
    ap.add_argument("--pgid", required=True, type=int)
    ap.add_argument("--preflights", required=True, type=int, help="how many preflights the run holds once this window has started (1 for the first)")
    ap.add_argument("--config", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--events", required=True)
    ap.add_argument("--hand-back-after", type=float, default=7 * 3600)
    ap.add_argument("--poll", type=float, default=2.0)
    ap.add_argument("--build-url", default="https://composer.aesthetic-function.com/")
    a = ap.parse_args(argv)
    with open(a.config) as f:
        config = json.load(f)
    with open(a.corpus) as f:
        corpus = json.load(f)

    def log(message):
        line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {message}"
        with open(a.events, "a") as f:
            f.write(line + "\n")
        print(line, flush=True)

    def alive():
        try:
            os.killpg(a.pgid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def stop(s):
        log(f"STOP ({s.rule}): {s.message}")
        try:
            os.killpg(a.pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(60):
            if not alive():
                break
            time.sleep(0.5)
        if alive():
            os.killpg(a.pgid, signal.SIGKILL)
            log("the harness did not exit on SIGTERM; sent SIGKILL")
        log(f"harness stopped by the monitor: {m.progress()}")
        return 10

    def live_build():
        try:
            if a.build_url.startswith("file://"):
                with open(a.build_url[len("file://"):]) as f:
                    html = f.read()
            else:
                html = subprocess.run(["curl", "-sS", "--max-time", "20", a.build_url], capture_output=True, text=True, timeout=40).stdout
        except Exception:
            return None
        found = re.search(r'\\?"b\\?":\\?"([A-Za-z0-9_-]+)\\?"', html) or re.search(r"_next/static/([A-Za-z0-9_-]+)/_buildManifest\.js", html)
        return found.group(1) if found else None

    m = Monitor(config, corpus, log)
    run = a.run
    deadline = time.time() + a.hand_back_after
    newest = "preflight.json" if a.preflights == 1 else f"preflight.resume-{a.preflights - 1}.json"
    log(f"monitor up: run {run}, harness process group {a.pgid}, waiting for {newest}")
    while not (os.path.exists(os.path.join(run, newest)) and os.path.exists(os.path.join(run, "manifest.json"))):
        if not alive():
            log("the harness exited before this window's preflight was written")
            return 0
        time.sleep(a.poll)
    offsets = {"requests.jsonl": 0, "runs.jsonl": 0}
    seen = set()

    def read_new(name, since=None):
        """The whole lines appended to a log since the last read: a cut-off last line waits for its end."""
        path = os.path.join(run, name)
        if not os.path.exists(path):
            return []
        if os.path.getsize(path) < offsets[name]:
            offsets[name] = 0  # rewritten (a re-run moved records aside): read again, skipping what was seen
        with open(path, "rb") as f:
            f.seek(offsets[name])
            data = f.read()
        cut = data.rfind(b"\n") + 1
        offsets[name] += cut
        out = []
        for raw in data[:cut].decode("utf-8").splitlines():
            if not raw.strip():
                continue
            try:
                item = json.loads(raw)
            except ValueError:
                raise Stop("settlement" if name == "requests.jsonl" else "integrity", f"{name}: a line that is not JSON")
            if since is not None:
                if item.get("at", "") < since or raw in seen:
                    continue
                seen.add(raw)
            out.append(item)
        return out

    def drain():
        """Both logs' new lines in the order they were written: by time, a ledger line before a record on a tie."""
        items = [(x.get("at", ""), 0, i, x) for i, x in enumerate(read_new("requests.jsonl"))]
        items += [(x.get("at", ""), 1, i, x) for i, x in enumerate(read_new("runs.jsonl", since=m.inv))]
        for _, source, _, x in sorted(items, key=lambda t: t[:3]):
            (m.ledger if source == 0 else m.record)(x)

    last_build = 0.0
    try:
        with open(os.path.join(run, "manifest.json")) as f:
            manifest = json.load(f)
        with open(os.path.join(run, newest)) as f:
            m.begin(manifest, json.load(f))
        while True:
            drain()
            with open(os.path.join(run, "manifest.json")) as f:
                m.check_manifest(json.load(f))
            if not alive():
                drain()
                log(f"the harness exited: {m.progress()}")
                return 0
            m.tick(time.time())
            if time.time() - last_build > config["buildCheckSeconds"]:
                last_build = time.time()
                m.live_build(live_build())
            if time.time() > deadline:
                log(f"handing back while the harness runs: {m.progress()}")
                return 20
            time.sleep(a.poll)
    except Stop as s:
        return stop(s)


if __name__ == "__main__":
    sys.exit(main())
