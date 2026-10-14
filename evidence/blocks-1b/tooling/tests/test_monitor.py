"""monitor_run.py, offline: each rule on its own, the synthetic runs replayed through it, and the monitor watching a
live synthetic harness (synth/invocation.mts: the real harness and Worker, a scripted model, real but scaled sleeps).
No provider is called and nothing leaves the machine.

    python3 -I evidence/blocks-1b/tooling/tests/test_monitor.py -v
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLING = os.path.dirname(HERE)
CHECKOUT = os.environ.get("DSPACK_STUDIO", "/home/user/dspack-studio")
CORPUS_V2 = os.path.join(CHECKOUT, "packages/block-bench/live/corpora/blocks.v2.json")
TSX = os.path.join(CHECKOUT, "packages/block-bench/node_modules/.bin/tsx")
spec = importlib.util.spec_from_file_location("monitor_run", os.path.join(TOOLING, "monitor_run.py"))
mon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mon)

MODEL = "claude-haiku-4-5-20251001"
with open(CORPUS_V2) as f:
    CORPUS = json.load(f)
with open(os.path.join(TOOLING, "monitor-shadcn.json")) as f:
    SHADCN = json.load(f)
PIN = {"id": "blocks-1b", "version": 2, "frozenAt": "2026-10-12", "sha256": "0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9"}


def jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(x) for x in f if x.strip()]


def count_lines(path):
    with open(path) as f:
        return sum(1 for _ in f)


def config(**over):
    """The shadcn configuration's thresholds, for a reference and deployment a test names."""
    c = json.loads(json.dumps(SHADCN))
    c["expect"].update({"build": "BuildA", "reference": "astryx", "provider": "hosted-ai:claude-haiku-4.5@https://synthetic.example", "code": "c0de"})
    for k, v in over.items():
        if k in c["expect"]:
            c["expect"][k] = v
        else:
            c[k] = v
    return c


INV = "2026-10-14T00:00:00.000Z"
ID = f"{INV}~0000"
MANIFEST = {
    "runId": "t", "startedAt": INV, "provider": "hosted-ai:claude-haiku-4.5@https://synthetic.example", "corpus": PIN,
    "references": [{"id": "astryx"}], "code": {"sha256": "c0de"}, "model": None,
    "deployment": {"baseUrl": "https://synthetic.example", "buildId": "BuildA", "worker": "per-call-model"},
    "selection": {}, "decision": {}, "servedModel": {"id": MODEL, "at": INV},
}
PREFLIGHT = {"at": INV, "buildId": "BuildA", "worker": {"shape": "per-call-model"}, "models": ["scripted", "hosted-ai"]}


class Clock:
    def __init__(self):
        self.t = 0

    def __call__(self):
        self.t += 1
        return f"2026-10-14T00:{self.t // 60:02d}:{self.t % 60:02d}.000Z"


def reserve(at, n, usd=0.1, inv=ID):
    return {"at": at(), "invocation": inv, "request": f"{inv}#{n}", "usd": usd}


def settle(at, n, reported=0.01, usd=0.1, model=MODEL, inv=ID):
    return {"at": at(), "invocation": inv, "request": f"{inv}#{n}", "final": reported, "adjust": round(reported - usd, 9), "reason": mon.SETTLED, "servedModel": model}


def release(at, n, usd=0.1, inv=ID):
    return {"at": at(), "invocation": inv, "request": f"{inv}#{n}", "final": 0, "adjust": -usd, "reason": mon.RELEASED, "servedModel": MODEL}


def record(at, prompt="rt-01", arm="production", condition="fresh", **over):
    p = next(x for x in CORPUS["prompts"] if x["id"] == prompt)
    r = {"at": at(), "reference": "astryx", "provider": "hosted-ai:claude-haiku-4.5", "arm": arm, "prompt": prompt, "condition": condition,
         "expected": {"intent": p["intent"]["astryx"], "block": p["block"]}, "status": "completed", "outcome": "passed", "passed": True,
         "calls": [{"operation": "generate", "source": "provider", "inputTokens": 10, "outputTokens": 5, "model": MODEL, "outcome": "ok"}]}
    r.update(over)
    return r


class Rules(unittest.TestCase):
    def setUp(self):
        self.logged = []
        self.m = mon.Monitor(config(), CORPUS, log=self.logged.append)
        self.m.begin(MANIFEST, PREFLIGHT)
        self.at = Clock()
        self.n = 0

    def stops(self, rule, feed):
        with self.assertRaises(mon.Stop) as caught:
            feed()
        self.assertEqual(caught.exception.rule, rule, caught.exception.message)
        return caught.exception.message

    def request(self, refusals=0, reported=0.01):
        """One request: refused `refusals` times (each retried), then settled."""
        for _ in range(refusals):
            self.n += 1
            self.m.ledger(reserve(self.at, self.n))
            self.m.ledger(release(self.at, self.n))
        self.n += 1
        self.m.ledger(reserve(self.at, self.n))
        self.m.ledger(settle(self.at, self.n, reported))

    # Refusals.
    def test_a_refusal_answered_on_its_retry_is_allowed(self):
        self.request(refusals=1)
        self.m.record(record(self.at))
        self.assertEqual((self.m.released, self.m.backoff_s), (1, 30))
        self.assertTrue(any("released at no cost" in x and "waits 30 s" in x for x in self.logged))

    def test_a_refusal_answered_within_the_whole_schedule_is_allowed(self):
        self.request(refusals=4)
        self.assertEqual((self.m.released, self.m.backoff_s), (4, 450))

    def test_a_request_refused_through_its_whole_schedule_stops(self):
        message = self.stops("refusals", lambda: self.request(refusals=5))
        self.assertIn("refused 5 times in a row", message)

    def test_repeated_refusals_stop_at_the_eighth(self):
        for _ in range(7):
            self.request(refusals=1)
            self.m.record(record(self.at))
        message = self.stops("refusals", lambda: self.request(refusals=1))
        self.assertIn("8 refusals released", message)

    def test_refusals_stop_once_their_backoff_reaches_fifteen_minutes(self):
        # The limit as configured: fifteen minutes here, against the shipped ten.
        self.m = mon.Monitor(config(maxReleased=100, maxBackoffSeconds=900), CORPUS, log=self.logged.append)
        self.m.begin(MANIFEST, PREFLIGHT)
        self.request(refusals=4)  # 450 s
        self.request(refusals=3)  # 660 s
        message = self.stops("refusals", lambda: self.request(refusals=4))  # 690, 750, 870, then 1110 s
        self.assertIn("1110 s of backoff", message)

    def test_a_chain_does_not_run_on_across_a_cell(self):
        # A refusal that failed its cell (not retried) and the next cell's first refusal are not one chain.
        for _ in range(4):
            self.n += 1
            self.m.ledger(reserve(self.at, self.n))
            self.m.ledger(release(self.at, self.n))
        self.m.record(record(self.at, outcome="failed-adapter", passed=False, failure={"kind": "provider", "message": "busy", "rerunEligible": True}))
        self.n += 1
        self.m.ledger(reserve(self.at, self.n))
        self.m.ledger(release(self.at, self.n))  # a fifth release in a row, but the first of its own cell
        self.assertEqual(self.m.in_a_row, 1)

    # Settlements.
    def test_a_held_request_stops(self):
        self.m.ledger(reserve(self.at, 1))
        line = settle(self.at, 1, 1.118208)
        line["reason"] = mon.UNVERIFIED
        self.stops("settlement", lambda: self.m.ledger(line))

    def test_arithmetic_that_does_not_hold_stops(self):
        self.m.ledger(reserve(self.at, 1))
        line = settle(self.at, 1)
        line["final"] = 0.011
        self.stops("settlement", lambda: self.m.ledger(line))

    def test_a_release_that_kept_money_stops(self):
        self.m.ledger(reserve(self.at, 1))
        line = release(self.at, 1)
        line.update(final=0.001, adjust=-0.099)
        self.stops("settlement", lambda: self.m.ledger(line))

    def test_two_requests_in_flight_stop(self):
        self.m.ledger(reserve(self.at, 1))
        self.stops("settlement", lambda: self.m.ledger(reserve(self.at, 2)))

    def test_a_settlement_for_a_request_not_in_flight_stops(self):
        self.stops("settlement", lambda: self.m.ledger(settle(self.at, 1)))

    def test_an_unrecognized_line_stops(self):
        self.stops("settlement", lambda: self.m.ledger({"at": self.at(), "invocation": ID, "request": f"{ID}#1", "usd": 0.1, "extra": 1}))

    def test_an_earlier_windows_lines_are_not_this_windows(self):
        other = "2026-10-13T00:00:00.000Z~9999"
        self.m.ledger(reserve(self.at, 1, inv=other))
        self.assertEqual(self.m.sent, 0)

    def test_the_raise_for_an_earlier_windows_open_request_is_allowed_before_the_first_request(self):
        earlier = "2026-10-13T00:00:00.000Z~9999#7"
        self.m.ledger({"at": self.at(), "invocation": ID, "request": earlier, "adjust": 1.0, "final": 1.118208, "reason": mon.NEVER_READ, "servedModel": MODEL})
        self.assertEqual(self.m.raised, [earlier])
        self.request()

    def test_a_raise_after_this_windows_first_request_stops(self):
        self.request()
        earlier = "2026-10-13T00:00:00.000Z~9999#7"
        self.stops("settlement", lambda: self.m.ledger({"at": self.at(), "invocation": ID, "request": earlier, "adjust": 1.0, "final": 1.118208, "reason": mon.NEVER_READ}))

    # Model.
    def test_a_settlement_on_another_model_stops(self):
        self.m.ledger(reserve(self.at, 1))
        self.stops("model", lambda: self.m.ledger(settle(self.at, 1, model="claude-haiku-4-5")))

    def test_a_call_on_another_model_stops(self):
        r = record(self.at)
        r["calls"][0]["model"] = "claude-sonnet-4-5"
        self.stops("model", lambda: self.m.record(r))

    def test_the_busy_gateways_turned_away_call_names_no_model_and_is_allowed(self):
        r = record(self.at, outcome="planning-failure", passed=False, failure={"kind": "provider", "message": "busy", "rerunEligible": True})
        r["calls"] = [{"operation": "plan", "subCall": 0, "source": "provider", "outcome": "provider-error"}]
        self.m.record(r)
        self.assertEqual(self.m.provider_failures, 1)

    def test_a_manifest_naming_another_served_model_stops(self):
        self.stops("model", lambda: self.m.check_manifest({**MANIFEST, "servedModel": {"id": "claude-haiku-4-5", "at": INV}}))

    # Build.
    def test_another_live_build_stops(self):
        self.m.live_build("BuildA")
        self.stops("build", lambda: self.m.live_build("BuildB"))

    def test_an_unreadable_live_build_is_logged_not_a_stop(self):
        self.m.live_build(None)
        self.assertTrue(any("could not be read" in x for x in self.logged))

    def test_a_window_whose_preflight_found_another_build_stops(self):
        m = mon.Monitor(config(), CORPUS, log=self.logged.append)
        self.stops("build", lambda: m.begin(MANIFEST, {**PREFLIGHT, "buildId": "BuildB"}))

    def test_the_shadcn_configuration_holds_the_baselines_build_and_stops_on_any_other(self):
        e = SHADCN["expect"]
        self.assertEqual(e["build"], "Dyml8RSqfWynKU1KbVuZI")  # claude/blocks-baseline-7e260c3-evidence
        manifest = {**MANIFEST, "provider": e["provider"], "references": [{"id": "shadcn-v3"}], "code": {"sha256": e["code"]}, "deployment": {**MANIFEST["deployment"], "baseUrl": "https://composer.aesthetic-function.com", "buildId": e["build"]}}
        mon.Monitor(SHADCN, CORPUS, log=self.logged.append).begin(manifest, {**PREFLIGHT, "buildId": e["build"]})
        m = mon.Monitor(SHADCN, CORPUS, log=self.logged.append)
        self.stops("build", lambda: m.begin(manifest, {**PREFLIGHT, "buildId": "w6ajVrX5g8V0WhqowIBGN"}))

    # Corpus and integrity.
    def test_another_corpus_stops(self):
        m = mon.Monitor(config(), CORPUS, log=self.logged.append)
        self.stops("corpus", lambda: m.begin({**MANIFEST, "corpus": {**PIN, "version": 1}}, PREFLIGHT))

    def test_a_record_for_another_reference_stops(self):
        self.stops("corpus", lambda: self.m.record(record(self.at, reference="shadcn-v3")))

    def test_a_record_whose_labels_are_not_the_corpus_stops(self):
        self.stops("corpus", lambda: self.m.record(record(self.at, expected={"intent": "data-collection", "block": "records-table"})))

    def test_another_code_identity_stops(self):
        m = mon.Monitor(config(), CORPUS, log=self.logged.append)
        self.stops("integrity", lambda: m.begin({**MANIFEST, "code": {"sha256": "other"}}, PREFLIGHT))

    def test_the_manifest_changing_while_the_window_runs_stops(self):
        self.stops("integrity", lambda: self.m.check_manifest({**MANIFEST, "selection": {"arms": ["block"]}}))

    def test_an_invariant_failure_stops(self):
        self.stops("integrity", lambda: self.m.record(record(self.at, outcome="invariant-failure", passed=False)))

    def test_a_request_in_flight_ten_minutes_stops(self):
        self.m.ledger(reserve(self.at, 1))  # reserved at 00:00:01
        self.m.tick(mon.epoch("2026-10-14T00:05:00.000Z"))
        self.stops("integrity", lambda: self.m.tick(mon.epoch("2026-10-14T00:10:02.000Z")))

    # From the review of 8bf756d.
    def test_a_record_read_before_the_fifth_release_still_stops(self):
        # The fifth release and its cell's record can land between two reads; the record is then processed first.
        for _ in range(4):
            self.n += 1
            self.m.ledger(reserve(self.at, self.n))
            self.m.ledger(release(self.at, self.n))
        self.n += 1
        self.m.ledger(reserve(self.at, self.n))
        self.m.record(record(self.at, outcome="planning-failure", passed=False, failure={"kind": "provider", "message": "busy", "rerunEligible": True}))
        message = self.stops("refusals", lambda: self.m.ledger(release(self.at, self.n)))
        self.assertIn("refused 5 times in a row", message)

    def test_the_backoff_limit_fires_before_the_release_limit(self):
        # With the shipped limits, a full schedule then three more refusals in a row stop on backoff, at 7 releases.
        self.request(refusals=4)  # 450 s, allowed
        message = self.stops("refusals", lambda: self.request(refusals=3))  # 480, 540, then 660 s
        self.assertIn("660 s of backoff", message)
        self.assertEqual(self.m.released, 7)

    def test_a_hold_is_left_to_the_harness_to_stop(self):
        self.m.ledger(reserve(self.at, 1))
        line = settle(self.at, 1, 1.118208)
        line["reason"] = mon.UNVERIFIED
        with self.assertRaises(mon.Stop) as caught:
            self.m.ledger(line)
        self.assertTrue(caught.exception.harness_stops)

    def test_a_request_from_another_invocation_stops(self):
        other = "2026-10-14T00:00:00.500Z~ffff"
        self.stops("integrity", lambda: self.m.ledger({"at": "2026-10-14T00:00:30.000Z", "invocation": other, "request": f"{other}#1", "usd": 0.1}))

    def test_more_requests_than_the_window_allows_stop(self):
        self.m = mon.Monitor(config(maxRequestsPerWindow=3), CORPUS, log=self.logged.append)
        self.m.begin(MANIFEST, PREFLIGHT)
        for _ in range(3):
            self.request()
        self.stops("integrity", lambda: self.request())

    def test_a_turned_away_call_must_end_a_failed_cell(self):
        r = record(self.at)
        r["calls"] = [{"operation": "plan", "subCall": 0, "source": "provider", "outcome": "provider-error"}, *r["calls"]]
        self.stops("model", lambda: self.m.record(r))

    def test_a_set_aside_record_is_allowed_when_the_model_measured_is_the_one_expected(self):
        self.m.check_manifest({**MANIFEST, "setAside": [{"servedModel": {"id": MODEL, "at": INV}, "at": INV, "invocation": ID}]})
        self.stops("model", lambda: self.m.check_manifest({**MANIFEST, "servedModel": {"id": "claude-haiku-4-5", "at": INV}, "setAside": [{"servedModel": {"id": MODEL, "at": INV}, "at": INV, "invocation": ID}]}))

    def test_an_unreadable_build_stops_once_it_has_been_unreadable_five_minutes(self):
        unread = SHADCN["maxUnreadableBuildSeconds"] // SHADCN["buildCheckSeconds"]
        for _ in range(unread - 1):
            self.m.live_build(None)
        self.stops("build", lambda: self.m.live_build(None))

    def test_the_shadcn_configuration_checks_the_build_every_30_seconds(self):
        self.assertEqual(SHADCN["buildCheckSeconds"], 30)
        self.assertEqual(SHADCN["maxBackoffSeconds"], 600)
        self.assertEqual(SHADCN["maxRequestsPerWindow"], 123)

    # Failures.
    def test_one_provider_failure_is_allowed_and_the_second_stops(self):
        failed = lambda: record(self.at, outcome="failed-adapter", passed=False, failure={"kind": "provider", "message": "timeout", "rerunEligible": True})
        self.m.record(failed())
        self.stops("failures", lambda: self.m.record(failed()))

    def test_a_policy_failure_stops(self):
        self.stops("failures", lambda: self.m.record(record(self.at, outcome="failed-adapter", passed=False, failure={"kind": "policy", "message": "413", "rerunEligible": True})))

    def test_ordinary_arm_results_never_stop(self):
        self.m.record(record(self.at, outcome="failed-lint-exhausted", passed=False))
        self.m.record(record(self.at, outcome="failed-gate", passed=False))
        self.m.record(record(self.at, outcome="failed-adapter", passed=False, failure={"kind": "output", "message": "unusable", "rerunEligible": False}))
        self.m.record(record(self.at, status="skipped", outcome=None, passed=False, calls=[]))
        self.assertEqual(self.m.cells, 4)


def replay(name):
    """Each invocation of a synthetic run through a fresh monitor, its ledger lines and records in the order they were
    written, as far as they had been written when the next invocation began. Returns, per invocation, the rule it
    stopped on (None for none) and what the monitor logged."""
    root = os.path.join(TOOLING, "fixtures", name)
    run = os.path.join(root, "run")
    with open(os.path.join(run, "manifest.json")) as f:
        manifest = json.load(f)
    with open(os.path.join(root, "generated.json")) as f:
        code = json.load(f)["code"]["sha256"]
    with open(os.path.join(root, "scenario.json")) as f:
        build = json.load(f)["buildId"]
    names = ["preflight.json"] + sorted((n for n in os.listdir(run) if n.startswith("preflight.resume-")), key=lambda n: int(n.split("-")[1].split(".")[0]))
    preflights = []
    for n in names:
        with open(os.path.join(run, n)) as f:
            preflights.append(json.load(f))
    ledger = jsonl(os.path.join(run, "requests.jsonl"))
    records = jsonl(os.path.join(run, "runs.jsonl")) + jsonl(os.path.join(run, "runs.superseded.jsonl"))
    out = []
    for k, pf in enumerate(preflights):
        until = preflights[k + 1]["at"] if k + 1 < len(preflights) else "9999"
        logged = []
        m = mon.Monitor(config(build=build, code=code), CORPUS, log=logged.append)
        stream = [(x["at"], 0, i, x) for i, x in enumerate(ledger) if x["at"] < until] + [(r["at"], 1, i, r) for i, r in enumerate(records) if pf["at"] <= r["at"] < until]
        rule = None
        try:
            m.begin(manifest, pf)
            for _, source, _, x in sorted(stream, key=lambda t: t[:3]):
                (m.ledger if source == 0 else m.record)(x)
            if m.open is not None:
                m.tick(m.open[1] + 601)  # a window whose request was never settled
        except mon.Stop as s:
            rule = s.rule
            logged.append(s.message)
        out.append((rule, logged))
    return out


class Replays(unittest.TestCase):
    def test_five_invocations(self):
        r = replay("synthetic-5")
        self.assertEqual([x[0] for x in r], [None, "settlement", None, "refusals", None])
        self.assertTrue(any("usage not verified" in x for x in r[1][1]))
        self.assertTrue(any("refused 5 times in a row" in x for x in r[3][1]))
        # The retried refusals are logged, none silently: one, then two in a row and the limiter's.
        self.assertEqual(sum("released at no cost" in x for x in r[0][1]), 1)
        self.assertEqual(sum("released at no cost" in x for x in r[2][1]), 3)

    def test_twelve_invocations(self):
        r = replay("synthetic-12")
        self.assertEqual([x[0] for x in r], [None, None, None, "settlement", None, "integrity", None, "refusals", None, None, None, None])
        # The sixth window was killed with a request in flight; the seventh raises it before its first request.
        self.assertTrue(any("raised to $1.118208" in x for x in r[6][1]))
        # Four refusals in a row, then an answer: the whole schedule used, and allowed (450 s of backoff).
        self.assertTrue(any("4 in a row" in x and "450 s of backoff" in x for x in r[9][1]))


class Loop(unittest.TestCase):
    """main() against a fake harness that writes a run directory on a fixed timeline."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="monitor-loop-")
        self.run_dir = os.path.join(self.tmp, "run")
        self.build_file = os.path.join(self.tmp, "build.html")
        with open(self.build_file, "w") as f:
            f.write('<script>self.__next_f.push([1,"{\\"b\\":\\"BuildA\\"}"])</script>')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def start(self, steps):
        plan = os.path.join(self.tmp, "plan.json")
        with open(plan, "w") as f:
            json.dump({"dir": self.run_dir, "steps": steps}, f)
        return subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "fake_harness.py"), plan], start_new_session=True)

    def watch(self, harness, preflights, timeout=30, pgid=None, **over):
        path = os.path.join(self.tmp, "monitor.json")
        with open(path, "w") as f:
            json.dump(config(buildCheckSeconds=0.2, **over), f)
        events = os.path.join(self.tmp, "events.log")
        watcher = subprocess.Popen([sys.executable, "-I", os.path.join(TOOLING, "monitor_run.py"), "--run", self.run_dir, "--pgid", str(pgid or harness.pid), "--preflights", str(preflights), "--config", path, "--corpus", CORPUS_V2, "--events", events, "--poll", "0.05", "--build-url", f"file://{self.build_file}", "--hand-back-after", "8"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + timeout
        while watcher.poll() is None and time.time() < deadline:
            if harness is not None:
                harness.poll()
            time.sleep(0.02)
        if watcher.poll() is None:
            watcher.kill()
            watcher.wait()
        if harness is not None:
            try:
                harness.wait(timeout=10)
            except subprocess.TimeoutExpired:
                harness.kill()
                harness.wait()
        text = ""
        if os.path.exists(events):
            with open(events) as f:
                text = f.read()
        return watcher.returncode, text

    def opening(self, preflights=1):
        steps = [{"write": "manifest.json", "json": MANIFEST}, {"write": "preflight.json", "json": PREFLIGHT}]
        for k in range(1, preflights):
            steps.append({"write": f"preflight.resume-{k}.json", "json": {**PREFLIGHT, "at": f"2026-10-14T0{k}:00:00.000Z"}})
        return steps

    def test_a_hold_is_left_to_the_harness_which_stops_itself(self):
        at = Clock()
        sent = reserve(at, 1)
        held = settle(at, 1, 1.118208)
        held["reason"] = mon.UNVERIFIED
        steps = self.opening() + [{"sleep": 0.5}, {"append": "requests.jsonl", "json": sent}, {"append": "requests.jsonl", "json": held}, {"sleep": 1.0}, {"append": "pacing.jsonl", "json": {"at": INV, "id": ID, "stopped": {"reason": "integrity", "message": "usage-missing"}}}, {"exit": 3}]
        harness = self.start(steps)
        code, events = self.watch(harness, 1)
        self.assertEqual(harness.returncode, 3, events)
        self.assertEqual(code, 0, events)
        self.assertIn("stopped itself", events)

    def test_a_preflight_count_that_is_not_this_windows_stops_the_window(self):
        second = f"2026-10-14T01:00:00.000Z~1111"
        steps = self.opening(preflights=2) + [{"append": "requests.jsonl", "json": {"at": "2026-10-14T01:00:01.000Z", "invocation": second, "request": f"{second}#1", "usd": 0.1}}, {"sleep": 6}, {"exit": 0}]
        harness = self.start(steps)
        code, events = self.watch(harness, 1)
        self.assertEqual(code, 10, events)
        self.assertIn("not this window", events)

    def test_a_preflight_that_never_comes_stops_the_window(self):
        steps = self.opening(preflights=2) + [{"sleep": 6}, {"exit": 0}]
        harness = self.start(steps)
        code, events = self.watch(harness, 3, preflightWaitSeconds=1)
        self.assertEqual(code, 10, events)
        self.assertIn("preflight", events)

    def test_the_closing_count_holds_every_request_the_window_wrote(self):
        # A stop on the first request's settlement, with a second request already written: the monitor still reads
        # it, so the count it closes on is the ledger's.
        at = Clock()
        lines = [reserve(at, 1), settle(at, 1, model="claude-haiku-4-5"), reserve(at, 2), settle(at, 2)]
        steps = self.opening() + [{"sleep": 0.3}] + [{"append": "requests.jsonl", "json": x} for x in lines] + [{"sleep": 6}, {"exit": 0}]
        harness = self.start(steps)
        code, events = self.watch(harness, 1)
        self.assertEqual(code, 10, events)
        self.assertIn("STOP (model)", events)
        self.assertIn("harness stopped by the monitor: 0 cells, 2 requests sent", events)

    def test_its_own_process_group_is_refused(self):
        code, events = self.watch(None, 1, timeout=10, pgid=os.getpgrp())
        self.assertEqual(code, 2, events)

    def test_a_process_group_that_is_not_running_is_refused(self):
        # A launch from a shell with job control can hand the monitor a group that is already gone: it must not take
        # that for a harness that exited, and leave the real one unwatched.
        gone = subprocess.Popen([sys.executable, "-I", "-c", "pass"], start_new_session=True)
        gone.wait()
        code, events = self.watch(None, 1, timeout=10, pgid=gone.pid)
        self.assertEqual(code, 2, events)
        self.assertIn("no process group", events)


def available():
    return os.path.exists(TSX) and os.path.exists(CORPUS_V2)


@unittest.skipUnless(available(), "needs a dspack-studio checkout with its block-bench tsx")
class Live(unittest.TestCase):
    """The monitor watching a live synthetic harness: its own process group, real (scaled) sleeps."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="monitor-live-")
        self.run_dir = os.path.join(self.tmp, "run")
        self.build_file = os.path.join(self.tmp, "build.html")
        self.write_build("SyntheticBuildLive")
        self.k = 0
        self.logs = []

    def tearDown(self):
        for log in self.logs:
            log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_build(self, build):
        with open(self.build_file, "w") as f:
            f.write(f'<script>self.__next_f.push([1,"{{\\"b\\":\\"{build}\\"}}"])</script>')

    def invocation(self, max_requests, events=None, scale=0.0, wait=True):
        self.k += 1
        cfg = {"root": CHECKOUT, "dir": self.run_dir, "runId": "monitor-live", "promptIds": ["rt-01", "rt-02"], "resume": self.k > 1, "maxRequests": max_requests, "spacingMs": 12000,
               "baseUrl": "https://synthetic.example", "buildId": "SyntheticBuildLive", **({"maxTotalRequests": 400, "maxTotalUsd": 40} if self.k == 1 else {}), **({"events": events} if events else {}), **({"sleepScale": scale} if scale else {})}
        path = os.path.join(self.tmp, f"invocation-{self.k}.json")
        with open(path, "w") as f:
            json.dump(cfg, f)
        log = open(os.path.join(self.tmp, f"invocation-{self.k}.log"), "w")
        self.logs.append(log)
        proc = subprocess.Popen([TSX, os.path.join(TOOLING, "synth", "invocation.mts"), path], stdout=log, stderr=log, cwd=os.path.join(CHECKOUT, "packages/block-bench"), start_new_session=True)
        if wait:
            proc.wait(timeout=300)
        return proc

    def monitor(self, proc, **over):
        with open(os.path.join(self.run_dir, "manifest.json")) as f:
            manifest = json.load(f)
        cfg = config(build="SyntheticBuildLive", code=manifest["code"]["sha256"], buildCheckSeconds=0.2, **over)
        path = os.path.join(self.tmp, "monitor.json")
        with open(path, "w") as f:
            json.dump(cfg, f)
        events = os.path.join(self.tmp, f"events-{self.k}.log")
        watcher = subprocess.Popen([sys.executable, "-I", os.path.join(TOOLING, "monitor_run.py"), "--run", self.run_dir, "--pgid", str(proc.pid), "--preflights", str(self.k), "--config", path, "--corpus", CORPUS_V2, "--events", events, "--poll", "0.05", "--build-url", f"file://{self.build_file}", "--hand-back-after", "240"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Reap the harness as soon as it exits, as init does for a launched window: a zombie would still be its group.
        while watcher.poll() is None:
            proc.poll()
            time.sleep(0.02)
        proc.wait(timeout=60)
        with open(events) as f:
            return watcher.returncode, f.read()

    def ledger_of(self, k):
        lines = jsonl(os.path.join(self.run_dir, "requests.jsonl"))
        with open(os.path.join(self.run_dir, "preflight.json" if k == 1 else f"preflight.resume-{k - 1}.json")) as f:
            at = json.load(f)["at"]
        return [x for x in lines if x["invocation"].startswith(f"{at}~")]

    def verify(self, *extra):
        """verify_run.py on the run so far, with each monitored window's events log."""
        out = os.path.join(self.tmp, "verify.json")
        events = [x for k in range(1, self.k + 1) for x in ["--monitor-events", os.path.join(self.tmp, f"events-{k}.log")] if os.path.exists(os.path.join(self.tmp, f"events-{k}.log"))]
        subprocess.run([sys.executable, "-I", os.path.join(TOOLING, "verify_run.py"), "--run", self.run_dir, "--corpus", CORPUS_V2, "--out", out, "--partial-history", "--quick", *events, *extra], capture_output=True, text=True, timeout=300)
        with open(out) as f:
            return json.load(f)

    def nothing_in_flight(self, k):
        mine = self.ledger_of(k)
        reserved = [x["request"] for x in mine if "adjust" not in x]
        finals = {x["request"] for x in mine if "adjust" in x}
        self.assertTrue(reserved and set(reserved) <= finals, f"a request was left in flight: {sorted(set(reserved) - finals)}")

    def test_an_exhausted_schedule_stops_the_window_with_nothing_in_flight(self):
        self.invocation(30)
        harness = self.invocation(300, events={str(n): "busy" for n in range(3, 8)}, scale=0.02, wait=False)
        code, events = self.monitor(harness)
        self.assertEqual(code, 10, events)
        self.assertIn("STOP (refusals)", events)
        self.assertIn("refused 5 times in a row", events)
        self.nothing_in_flight(2)
        result = self.verify()
        self.assertEqual(result["findings"], [])
        self.assertEqual([e["ended"] for e in result["invocations"]], ["cap", "killed"])
        self.assertEqual([(e["window"], e["requestsSeen"]) for e in result["monitorEvents"]], [(2, len(self.ledger_of(2)) - sum(1 for x in self.ledger_of(2) if "adjust" in x))])

    def test_repeated_refusals_stop_the_window_during_a_backoff(self):
        self.invocation(30)
        harness = self.invocation(300, events={str(n): "busy" for n in range(2, 17, 2)}, scale=0.02, wait=False)
        code, events = self.monitor(harness)
        self.assertEqual(code, 10, events)
        self.assertIn("8 refusals released", events)
        self.nothing_in_flight(2)
        self.assertEqual(self.verify()["findings"], [])

    def test_a_refusal_answered_on_its_retry_lets_the_window_finish(self):
        self.invocation(30)
        harness = self.invocation(300, events={"2": "busy"}, scale=0.01, wait=False)
        code, events = self.monitor(harness)
        self.assertEqual(code, 0, events)
        self.assertNotIn("STOP", events)
        self.assertIn("released at no cost", events)
        self.assertIn("the harness exited", events)
        result = self.verify("--complete")
        self.assertEqual(result["findings"], [])

    def test_a_build_change_stops_the_window_and_a_resume_completes_the_run(self):
        self.invocation(30)
        harness = self.invocation(300, scale=0.05, wait=False)
        runs = os.path.join(self.run_dir, "runs.jsonl")
        start = count_lines(runs)
        deadline = time.time() + 60
        while count_lines(runs) < start + 3 and time.time() < deadline:
            time.sleep(0.05)
        self.write_build("AnotherBuild")
        code, events = self.monitor(harness)
        self.assertEqual(code, 10, events)
        self.assertIn("STOP (build)", events)
        self.write_build("SyntheticBuildLive")
        self.invocation(300)
        result = self.verify("--complete")
        self.assertEqual(result["findings"], [])
        self.assertEqual([e["ended"] for e in result["invocations"]], ["cap", "killed", "complete"])
        self.assertTrue(any("the live build changed during invocation 2 to ['AnotherBuild']" in n for n in result["notes"]), result["notes"])


if __name__ == "__main__":
    unittest.main()
