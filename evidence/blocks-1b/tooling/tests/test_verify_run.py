"""verify_run.py against real and synthetic runs, and against each way a run's evidence can be wrong.

The synthetic runs (fixtures/, from synth/generate.mts) went through the real harness and the real Worker with a
scripted model: 5 and 12 invocations with clean resumes, cap stops, zero-cost busy refusals, a held request, a cell
abandoned and repeated from its beginning, a request left open by a killed invocation, an exhausted backoff schedule
and a re-run. Each must verify with no finding. Each mutation below breaks one thing a run's evidence must hold, and
the verifier must name it.

    python3 -I evidence/blocks-1b/tooling/tests/test_verify_run.py -v
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLING = os.path.dirname(HERE)
VERIFY = os.path.join(TOOLING, "verify_run.py")
FIXTURES = os.path.join(TOOLING, "fixtures")
CHECKOUT = os.environ.get("DSPACK_STUDIO", "/home/user/dspack-studio")
CORPUS_V2 = os.path.join(CHECKOUT, "packages/block-bench/live/corpora/blocks.v2.json")
CORPUS_V1 = os.path.join(CHECKOUT, "packages/block-bench/live/corpora/blocks.json")
ASTRYX = os.path.join(os.path.dirname(TOOLING), "1b-stage3-astryx-2026-10-12")
ASTRYX_WINDOW_1 = "17328e3"  # the evidence commit that preserved the run as window 1 left it
SHADCN_CONFIG = os.path.join(TOOLING, "monitor-shadcn.json")
with open(SHADCN_CONFIG) as f:
    SHADCN_LIMITS = {k: v for k, v in json.load(f).items() if k not in ("note", "expect")}


def lines(path):
    with open(path, encoding="utf-8") as f:
        return [line for line in f.read().split("\n") if line.strip()]


def write_lines(path, items):
    with open(path, "w", encoding="utf-8") as f:
        f.write("".join(f"{line}\n" for line in items))


class Run:
    """A writable copy of a fixture: its final run directory and its window copies, oldest first."""

    def __init__(self, name):
        self.tmp = tempfile.mkdtemp(prefix=f"verify-{name}-")
        self.root = os.path.join(self.tmp, name)
        shutil.copytree(os.path.join(FIXTURES, name), self.root)
        self.run = os.path.join(self.root, "run")
        snaps = os.path.join(self.root, "snapshots")
        self.snapshots = [os.path.join(snaps, d) for d in sorted(os.listdir(snaps), key=lambda d: int(d.split("-")[1]))]
        with open(os.path.join(self.root, "scenario.json")) as f:
            self.scenario = json.load(f)

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def dirs_after(self, k):
        """Every copy that holds invocation k's evidence: the window copies from k on, and the final directory."""
        return [d for i, d in enumerate(self.snapshots, 1) if i >= k] + [self.run]

    def ledger(self, d=None):
        return [json.loads(line) for line in lines(os.path.join(d or self.run, "requests.jsonl"))]

    def invocation_ids(self):
        """Each invocation's id, in order: every invocation here sent a request, killed ones included."""
        ids = []
        for x in self.ledger():
            if "adjust" not in x and x["invocation"] not in ids:
                ids.append(x["invocation"])
        return ids

    def verify(self, *extra, snapshots=None, corpus=CORPUS_V2):
        out = os.path.join(self.tmp, "out.json")
        args = [sys.executable, "-I", VERIFY, "--run", self.run, "--corpus", corpus, "--out", out, "--invocations", os.path.join(self.root, "invocations.txt"), "--expect-build", self.scenario["buildId"], "--complete", "--quick"]
        for s in self.snapshots if snapshots is None else snapshots:
            args += ["--snapshot", s]
        proc = subprocess.run(args + list(extra), capture_output=True, text=True)
        with open(out) as f:
            result = json.load(f)
        return proc.returncode, result


class FixturesVerify(unittest.TestCase):
    def test_five_invocations(self):
        run = Run("synthetic-5")
        try:
            code, r = run.verify()
            self.assertEqual(r["findings"], [])
            self.assertEqual(code, 0)
            self.assertEqual([e["ended"] for e in r["invocations"]], ["cap", "integrity", "cap", "killed", "complete"])
            w = r["windows"]
            # A busy refusal released and retried after one backoff; two in a row, then the Worker's own limiter.
            self.assertEqual(w["1"]["backoffMs"], [30000])
            self.assertEqual(w["3"]["backoffMs"], [30000, 60000, 30000])
            # The held request: the abandoned cell's plan settled, its generation held at its worst case.
            self.assertEqual([o["reason"] for o in r["orphans"]], ["settled at the reported usage", "usage not verified"])
            # Repeated from its beginning: the next invocation's first cell is the cell the held one abandoned.
            self.assertEqual(r["invocations"][1]["nextCell"], "astryx|capped|rt-01|fresh")
            self.assertEqual(w["3"]["firstCell"], "capped|rt-01|fresh")
            # Five refusals in a row exhaust the schedule; the monitor's kill leaves no pacing entry; the re-run moves
            # the failed cell and its four skipped refinements aside and runs them again.
            self.assertEqual(w["4"]["exhaustedSchedules"], ["block|rt-02|fresh"])
            self.assertEqual(r["invocations"][4]["moved"], 5)
            self.assertEqual(r["ledger"]["reasons"]["refused before any provider call"], 9)
        finally:
            run.close()

    def test_twelve_invocations(self):
        run = Run("synthetic-12")
        try:
            code, r = run.verify()
            self.assertEqual(r["findings"], [])
            self.assertEqual(code, 0)
            self.assertEqual(len(r["invocations"]), 12)
            self.assertEqual([e["ended"] for e in r["invocations"]], ["cap", "cap", "cap", "integrity", "cap", "killed", "cap", "killed", "cap", "cap", "cap", "complete"])
            w = r["windows"]
            self.assertEqual(w["5"]["backoffMs"], [30000, 60000, 120000])
            self.assertEqual(w["10"]["backoffMs"], [30000, 60000, 120000, 240000])
            self.assertEqual(w["8"]["exhaustedSchedules"], ["block-positional|rt-02|fresh"])
            self.assertEqual(w["7"]["workerParseRetries"], 1)
            # The request the killed sixth invocation left open, raised by the seventh to the most a request can cost.
            self.assertEqual(r["ledger"]["leftOpen"], [f"{run.invocation_ids()[5]}#3"])
            self.assertEqual(r["invocations"][5]["nextCell"], "astryx|production|rt-01|refine-remove")
            self.assertEqual(w["7"]["firstCell"], "production|rt-01|refine-remove")
        finally:
            run.close()

    @unittest.skipUnless(os.path.isdir(ASTRYX), "the Astryx run is not beside the tooling")
    def test_astryx_two_invocations(self):
        tmp = tempfile.mkdtemp(prefix="verify-astryx-")
        try:
            top = subprocess.run(["git", "-C", TOOLING, "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
            archive = subprocess.run(["git", "-C", top, "archive", ASTRYX_WINDOW_1, "evidence/blocks-1b/1b-stage3-astryx-2026-10-12"], capture_output=True)
            if archive.returncode != 0:
                self.skipTest("the window-1 commit is not in this checkout")
            subprocess.run(["tar", "-x", "-C", tmp], input=archive.stdout, check=True)
            window1 = os.path.join(tmp, "evidence/blocks-1b/1b-stage3-astryx-2026-10-12")
            out = os.path.join(tmp, "out.json")
            proc = subprocess.run([sys.executable, "-I", VERIFY, "--run", ASTRYX, "--snapshot", window1, "--corpus", CORPUS_V2, "--out", out, "--invocations", os.path.join(os.path.dirname(TOOLING), "1b-stage3-astryx-2026-10-12.invocations.txt"), "--expect-build", "txDlHURTKv_S6yicLso97", "--expect-code", "fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d", "--parity-reading", "no-arrays", "--complete", "--quick"], capture_output=True, text=True)
            with open(out) as f:
                r = json.load(f)
            self.assertEqual(r["findings"], [])
            self.assertEqual(proc.returncode, 0)
            self.assertEqual(r["references"]["astryx"]["decision"]["verdict"], "pass")
            self.assertEqual(r["ledger"]["committedUsd"], 7.6298649)
            self.assertEqual([e["ended"] for e in r["invocations"]], ["integrity", "complete"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Mutations(unittest.TestCase):
    """Each breaks one thing on a copy of the twelve-invocation run; the verifier must fail and say what."""

    def setUp(self):
        self.r = Run("synthetic-12")

    def tearDown(self):
        self.r.close()

    def fails_with(self, *needles, **kw):
        code, result = self.r.verify(*kw.pop("extra", ()), **kw)
        self.assertEqual(code, 1, result["findings"])
        for needle in needles:
            self.assertTrue(any(needle in f for f in result["findings"]), f"no finding names {needle!r}: {result['findings']}")
        return result

    def rewrite(self, name, change, dirs):
        """Applies change(list of parsed lines) -> list of parsed lines to `name` in each directory."""
        for d in dirs:
            path = os.path.join(d, name)
            items = change([json.loads(x) for x in lines(path)])
            write_lines(path, [json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in items])

    # Duplicate completed cells.
    def test_duplicate_completed_cell(self):
        path = os.path.join(self.r.run, "runs.jsonl")
        items = lines(path)
        write_lines(path, items + [items[-1]])
        self.fails_with("completed 2 times in runs.jsonl")

    def test_duplicate_cell_inside_the_history(self):
        path = os.path.join(self.r.run, "runs.jsonl")
        items = lines(path)
        write_lines(path, items[:2] + [items[1]] + items[2:])
        self.fails_with("completed 2 times in runs.jsonl", "runs.jsonl does not keep the earlier records")

    # Missing requests.
    def test_missing_request_in_the_last_window(self):
        ledger = self.r.ledger()
        last = self.r.invocation_ids()[-1]
        gone = f"{last}#10"
        self.rewrite("requests.jsonl", lambda items: [x for x in items if x.get("request") != gone], [self.r.run])
        self.fails_with("request numbers are not consecutive", "its pacing says 31 sent, the ledger holds 30")
        self.assertTrue(any(x.get("request") == gone for x in ledger))

    def test_missing_request_inside_the_history(self):
        third = self.r.invocation_ids()[2]
        self.rewrite("requests.jsonl", lambda items: [x for x in items if x.get("request") != f"{third}#2"], [self.r.run])
        self.fails_with("requests.jsonl is not an extension of the earlier copy", "request numbers are not consecutive")

    # Mixed builds, models and corpora.
    def test_a_resume_against_another_build(self):
        def other_build(d):
            path = os.path.join(d, "preflight.resume-5.json")
            with open(path) as f:
                p = json.load(f)
            p["buildId"] = "AnotherBuild0001"
            with open(path, "w") as f:
                json.dump(p, f, indent=2)

        for d in self.r.dirs_after(6):
            other_build(d)
        self.fails_with("invocation 6: its preflight found https://synthetic.example build AnotherBuild0001")

    def test_the_run_against_an_unexpected_build(self):
        self.fails_with("the run's build id is SyntheticBuild0012, expected AnotherBuild", extra=("--expect-build", "AnotherBuild"))

    def test_a_settlement_on_another_model(self):
        last = self.r.invocation_ids()[-1]

        def change(items):
            for x in items:
                if x.get("request") == f"{last}#3" and "adjust" in x:
                    x["servedModel"] = "claude-haiku-4-5"
            return items

        self.rewrite("requests.jsonl", change, [self.r.run])
        self.fails_with("settled on 'claude-haiku-4-5'", "the call's model differs from the ledger's servedModel")

    def test_a_call_on_another_model(self):
        def change(items):
            items[-1]["calls"][0]["model"] = "claude-sonnet-4-5"
            return items

        self.rewrite("runs.jsonl", change, [self.r.run])
        self.fails_with("a provider call on 'claude-sonnet-4-5'")

    def test_another_corpus(self):
        self.fails_with("corpus: the file given is blocks-1b v1", corpus=CORPUS_V1)

    def test_a_record_relabelled(self):
        def change(items):
            items[-1]["expected"]["intent"] = "data-collection"
            return items

        self.rewrite("runs.jsonl", change, [self.r.run])
        self.fails_with("the record's expected labels differ from the frozen corpus")

    # Inconsistent settlements.
    def test_a_settlement_whose_arithmetic_is_off(self):
        last = self.r.invocation_ids()[-1]

        def change(items):
            for x in items:
                if x.get("request") == f"{last}#4" and "adjust" in x:
                    x["final"] = round(x["final"] + 0.000001, 9)
            return items

        self.rewrite("requests.jsonl", change, [self.r.run])
        self.fails_with("+ adjust", "!= final")

    def test_a_settlement_unlike_what_its_cell_reported(self):
        last = self.r.invocation_ids()[-1]

        def change(items):
            for x in items:
                if x.get("request") == f"{last}#4" and "adjust" in x:
                    x["final"] = round(x["final"] + 0.001, 9)
                    x["adjust"] = round(x["adjust"] + 0.001, 9)
            return items

        self.rewrite("requests.jsonl", change, [self.r.run])
        self.fails_with("the ledger settled")

    def test_a_release_that_kept_money(self):
        first = self.r.invocation_ids()[0]

        def change(items):
            for x in items:
                if x.get("request") == f"{first}#2" and x.get("reason") == "refused before any provider call":
                    x["final"] = 0.001
                    x["adjust"] = round(x["adjust"] + 0.001, 9)
            return items

        for d in self.r.dirs_after(1):
            self.rewrite("requests.jsonl", change, [d])
        self.fails_with("released at 0.001, not zero")

    def test_a_request_settled_twice(self):
        path = os.path.join(self.r.run, "requests.jsonl")
        items = lines(path)
        write_lines(path, items + [items[-1]])
        self.fails_with("finalized twice")

    def test_a_refusal_settled_as_spent(self):
        first = self.r.invocation_ids()[0]

        def change(items):
            for x in items:
                if x.get("request") == f"{first}#2" and "adjust" in x:
                    x["reason"] = "settled at the reported usage"
            return items

        for d in self.r.dirs_after(1):
            self.rewrite("requests.jsonl", change, [d])
        self.fails_with("a refused call in block|rt-01|fresh, but the ledger says 'settled at the reported usage'")

    # Altered run history.
    def test_an_earlier_record_altered(self):
        def change(items):
            items[0]["tokens"]["input"] += 1
            return items

        self.rewrite("runs.jsonl", change, [self.r.run])
        self.fails_with("runs.jsonl does not keep the earlier records", "tokens")

    def test_an_earlier_pacing_entry_removed(self):
        self.rewrite("pacing.jsonl", lambda items: items[:2] + items[3:], [self.r.run])
        self.fails_with("pacing.jsonl is not an extension of the earlier copy")

    def test_the_rerun_evidence_removed(self):
        os.remove(os.path.join(self.r.run, "runs.superseded.jsonl"))
        self.fails_with("runs.superseded.jsonl is not an extension of the earlier copy")

    def test_a_cell_logged_out_of_order(self):
        path = os.path.join(self.r.run, "runs.jsonl")
        items = lines(path)
        write_lines(path, items[:-2] + [items[-1], items[-2]])
        self.fails_with("where the next cell left to do was")

    def test_a_cell_missing(self):
        path = os.path.join(self.r.run, "runs.jsonl")
        write_lines(path, lines(path)[:-1])
        self.fails_with("planned cells have no record")

    def test_requests_no_cell_made_in_a_window_that_stopped_cleanly(self):
        # The second invocation (a cap stop) loses its last record everywhere it was kept.
        def change(items):
            gone = [i for i, x in enumerate(items) if (x["arm"], x["prompt"], x["condition"]) == ("block-positional", "rt-01", "refine-content")]
            return [x for i, x in enumerate(items) if i not in gone]

        for d in self.r.dirs_after(2):
            self.rewrite("runs.jsonl", change, [d])
        self.fails_with("invocation 2 ended cap, yet")

    def test_backoffs_unlike_the_refusals(self):
        tenth = self.r.invocation_ids()[9]

        def change(items):
            for x in items:
                if x["id"] == tenth:
                    waits = [w for w in x["telemetry"]["pacing"]["waits"] if w["reason"] != "spacing"]
                    waits[0]["ms"] = 60000
            return items

        for d in self.r.dirs_after(10):
            self.rewrite("pacing.jsonl", change, [d])
        self.fails_with("invocation 10: backoffs [60000, 60000, 120000, 240000] ms, but its refusals call for [30000, 60000, 120000, 240000]")

    def test_an_integrity_stop_dressed_as_a_kill(self):
        fourth = self.r.invocation_ids()[3]
        for d in self.r.dirs_after(4):
            self.rewrite("pacing.jsonl", lambda items: [x for x in items if x["id"] != fourth], [d])
        self.fails_with("invocation 4: the operator recorded")

    def test_the_summary_altered(self):
        path = os.path.join(self.r.run, "summary.json")
        with open(path) as f:
            s = json.load(f)
        s["summary"]["decisions"][0]["verdict"] = "pass"
        with open(path, "w") as f:
            json.dump(s, f)
        self.fails_with("decision.verdict: mine 'insufficient' != summary 'pass'")

    def test_a_window_copy_missing(self):
        snaps = [s for s in self.r.snapshots if not s.endswith("after-6")]
        self.fails_with("no window copy after invocation(s) [6]", snapshots=snaps)
        code, result = self.r.verify("--partial-history", snapshots=snaps)
        self.assertEqual(result["findings"], [])
        self.assertEqual(code, 0)



def verify_dir(run, *extra, snapshots=(), corpus=CORPUS_V2, invocations=None):
    """verify_run.py on any run directory (a final one, or a window's copy read as the run so far)."""
    tmp = tempfile.mkdtemp(prefix="verify-dir-")
    try:
        out = os.path.join(tmp, "out.json")
        args = [sys.executable, "-I", VERIFY, "--run", run, "--corpus", corpus, "--out", out, "--quick"]
        for snap in snapshots:
            args += ["--snapshot", snap]
        if invocations:
            args += ["--invocations", invocations]
        proc = subprocess.run(args + list(extra), capture_output=True, text=True)
        if not os.path.exists(out):
            raise AssertionError(f"no result written; stderr: {proc.stderr[-2000:]}")
        with open(out) as f:
            return proc.returncode, json.load(f)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class EdgeStates(unittest.TestCase):
    """Legitimate states a run passes through, which must verify: the review of 8bf756d found each one flagged."""

    def test_a_killed_first_window_a_refused_resume_and_a_lost_lock(self):
        root = os.path.join(FIXTURES, "synthetic-edge")
        snaps = [os.path.join(root, "snapshots", d) for d in ("after-1", "after-2")]
        code, r = verify_dir(os.path.join(root, "run"), "--complete", "--expect-build", "SyntheticBuildEdge", snapshots=snaps, invocations=os.path.join(root, "invocations.txt"))
        self.assertEqual(r["findings"], [])
        self.assertEqual(code, 0)
        self.assertEqual([e["ended"] for e in r["invocations"]], ["killed", "error", "complete"])
        self.assertTrue(any("refused" in n for n in r["notes"]), r["notes"])

    def test_the_killed_first_window_verifies_as_the_run_so_far(self):
        root = os.path.join(FIXTURES, "synthetic-edge")
        code, r = verify_dir(os.path.join(root, "snapshots", "after-1"))
        self.assertEqual(r["findings"], [])
        self.assertTrue(any("summary.json" in n for n in r["notes"]), r["notes"])

    def test_the_lost_lock_window_verifies_as_the_run_so_far(self):
        root = os.path.join(FIXTURES, "synthetic-edge")
        code, r = verify_dir(os.path.join(root, "snapshots", "after-2"), snapshots=[os.path.join(root, "snapshots", "after-1")])
        self.assertEqual(r["findings"], [])

    def test_every_window_copy_verifies_as_the_run_so_far(self):
        for name in ("synthetic-5", "synthetic-12"):
            root = os.path.join(FIXTURES, name)
            snaps = sorted((os.path.join(root, "snapshots", d) for d in os.listdir(os.path.join(root, "snapshots"))), key=lambda d: int(d.rsplit("-", 1)[1]))
            for i, snap in enumerate(snaps):
                with self.subTest(fixture=name, window=i + 1):
                    code, r = verify_dir(snap, snapshots=snaps[:i])
                    self.assertEqual(r["findings"], [])

    def test_partial_history_across_a_rerun(self):
        for name, missing in (("synthetic-12", "after-8"), ("synthetic-5", "after-4")):
            root = os.path.join(FIXTURES, name)
            snaps = sorted((os.path.join(root, "snapshots", d) for d in os.listdir(os.path.join(root, "snapshots")) if d != missing), key=lambda d: int(d.rsplit("-", 1)[1]))
            with self.subTest(fixture=name, missing=missing):
                code, r = verify_dir(os.path.join(root, "run"), "--complete", "--partial-history", snapshots=snaps, invocations=os.path.join(root, "invocations.txt"))
                self.assertEqual(r["findings"], [])

    def test_a_window_killed_before_it_raised(self):
        # The second invocation is killed as soon as its preflight is on the disk, before it raises the request the
        # first left in flight: the third, the first process after the first to write to the ledger, raises it.
        root = os.path.join(FIXTURES, "synthetic-dead")
        snaps = [os.path.join(root, "snapshots", d) for d in ("after-1", "after-2")]
        code, r = verify_dir(os.path.join(root, "run"), "--complete", "--expect-build", "SyntheticBuildDead", snapshots=snaps, invocations=os.path.join(root, "invocations.txt"))
        self.assertEqual(r["findings"], [])
        self.assertEqual([e["ended"] for e in r["invocations"]], ["killed", "killed", "complete"])
        for i, snap in enumerate(snaps):
            with self.subTest(window=i + 1):
                code, r = verify_dir(snap, snapshots=snaps[:i])
                self.assertEqual(r["findings"], [])

    def test_an_integrity_stop_killed_in_its_shutdown(self):
        run = Run("synthetic-5")
        try:
            path = os.path.join(run.root, "invocations.txt")
            with open(path) as f:
                text = f.read()
            with open(path, "w") as f:
                f.write(text.replace(" exit 3\n", " exit 143\n", 1))
            code, r = run.verify()
            self.assertEqual(r["findings"], [])
            self.assertTrue(any("shutdown" in n for n in r["notes"]), r["notes"])
        finally:
            run.close()

    def test_a_summary_the_last_window_did_not_write(self):
        run = Run("synthetic-5")
        try:
            shutil.copy(os.path.join(run.snapshots[2], "summary.json"), os.path.join(run.run, "summary.json"))
            code, r = run.verify()
            self.assertTrue(any("summary.json" in f for f in r["findings"]), r["findings"])
            code, r = run.verify("--partial-history")  # still --complete: a run's final summary must be its own
            self.assertTrue(any("summary.json" in f for f in r["findings"]))
        finally:
            run.close()


class MoreMutations(unittest.TestCase):
    """What the review of 8bf756d showed passing: each must now fail by name."""

    def setUp(self):
        self.r = Run("synthetic-12")

    def tearDown(self):
        self.r.close()

    def fails_with(self, *needles, run=None, **kw):
        code, result = (run or self.r).verify(*kw.pop("extra", ()), **kw)
        self.assertEqual(code, 1, result["findings"])
        for needle in needles:
            self.assertTrue(any(needle in f for f in result["findings"]), f"no finding names {needle!r}: {result['findings']}")
        return result

    def edit_summary(self, change):
        path = os.path.join(self.r.run, "summary.json")
        with open(path) as f:
            s = json.load(f)
        change(s)
        with open(path, "w") as f:
            json.dump(s, f)

    def test_a_held_settlement_below_the_harness_hold(self):
        run = Run("synthetic-5")
        try:
            second = run.invocation_ids()[1]

            def change(items):
                for x in items:
                    if x.get("request") == f"{second}#4" and x.get("reason") == "usage not verified":
                        x["final"] = 0.086742601
                        x["adjust"] = round(0.086742601 - [y for y in items if y.get("request") == f"{second}#4" and "usd" in y][0]["usd"], 9)
                return items

            for d in run.dirs_after(2):
                path = os.path.join(d, "requests.jsonl")
                items = change([json.loads(x) for x in lines(path)])
                write_lines(path, [json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in items])
            self.fails_with("below the most", run=run)
        finally:
            run.close()

    def test_a_stored_parity_unlike_its_surface(self):
        def change(items):
            last = items[-1]
            last["parity"] = {"score": 0.5, "satisfied": last["parity"]["satisfied"][:1], "missing": last["parity"]["satisfied"][1:] + last["parity"]["missing"]}
            return items

        path = os.path.join(self.r.run, "runs.jsonl")
        items = change([json.loads(x) for x in lines(path)])
        write_lines(path, [json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in items])
        self.fails_with("parity recomputed from its surface")

    def test_a_decision_for_a_reference_the_run_never_measured(self):
        self.edit_summary(lambda s: s["summary"]["decisions"].append({**s["summary"]["decisions"][0], "reference": "shadcn-v3", "verdict": "pass"}))
        self.fails_with("summary: decisions holds")

    def test_another_scoring(self):
        self.edit_summary(lambda s: s["summary"].__setitem__("scoring", "beside"))
        self.fails_with("summary scoring")

    def test_sensitivity_flags_flipped(self):
        def change(s):
            sens = s["summary"]["sensitivity"][0]
            sens["verdictHolds"] = not sens["verdictHolds"]
            sens["robust"] = not sens["robust"]
        self.edit_summary(change)
        self.fails_with("sensitivity")

    def test_a_report_with_another_verdict(self):
        path = os.path.join(self.r.run, "REPORT.md")
        with open(path) as f:
            text = f.read()
        self.assertIn("insufficient", text)
        with open(path, "w") as f:
            f.write(text.replace("insufficient", "pass"))
        self.fails_with("REPORT.md")

    def test_the_telemetry_altered(self):
        self.edit_summary(lambda s: s["telemetry"]["pacing"].__setitem__("sent", s["telemetry"]["pacing"]["sent"] + 1))
        self.fails_with("telemetry")

    def test_a_raise_deferred_past_the_next_invocation(self):
        # The open request the sixth window left is raised by the eighth instead of the seventh, which ran first.
        ids = self.r.invocation_ids()
        path = os.path.join(self.r.run, "requests.jsonl")
        items = [json.loads(x) for x in lines(path)]
        i = next(i for i, x in enumerate(items) if x.get("reason") == "a request whose reply was never read" and x["request"].startswith(ids[5]))
        raise_line = dict(items.pop(i), invocation=ids[7])
        j = next(j for j, x in enumerate(items) if x.get("invocation") == ids[7])
        items.insert(j, raise_line)
        write_lines(path, [json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in items])
        self.fails_with("raised")


def stamp(t):
    """An events-log time, as monitor_run.py writes one."""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def epoch(iso):
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


class MonitorEvents(unittest.TestCase):
    """--monitor-events: a window's events log against the run (a log written here as monitor_run.py writes one)."""

    def setUp(self):
        self.r = Run("synthetic-12")

    def tearDown(self):
        self.r.close()

    def events(self, k, seen=None, every=1.0, build=None, span=None, limits=None):
        ids = self.r.invocation_ids()
        mine = [x for x in self.r.ledger() if x["invocation"] == ids[k - 1]]
        opened = ids[k - 1].split("~")[0]
        t0 = epoch(opened)
        t1 = t0 + span if span else epoch(mine[-1]["at"]) + 1
        build = build or self.r.scenario["buildId"]
        lines = [f"{stamp(t0)} monitor up: window {k}, run {self.r.run}, harness process group 4242, waiting for preflight.resume-{k - 1}.json; limits {json.dumps(limits or {'buildCheckSeconds': 30, 'maxReleased': 8}, separators=(',', ':'))}",
                 f"{stamp(t0)} window opened {opened}: build {build}, code c0de, corpus blocks-1b v2, astryx"]
        t = t0
        while t <= t1:
            lines.append(f"{stamp(t)} build {build}")
            t += every
        sent = sum(1 for x in mine if "adjust" not in x)
        lines += [f"{stamp(t1)} STOP (integrity): a request in flight", f"{stamp(t1)} harness stopped by the monitor: 2 cells, {sent if seen is None else seen} requests sent, 2 settled, 0 released (0 s of backoff), 0 provider failures, outcomes {{}}"]
        path = os.path.join(self.r.tmp, f"events-{k}.log")
        write_lines(path, lines)
        return path

    def test_a_window_watched_whole_verifies(self):
        code, r = self.r.verify("--monitor-events", self.events(6))
        self.assertEqual(r["findings"], [])
        self.assertEqual(r["monitorEvents"][0]["requestsSeen"], 3)

    def test_a_trailing_request_dropped_everywhere_is_caught_by_what_the_monitor_saw(self):
        # The sixth window's open request, and the seventh's raise of it, taken out of every copy, the totals adjusted.
        events = self.events(6)
        ids = self.r.invocation_ids()
        gone = f"{ids[5]}#3"
        for d in self.r.dirs_after(6):
            path = os.path.join(d, "requests.jsonl")
            write_lines(path, [x for x in lines(path) if json.loads(x).get("request") != gone])
        path = os.path.join(self.r.run, "summary.json")
        with open(path) as f:
            s = json.load(f)
        s["requests"]["sent"] -= 1
        s["requests"]["usd"] = (round(s["requests"]["usd"] * 1e9) - 1118208000) / 1e9
        with open(path, "w") as f:
            json.dump(s, f)
        code, r = self.r.verify()
        self.assertEqual(r["findings"], [])  # nothing in the run's own files shows it
        code, r = self.r.verify("--monitor-events", events)
        self.assertEqual(code, 1)
        self.assertTrue(any("the monitor saw 3 requests from invocation 6, the ledger holds 2" in f for f in r["findings"]), r["findings"])

    def test_a_window_whose_build_went_unread_too_long(self):
        code, r = self.r.verify("--monitor-events", self.events(6, every=120.0, span=300))
        self.assertEqual(code, 1)
        self.assertTrue(any("without a live build reading" in f for f in r["findings"]), r["findings"])

    def test_a_window_on_another_build_fails(self):
        # The cells settled after the monitor last read the baseline's build may have been measured on another.
        code, r = self.r.verify("--monitor-events", self.events(6, build="AnotherBuild"))
        self.assertEqual(code, 1)
        self.assertTrue(any("the live build changed during invocation 6" in f for f in r["findings"]), r["findings"])

    def test_a_log_whose_limits_are_not_the_configs_fails(self):
        loose = dict(SHADCN_LIMITS, maxReleased=1000, buildCheckSeconds=600)
        logs = [x for k in range(1, 13) for x in ("--monitor-events", self.events(k, limits=loose if k == 6 else SHADCN_LIMITS))]
        code, r = self.r.verify("--monitor-config", SHADCN_CONFIG, *logs)
        self.assertEqual(code, 1)
        self.assertTrue(any("ran with limits other than" in f and "maxReleased" in f for f in r["findings"]), r["findings"])

    def test_every_window_needs_a_log_under_the_monitor_config(self):
        logs = [("--monitor-events", self.events(k, limits=SHADCN_LIMITS)) for k in range(1, 13)]
        code, r = self.r.verify("--monitor-config", SHADCN_CONFIG, *[x for pair in logs for x in pair])
        self.assertEqual(r["findings"], [])
        code, r = self.r.verify("--monitor-config", SHADCN_CONFIG, *[x for i, pair in enumerate(logs) if i != 2 for x in pair])
        self.assertEqual(code, 1)
        self.assertTrue(any("invocation 3 has no monitor events log" in f for f in r["findings"]), r["findings"])


if __name__ == "__main__":
    unittest.main()
