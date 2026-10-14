"""A stand-in for the harness process, for the monitor's tests: it writes a run directory on a fixed timeline, then
exits with a given code. It never calls anything.

    python3 -I fake_harness.py <plan.json>

The plan is {"dir": ..., "steps": [...]}, each step one of:
    {"write": "<file>", "json": {...}}       write a whole file (a manifest, a preflight)
    {"append": "<file>", "json": {...}}      append one JSON line (the ledger, runs.jsonl, pacing.jsonl)
    {"sleep": <seconds>}
    {"exit": <code>}
"""
import json
import os
import sys
import time

with open(sys.argv[1]) as f:
    plan = json.load(f)
d = plan["dir"]
os.makedirs(d, exist_ok=True)
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
        sys.exit(step["exit"])
