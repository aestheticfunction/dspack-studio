#!/usr/bin/env python3
"""Operator monitor for one window (one invocation) of a Phase 1B hosted run. Read-only on the run directory; it only
ever signals the harness's process group.

The harness stops itself, cleanly, at a cap (exit 0), at a call it cannot trust (exit 3) and on an error (exit 1). The
monitor stops it (SIGTERM to its process group) on the owner's other conditions, from what the harness writes as it
goes (requests.jsonl, runs.jsonl, the manifest and this window's preflight) and from the live deployment:

Immediate stops:
- settlement: a request settled any way but at its reported usage or as a refusal released at no cost; a settlement
  whose arithmetic does not hold in whole nanodollars; a release not at zero; a settlement for a request not in
  flight; two requests in flight; a request out of sequence; a line it cannot read;
- model: a settlement, or a provider call in a cell, on a model other than the one the window expects, or a manifest
  that records another or sets another aside. The busy gateway's turned-away call names no model; it is allowed only
  as the last provider call of a cell that failed on it (a provider or policy failure);
- build: the live deployment (read every buildCheckSeconds, each reading logged), this window's preflight or the
  manifest naming another build than the baseline's, or a live build unreadable for maxUnreadableBuildSeconds;
- corpus: a manifest pinning another corpus, a record for another reference or provider, or with labels other than
  the frozen corpus's;
- integrity: another code identity, the manifest's identity changing while the window runs, a request in flight far
  longer than any reply can take, more requests than maxRequestsPerWindow (the window's --max-requests), or a ledger
  line, preflight or pacing entry showing that this is not the window running (another process, or a --preflights
  that is not this window's count). Also an invariant failure: an arm result the run keeps (ADR-B4), but a block
  template that produced an invalid surface is the owner's to see before more is spent.

A hold ("usage not verified", the conservative settlement of a reply the run cannot trust) is usually a stop the
harness makes itself: it holds the request, halts (exit 3), and writes its stop record (pacing.jsonl, then
summary.json and REPORT.md) in a short synchronous shutdown that a signal would cut off. A reply that passes its
integrity checks but not its price bound (more tokens than its reservation priced) is held too, and the harness goes on
with it. So the monitor logs a HOLD and waits: for the harness to exit by itself (it has holdGraceSeconds once its
pacing entry shows it ending), or to show it carried on, and then stops it where nothing is in flight. That is on the
cell's record, or before its next request can go out (the held request's reservation plus spacingSeconds), or, when
it carried on into another request, once that request settles.

Refusals (the gateway's zero-cost busy and limiter refusals, which the harness releases and retries after a backoff):
- a refusal released and then answered within the backoff schedule is allowed, and logged with the wait it costs;
- a request refused through its whole schedule (len(backoff) + 1 times in a row) stops the window;
- so do repeated refusals: the window's maxReleased-th release, or the backoff its refusals imply reaching
  maxBackoffSeconds (each release counted as if retried), so that refusals never silently eat the rest of a daily
  window. With the shadcn limits (8 releases, 600 s) either can fire first: a whole schedule (450 s) and then three
  more refusals in a row reach 660 s at the 7th release; eight refusals each answered on its first retry reach the
  8th release at 240 s.
A release is the safest moment to stop: the harness is then waiting out a backoff of 30 s or more with no request in
flight, so a stop within a poll of it holds nothing. After a schedule spent it waits its spacing instead, which must
also be several polls long (12 s against a 2 s poll). The live build is read on a thread of its own, following
redirects as the harness does, so a slow deployment never delays a stop.

Failures: a policy or unknown failure stops the window at once; a provider failure is allowed maxProviderFailures
times per window (each is re-run later with --rerun-failed), and the next stops it. Ordinary arm results (a lint
exhaustion, a gate failure, an unusable output) never stop a run.

A stop that lands while a request is in flight leaves it open: the next resume raises it to the most a request can
cost ($1.118208), and repeats its cell from its beginning. The monitor allows exactly that raise at the start of the
next window, before its first request, and logs it.

The monitor fails closed. It waits at most preflightWaitSeconds for this window's preflight, and stops the harness if
it sends a request before that preflight exists (--preflights is then not this window's count). If the monitor
itself fails, it stops the harness rather than leave it unwatched. It signals --pgid only once the run's lock has
shown the harness inside it: a group that does not hold the lock (another process, the operator's shell) is never
signalled, and the process the lock names is stopped instead.

Not checked here: a settlement's amount against its cell's calls (verify_run.py does that). A restarted monitor logs
again the releases its predecessor logged.

Exit codes: 0 the harness exited by itself (a stop condition seen only after it had exited is still logged, as a
STOP or HOLD line); 10 the monitor stopped it; 20 handing back while the harness still runs; 2 a usage error (a
config missing a limit, or a --pgid that is the monitor's own process group or no running one) or a --pgid no lock of
this window's showed the harness inside, so nothing was signalled; 1 the stop itself failed and nothing could be
signalled. Usage:
  monitor_run.py --run <run dir> --pgid <harness process group> --preflights <N, this window's preflight count>
      --config <monitor config json> --corpus <frozen corpus json> --events <events log> [--hand-back-after <s>]
      [--poll <s>] [--build-url <url, or file:// for tests>]
"""
import argparse
import itertools
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urljoin

SETTLED, RELEASED, UNVERIFIED = "settled at the reported usage", "refused before any provider call", "usage not verified"
NEVER_READ = "a request whose reply was never read"
NANO_IN, NANO_OUT = 1050, 5250
REQUEST_BOUND_NANO = 2 * (204_800 * NANO_IN + 65_536 * NANO_OUT)
IDENTITY = ["runId", "startedAt", "provider", "corpus", "references", "code", "model", "deployment", "selection", "decision"]
LIMITS = ["backoffMs", "maxReleased", "maxBackoffSeconds", "maxProviderFailures", "maxRequestsPerWindow", "openRequestSeconds", "buildCheckSeconds", "maxUnreadableBuildSeconds", "preflightWaitSeconds", "holdGraceSeconds", "spacingSeconds", "progressEvery"]
# The least a hold waits for the harness's own halt to show (its pacing entry): its whole shutdown took 0.1 to 0.25 s
# over Astryx's 430 records.
HALT_SECONDS = 2.0
nano = lambda usd: round(usd * 1e9)
whole = lambda v: isinstance(v, int) and not isinstance(v, bool)
number = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)


class Stop(Exception):
    """A condition the window stops on: its rule, what was seen, and whether the harness stops itself on it (a hold)."""

    def __init__(self, rule, message, harness_stops=False, reserved_at=None, pid=None):
        super().__init__(f"{rule}: {message}")
        self.rule = rule
        self.message = message
        self.harness_stops = harness_stops
        self.reserved_at = reserved_at  # a hold: when its request was reserved (epoch seconds)
        self.pid = pid  # the process to stop, when the run's lock names one outside --pgid


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
        self.id = None  # this window's invocation id, from its first ledger line
        self.identity = None
        self.reserved = {}
        self.open = None  # (request, since in epoch seconds)
        self.sent = 0
        self.settled = 0
        self.released = 0
        self.in_a_row = 0
        self.chain_ended = False  # a cell was logged since the last request: the next request starts a new chain
        self.backoff_s = 0.0
        self.provider_failures = 0
        self.cells = 0
        self.outcomes = Counter()
        self.raised = []
        self.unreadable = 0
        self.unreadable_since = None
        self.set_aside = 0
        self.started = None  # when the monitor started, in epoch seconds (main() sets it)

    # --- the window's identity ---------------------------------------------------------------------------------
    def begin(self, manifest, preflight):
        e = self.expect
        if not isinstance(preflight.get("at"), str):
            raise Stop("integrity", "this window's preflight names no time")
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
        # A resume sets aside a served model no record shows measured, and the run records the next one a reply reports.
        # That is allowed for the model expected; another means a reply on it came back.
        aside = manifest.get("setAside") or []
        for entry in aside[self.set_aside:]:
            model = (((entry or {}).get("servedModel")) or {}).get("id")
            if model != self.expect["model"]:
                raise Stop("model", f"a resume set aside {model!r} as the run's served model: a reply on a model other than {self.expect['model']} came back, though no record shows it measured")
            self.log(f"a resume set aside the served model {model} (no record showed it measured), the model expected; the run records it again from its next reply")
        self.set_aside = max(self.set_aside, len(aside))
        if self.identity is not None and {k: manifest.get(k) for k in IDENTITY} != self.identity:
            raise Stop("integrity", "the manifest's identity changed while the window ran")

    def live_build(self, build, now=None):
        """A reading of the live build, taken at `now` (epoch seconds): unreadable ones count by the clock, since each
        failed fetch adds to the time between readings; without a time, by their number."""
        limit = self.c["maxUnreadableBuildSeconds"]
        if build is None:
            self.unreadable += 1
            if now is not None and self.unreadable_since is None:
                self.unreadable_since = now
            unread = now - self.unreadable_since if now is not None else self.unreadable * self.c["buildCheckSeconds"]
            if unread >= limit:
                raise Stop("build", f"the live build could not be read for {unread:.0f} s ({self.unreadable} readings in a row): the window cannot confirm it still runs on {self.expect['build']}")
            self.log(f"the live build could not be read ({self.unreadable} in a row, {unread:.0f} s; the window stops once that is {limit} s)")
            return
        self.unreadable = 0
        self.unreadable_since = None
        self.log(f"build {build}")
        if build != self.expect["build"]:
            raise Stop("build", f"the live deployment is build {build}, the window expects {self.expect['build']}")

    # --- the ledger -----------------------------------------------------------------------------------------------
    def mine(self, line):
        return str(line.get("invocation", "")).startswith(f"{self.inv}~")

    def ledger(self, line):
        inv = line.get("invocation")
        if not isinstance(inv, str) or "~" not in inv:
            raise Stop("settlement", f"a ledger line naming no invocation: {json.dumps(line)[:200]}")
        if not self.mine(line):
            if inv.split("~", 1)[0] > self.inv:
                raise Stop("integrity", f"a ledger line from invocation {inv}, which started after this window's ({self.inv}): another process writes the run, or --preflights is not this window")
            return  # an earlier window's line
        if self.id is None:
            self.id = inv
        elif inv != self.id:
            raise Stop("integrity", f"two invocations write this window's ledger: {self.id} and {inv}")
        req = line.get("request")
        if not isinstance(req, str):
            raise Stop("settlement", f"a ledger line with no request: {json.dumps(line)[:200]}")
        if "adjust" not in line:
            if set(line) != {"at", "invocation", "request", "usd"} or not number(line["usd"]):
                raise Stop("settlement", f"an unrecognized ledger line: {json.dumps(line)[:200]}")
            # Counted before it is judged: the count the monitor ends on is every request line it read.
            self.sent += 1
            if req != f"{inv}#{self.sent}":
                raise Stop("settlement", f"{req} is not request #{self.sent} of this window: the ledger is out of sequence")
            if self.open is not None:
                raise Stop("settlement", f"{req} reserved while {self.open[0]} was still in flight")
            if self.chain_ended:
                self.in_a_row = 0
                self.chain_ended = False
            # Followed even when it is past the window's limit, so its settlement reads as what it is.
            self.reserved[req] = nano(line["usd"])
            self.open = (req, epoch(line["at"]))
            if self.sent > self.c["maxRequestsPerWindow"]:
                raise Stop("integrity", f"{req} is this window's request {self.sent}; a window may send {self.c['maxRequestsPerWindow']} (its --max-requests)")
            return
        reason = line.get("reason")
        if not number(line.get("final")) or not number(line.get("adjust")):
            raise Stop("settlement", f"{req}: a settlement without a final amount and an adjustment: {json.dumps(line)[:200]}")
        if reason == NEVER_READ and not req.startswith(f"{self.inv}~"):
            # The request an earlier window left in flight, raised by this one before it sends anything.
            if self.sent > 0:
                raise Stop("settlement", f"{req}, left in flight by an earlier window, was raised after this window's first request")
            if nano(line["final"]) < REQUEST_BOUND_NANO:
                raise Stop("settlement", f"{req} left in flight was raised to {line['final']}, below the most a request can cost")
            self.raised.append(req)
            self.log(f"the request an earlier window left in flight, {req}, raised to ${line['final']:.6f} (expected after a stop with a request in flight)")
            return
        if self.open is None or self.open[0] != req:
            raise Stop("settlement", f"a settlement for {req}, which is not the request in flight")
        if self.reserved[req] + nano(line["adjust"]) != nano(line["final"]):
            raise Stop("settlement", f"{req}: reserve + adjust {line['adjust']} != final {line['final']}")
        reserved_at = self.open[1]
        self.open = None
        if reason == RELEASED:
            if nano(line["final"]) != 0:
                raise Stop("settlement", f"{req} released at {line['final']}, not zero")
            self.on_release(req)
            return
        self.in_a_row = 0
        if reason == UNVERIFIED:
            raise Stop("settlement", f"{req} held at ${line['final']:.6f}, its usage not verified (a reply the run cannot trust)", harness_stops=True, reserved_at=reserved_at)
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
            raise Stop("refusals", f"this window's refusals have cost {self.backoff_s:.0f} s of backoff (at most {self.c['maxBackoffSeconds']} s, each release counted as if retried); the last, {req}")
        self.log(f"a refusal released at no cost: {req}, {self.in_a_row} in a row; the harness waits {wait:.0f} s if it retries ({self.released} released, {self.backoff_s:.0f} s of backoff in this window)")

    # --- the cells ------------------------------------------------------------------------------------------------
    def record(self, rec):
        self.cells += 1
        # The chain of refusals ends with the cell, from the next request on: a record read before its cell's last
        # release (written first, read second) must not hide that release's place in the chain.
        self.chain_ended = True
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
        failure = rec.get("failure")
        calls = [c for c in rec.get("calls") or [] if c.get("source") == "provider"]
        for i, c in enumerate(calls):
            if c.get("model") == e["model"]:
                continue
            turned_away = c.get("outcome") == "provider-error" and c.get("model") is None and not whole(c.get("inputTokens")) and not whole(c.get("outputTokens"))
            if turned_away and i == len(calls) - 1 and (failure or {}).get("kind") in ("provider", "policy"):
                continue
            if turned_away:
                raise Stop("model", f"{key}: a call that names no model, which only the turned-away last call of a cell that failed on it may be")
            raise Stop("model", f"{key}: a provider call on {c.get('model')!r}")
        if outcome == "invariant-failure" or rec.get("path") == "invariant":
            raise Stop("integrity", f"{key}: an invariant failure")
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
            before = self.started is not None and self.open[1] < self.started
            raise Stop("integrity", f"{self.open[0]} in flight {now - self.open[1]:.0f} s with no settlement" + (" (it was in flight before the monitor started: is --preflights this window's count?)" if before else ""))

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

    def log(message):
        line = f"{datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')} {message}"
        with open(a.events, "a") as f:
            f.write(line + "\n")
        print(line, flush=True)

    # Signal 0 to group 0 or 1, or to the monitor's own group, would reach the monitor or everything else.
    if a.pgid <= 1 or a.pgid == os.getpgrp():
        log(f"refused: --pgid {a.pgid} is {'this monitor’s own process group' if a.pgid > 1 else 'no process group a launch makes'}; give the harness's (its setsid launcher's pid)")
        return 2
    try:
        os.killpg(a.pgid, 0)
    except ProcessLookupError:
        log(f"refused: no process group {a.pgid} is running; give the harness's (its setsid launcher's pid, from a script without job control)")
        return 2
    except PermissionError:
        pass
    if a.preflights < 1:
        log(f"refused: --preflights {a.preflights}; the first window is 1")
        return 2
    with open(a.config) as f:
        config = json.load(f)
    missing = [k for k in ["expect", *LIMITS] if k not in config]
    if missing:
        log(f"refused: the monitor config {a.config} has no {', '.join(missing)}")
        return 2
    with open(a.corpus) as f:
        corpus = json.load(f)

    def alive():
        """Whether a process of the harness's group still runs. A group whose processes have all exited but are not yet
        reaped (zombies) still answers signal 0, so /proc decides; if /proc shows none of the group, the signal does."""
        try:
            os.killpg(a.pgid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        states = []
        try:
            pids = [p for p in os.listdir("/proc") if p.isdigit()]
        except OSError:
            return True
        for pid in pids:
            try:
                with open(f"/proc/{pid}/stat") as f:
                    stat = f.read()
            except OSError:
                continue
            fields = stat[stat.rfind(")") + 2:].split()
            if len(fields) > 2 and fields[2] == str(a.pgid):
                states.append(fields[0])
        return not states or any(s != "Z" for s in states)

    m = Monitor(config, corpus, log)
    m.started = time.time()
    run = a.run
    deadline = time.time() + a.hand_back_after
    newest = "preflight.json" if a.preflights == 1 else f"preflight.resume-{a.preflights - 1}.json"
    after = f"preflight.resume-{a.preflights}.json"
    exists = lambda name: os.path.exists(os.path.join(run, name))

    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def holder():
        """The harness the run's lock names: (its pid, its process group), when it runs on this host and took the lock
        for this window (after this window's preflight, or, before that is known, at most 5 minutes before the monitor
        started; an older lock is a stopped window's, whose pid may since be another process's). Otherwise None."""
        try:
            with open(os.path.join(run, "run.lock")) as f:
                lock = json.load(f)
        except (OSError, ValueError):
            return None
        if not isinstance(lock, dict) or not whole(lock.get("pid")) or lock["pid"] <= 1 or lock.get("host") != socket.gethostname():
            return None
        if not isinstance(lock.get("at"), str) or lock["at"] < (m.inv if m.inv is not None else iso(m.started - 300)):
            return None
        try:
            return lock["pid"], os.getpgid(lock["pid"])
        except (ProcessLookupError, PermissionError):
            return None

    verified = []  # the harness's pid, once the run's lock has shown it inside --pgid

    def check_holder():
        """Once the run's lock names this window's harness, it must be inside --pgid: a group that does not hold the run
        (another process, the operator's shell) is never signalled, and the process the lock names is stopped instead."""
        if verified:
            return
        found = holder()
        if found is None:
            return
        if found[1] != a.pgid:
            raise Stop("integrity", f"the run's lock names pid {found[0]}, in process group {found[1]}, not --pgid {a.pgid}: --pgid is not the harness's, so it is not signalled; the process the lock names is stopped instead", pid=found[0])
        verified.append(found[0])
        log(f"the run's lock names pid {found[0]}, inside --pgid {a.pgid}: the harness")

    def pid_alive(pid):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        try:
            with open(f"/proc/{pid}/stat") as f:
                stat = f.read()
            return stat[stat.rfind(")") + 2:].split()[0] != "Z"
        except (OSError, IndexError):
            return True

    def stop(s):
        log(f"STOP ({s.rule}): {s.message}")
        target = s.pid  # a process the run's lock names outside --pgid: it alone is signalled
        if target is None and not verified:
            try:
                check_holder()
            except Stop as outside:
                target = outside.pid
                log(outside.message)
        if target is None and not verified:
            if not alive():
                last_lines("after the harness exited")
                log(f"the harness had already exited by itself; no signal sent: {m.progress()}")
                return 0
            log(f"nothing is signalled: no lock of this window's has shown the harness inside --pgid {a.pgid}. If the harness runs, stop it by hand: {m.progress()}")
            return 2
        running = (lambda: pid_alive(target)) if target is not None else alive
        send = (lambda sig: os.kill(target, sig)) if target is not None else (lambda sig: os.killpg(a.pgid, sig))
        if not running():
            last_lines("after the harness exited")
            log(f"the harness had already exited by itself; no signal sent: {m.progress()}")
            return 0
        try:
            send(signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(60):
            if not running():
                break
            time.sleep(0.5)
        if running():
            try:
                send(signal.SIGKILL)
            except ProcessLookupError:
                pass
            log("the harness did not exit on SIGTERM; sent SIGKILL")
        last_lines("after the stop")
        log(f"harness stopped by the monitor: {m.progress()}")
        return 10

    def last_resort(error):
        """The stop itself failed: the harness is signalled plainly, where the run's lock showed it to be."""
        try:
            log(f"the monitor's stop failed ({error!r}); signalling the harness plainly")
        except Exception:
            pass
        try:
            if verified:
                os.killpg(a.pgid, signal.SIGTERM)
                return 10
            found = holder()
            if found is not None:
                os.kill(found[0], signal.SIGTERM)
                return 10
        except Exception:
            pass
        return 1

    def live_build():
        """The live build, read as the harness's preflight reads it (live/preflight.ts readBuildId): the build manifest
        named in the page, else the flight payload's "b", and only if that build's manifest is served. None if it
        cannot be read."""

        def get(url, body):
            out = subprocess.run(["curl", "-sS", "-L", "--max-time", "10", "-H", "accept: text/html", *([] if body else ["-o", "/dev/null"]), "-w", "\n%{http_code}", url], capture_output=True, text=True, timeout=20)
            text, _, code = out.stdout.rpartition("\n")
            return code, text

        try:
            if a.build_url.startswith("file://"):
                with open(a.build_url[len("file://"):]) as f:
                    html = f.read()
            else:
                code, html = get(a.build_url, True)
                if code != "200":
                    return None
            found = re.search(r"_next/static/([A-Za-z0-9_-]+)/_buildManifest\.js", html) or re.search(r'\\?"b\\?":\\?"([A-Za-z0-9_-]+)\\?"', html)
            if not found:
                return None
            if not a.build_url.startswith("file://") and get(urljoin(a.build_url, f"/_next/static/{found.group(1)}/_buildManifest.js"), False)[0] != "200":
                return None
            return found.group(1)
        except Exception:
            return None

    readings = []
    readings_lock = threading.Lock()

    def read_builds():
        while True:
            build = live_build()
            with readings_lock:
                readings.append((time.time(), build))
            time.sleep(config["buildCheckSeconds"])

    offsets = {"requests.jsonl": 0, "runs.jsonl": 0}
    inodes = {}
    seen = set()
    pending = []
    order = itertools.count()

    def read_new(name):
        """The whole lines appended to a log since the last read, each once. A log replaced (a new inode: a resume's
        settled ledger, a re-run's rewritten runs.jsonl) or cut is read again from its start, skipping what was read.
        A cut-off last line waits for its end."""
        try:
            with open(os.path.join(run, name), "rb") as f:
                st = os.fstat(f.fileno())
                if inodes.get(name) != (st.st_dev, st.st_ino) or st.st_size < offsets[name]:
                    inodes[name] = (st.st_dev, st.st_ino)
                    offsets[name] = 0
                f.seek(offsets[name])
                data = f.read()
        except FileNotFoundError:
            return []
        cut = data.rfind(b"\n") + 1
        offsets[name] += cut
        out = []
        for raw in data[:cut].decode("utf-8").splitlines():
            if not raw.strip() or (name, raw) in seen:
                continue
            seen.add((name, raw))
            try:
                item = json.loads(raw)
            except ValueError:
                item = None
            if not isinstance(item, dict):
                raise Stop("settlement" if name == "requests.jsonl" else "integrity", f"{name}: a line that is not a JSON object")
            out.append(item)
        return out

    def drain(seen_after=None):
        """Both logs' new lines in the order they were written, and whether there were any. runs.jsonl is read first: a
        record is written after every ledger line of its cell, so the ledger read after it holds them all. Then by
        time; on a tie, a settlement before a record before a reservation, as the harness writes them when nothing
        waits between: it settles a request, logs its cell, then reserves the next request. Once the harness has gone
        (seen_after says when), a condition is logged and the rest still read, so the closing count is all the window
        wrote."""
        records = [x for x in read_new("runs.jsonl") if str(x.get("at", "")) >= m.inv]
        lines = read_new("requests.jsonl")
        items = [(str(x.get("at", "")), 0 if "adjust" in x else 2, next(order), x) for x in lines] + [(str(x.get("at", "")), 1, next(order), x) for x in records]
        # A line read but not yet judged waits here: a stop on one line leaves the rest for the closing read.
        pending.extend(items)
        pending.sort(key=lambda t: t[:3])
        while pending:
            _, source, _, x = pending.pop(0)
            try:
                (m.record if source == 1 else m.ledger)(x)
            except Stop as late:
                if seen_after is None:
                    raise
                log(f"{'HOLD' if late.harness_stops else 'STOP'} ({late.rule}), seen {seen_after}: {late.message}")
        return bool(items)

    def last_lines(when):
        """The run's last lines, read once the harness has gone; nothing in them is signalled."""
        if m.inv is None:
            return
        try:
            drain(seen_after=when)
        except Exception as error:
            log(f"the run's last lines could not be read {when}: {error!r}")

    def exited(message):
        """The harness exited by itself: what it wrote last is read, and a condition in it logged, never signalled."""
        last_lines("after the harness exited")
        log(f"{message}: {m.progress()}")
        return 0

    def hold(s):
        """A hold: the harness halts itself on a reply it cannot trust, or carries on with one that passed its integrity
        checks. It has the time to show which; if it carried on, it is stopped where nothing is in flight."""
        grace = config["holdGraceSeconds"]
        t0 = time.time()
        # Its next request goes out no sooner than the held one's reservation plus the spacing: until then, less a
        # margin for the poll and the signal, a stop finds nothing in flight. Its own halt shows within a second.
        safe = s.reserved_at + config["spacingSeconds"] - 1.0 if s.reserved_at is not None else t0
        decide = min(t0 + grace, max(t0 + HALT_SECONDS, safe))
        log(f"HOLD ({s.rule}): {s.message}. The harness halts itself on such a reply, or carries on with one that passed its integrity checks: it has {decide - t0:.1f} s to show it is halting, and {grace} s to exit")
        halting = False
        cells = m.cells
        into_request = False
        while True:
            if not alive():
                return exited("the harness stopped itself after the hold")
            if not halting and ended_windows(m.inv):
                halting = True
                log("its pacing entry is written: the harness is ending its window by itself")
            if halting:
                if time.time() >= t0 + grace:
                    return stop(Stop(s.rule, f"{s.message}; the harness had not exited {grace} s after it"))
            else:
                drain()
                if m.open is not None:
                    into_request = True  # it carried on into another request: stopped once that one settles
                elif into_request:
                    return stop(Stop(s.rule, f"{s.message}; the harness carried on after it into another request, and was stopped once that request settled"))
                elif m.cells > cells:
                    return stop(Stop(s.rule, f"{s.message}; the harness carried on after it, and was stopped on its cell's record, between cells"))
                elif time.time() >= decide:
                    return stop(Stop(s.rule, f"{s.message}; the harness carried on after it, and was stopped before its next request could go out"))
            time.sleep(min(a.poll, 0.05))

    def requests_now():
        """The requests (not settlements) the ledger holds now; a cut-off or unreadable line is none yet."""
        ids = set()
        try:
            with open(os.path.join(run, "requests.jsonl"), encoding="utf-8") as f:
                for raw in f:
                    try:
                        x = json.loads(raw) if raw.endswith("\n") else None
                    except ValueError:
                        x = None
                    if isinstance(x, dict) and "adjust" not in x and isinstance(x.get("request"), str):
                        ids.add(x["request"])
        except FileNotFoundError:
            pass
        return ids

    def load(name):
        """A JSON file the harness writes: a preflight is written in place, so a read can catch it half-written."""
        for _ in range(50):
            try:
                with open(os.path.join(run, name)) as f:
                    return json.load(f)
            except ValueError:
                time.sleep(0.1)
        raise Stop("integrity", f"{name} is not readable JSON")

    def ended_windows(at):
        """The pacing entries of the window whose preflight is at `at`: an ended window has one."""
        out = []
        try:
            with open(os.path.join(run, "pacing.jsonl"), encoding="utf-8") as f:
                for raw in f:
                    try:
                        x = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(x, dict) and x.get("at") == at:
                        out.append(x)
        except FileNotFoundError:
            pass
        return out

    log(f"monitor up: window {a.preflights}, run {run}, harness process group {a.pgid}, waiting for {newest}; limits {json.dumps({k: config[k] for k in LIMITS}, separators=(',', ':'))}")
    try:
        before = requests_now()
        wait_until = time.time() + config["preflightWaitSeconds"]
        while not (exists(newest) and exists("manifest.json")):
            if not alive():
                log(f"the harness exited before {newest} was written (a launch the harness refuses writes none): {m.progress()}")
                return 0
            if exists(after):
                raise Stop("integrity", f"the run already holds {after}: --preflights {a.preflights} is not this window")
            sent = sorted(requests_now() - before)
            if sent and not exists(newest):
                raise Stop("integrity", f"{sent[0]} was sent, yet {newest} does not exist: --preflights {a.preflights} is not this window")
            if time.time() > wait_until:
                raise Stop("integrity", f"no {newest} within {config['preflightWaitSeconds']} s: --preflights {a.preflights} is not this window, or the harness is stuck before its preflight")
            time.sleep(a.poll)
        if exists(after):
            raise Stop("integrity", f"the run already holds {after}: --preflights {a.preflights} is not this window")
        preflight = load(newest)
        ended = ended_windows(preflight.get("at"))
        if ended:
            raise Stop("integrity", f"the window of {newest} has ended already ({(ended[0].get('stopped') or {}).get('reason', 'complete')}): --preflights {a.preflights} is not this window")
        m.begin(load("manifest.json"), preflight)
        threading.Thread(target=read_builds, daemon=True).start()
        while True:
            check_holder()
            if exists(after):
                raise Stop("integrity", f"{after} was written while this window ran: --preflights {a.preflights} is not this window, or another process resumed the run")
            drain()
            m.check_manifest(load("manifest.json"))
            if not alive():
                return exited("the harness exited")
            if not verified and ended_windows(m.inv):
                # The window has ended by itself, and --pgid still runs though no lock of this window's showed the
                # harness inside it: it is not the harness's.
                end = time.time() + config["holdGraceSeconds"]
                while alive() and time.time() < end:
                    time.sleep(0.1)
                if not alive():
                    return exited("the harness exited")
                log(f"the window has ended, and --pgid {a.pgid} still runs, though no lock of this window's showed the harness inside it: it is not the harness's, and nothing is signalled: {m.progress()}")
                return 2
            m.tick(time.time())
            with readings_lock:
                builds = readings[:]
                readings.clear()
            for at_, build in builds:
                m.live_build(build, now=at_)
            if time.time() > deadline:
                log(f"handing back while the harness runs: {m.progress()}")
                return 20
            time.sleep(a.poll)
    except Stop as s:
        outcome = s
    except Exception as error:  # fail closed: an unwatched window is worse than a stopped one
        outcome = Stop("monitor", f"the monitor failed, and stops the window rather than leave it unwatched: {error!r}")
    try:
        try:
            return hold(outcome) if outcome.harness_stops else stop(outcome)
        except Stop as later:  # a condition seen while waiting out a hold: a stop, never a second wait
            return stop(Stop(later.rule, later.message, pid=later.pid))
        except Exception as error:
            return stop(Stop("monitor", f"the monitor failed while it stopped the window: {error!r}"))
    except Exception as error:
        return last_resort(error)


if __name__ == "__main__":
    sys.exit(main())
