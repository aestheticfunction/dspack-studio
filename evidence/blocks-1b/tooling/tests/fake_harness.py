"""A stand-in for the harness process, for the monitor's tests: it holds the run's lock as the harness does (its pid and
host, written before anything else), writes a run directory on a fixed timeline, then exits with a given code. It
never calls anything.

    python3 -I fake_harness.py <plan.json>

The plan is {"dir": ..., "steps": [...], "lockAt": <optional ISO time the lock claims it was taken at>}, each step one of:
    {"write": "<file>", "json": {...}}       write a whole file (a manifest, a preflight)
    {"append": "<file>", "json": {...}}      append one JSON line (the ledger, runs.jsonl, pacing.jsonl)
    {"sleep": <seconds>}
    {"exit": <code>}                         release the lock and exit
"""
import json
import os
import socket
import sys
import time
import uuid

with open(sys.argv[1]) as f:
    plan = json.load(f)
d = plan["dir"]
os.makedirs(d, exist_ok=True)
lock = os.path.join(d, "run.lock")
with open(lock, "w") as f:
    f.write(json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "nonce": str(uuid.uuid4()), "at": plan.get("lockAt") or time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}) + "\n")
for step in plan["steps"]:
    if "write" in step:
        with open(os.path.join(d, step["write"]), "w") as f:
            json.dump(step["json"], f)
    elif "append" in step:
        with open(os.path.join(d, step["append"]), "a") as f:
            f.write(json.dumps(step["json"], separators=(",", ":")) + "\n")
    elif "sleep" in step:
        time.sleep(step["sleep"])
    elif "exit" in step:
        os.remove(lock)
        sys.exit(step["exit"])
