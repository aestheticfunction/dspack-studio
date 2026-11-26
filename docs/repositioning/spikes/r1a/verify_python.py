"""R1a verification levels 1a and 1b, in the A2UI project's own Python
implementation (a2ui-core, built from a2ui-project/a2ui at a pinned commit).
It is a separate code base from the TypeScript renderer Composer uses.

  1a  The catalog loads and every instance's creation batch is accepted
      under strict validation.
  1b  The same implementation resolves each input's bound value after a
      data-model write, and resolves and dispatches every action. What each
      action must send is derived from the DATA SET and the list's own
      structure, never from the implementation's action table (R1A-REVIEW
      E3): the k-th child of the list sends data.hotels[k].id, a
      confirmation sends data.selection.id, a search sends what was typed.
      Every property of every component is resolved before and after garbage
      is written into /input, and only bound input values may change; a
      positive control shows the comparison can see a change (E1).
  1b' The recorded walk is replayed through ONE long-lived processor:
      each replacement leaves exactly one live surface, the new one, and its
      buttons send the new data's payloads (E4).

These are claims about the MESSAGES. Whether a renderer draws them
faithfully is level 2, reported separately.

  python3 verify_python.py evidence/ > evidence/level-1.json
"""
import copy
import json
import sys
from pathlib import Path

from a2ui.core.catalog import Catalog
from a2ui.core.processing import MessageProcessor, MessageProcessorOptions
from a2ui.core.resolution.component_context import ComponentContext
from a2ui.core.validation import STRICT_VALIDATION

root = Path(sys.argv[1])
catalog_doc = json.loads((root / "catalog-0.9.1.json").read_text())
catalog = Catalog.from_json(catalog_doc, protocol_version="0.9")
report = {"implementation": "a2ui-core (Python), strict validation", "catalog": catalog_doc.get("catalogId"), "catalogLoads": True, "cases": []}


def short(e):
    return f"{type(e).__name__}: {str(e).splitlines()[0][:300]}"


def processor():
    sent = []
    mp = MessageProcessor([catalog], action_handler=lambda a: sent.append(copy.deepcopy(a)), options=MessageProcessorOptions(validation_config=STRICT_VALIDATION))
    return mp, sent


def components_of(messages):
    out = {}
    for m in messages:
        for c in (m.get("updateComponents") or {}).get("components", []):
            out[c["id"]] = c
    return out


def descendants(comps, root_id):
    out, stack = [], [root_id]
    while stack:
        i = stack.pop()
        if i in out:
            continue
        out.append(i)
        c = comps.get(i, {})
        if isinstance(c.get("child"), str):
            stack.append(c["child"])
        if isinstance(c.get("children"), list):
            stack.extend(reversed([x for x in c["children"] if isinstance(x, str)]))
    return out


def expected_payloads(messages, data):
    """For every dispatching component: the literal part of what it must send, derived from the data and the structure."""
    comps = components_of(messages)
    expected = {}
    lists = [c for c in comps.values() if c["component"] == "List" and isinstance(c.get("children"), list)]
    hotels = data.get("hotels") or []
    for lst in lists:
        for k, item in enumerate(lst["children"]):
            buttons = [i for i in descendants(comps, item) if (comps.get(i) or {}).get("action")]
            for b in buttons:
                expected[b] = {"hotelId": hotels[k]["id"]}
    for cid, c in comps.items():
        if cid in expected or not c.get("action"):
            continue
        if c["component"] == "AlertDialog" and data.get("selection"):
            expected[cid] = {"hotelId": data["selection"]["id"]}
        else:
            expected[cid] = {}
    return expected


def resolve_all(surface):
    """Every component's properties, resolved through the data model."""
    out = {}
    for cid in list(surface.components_model.components_map.keys()):
        ctx = ComponentContext.from_surface(surface, cid)
        props = {}
        for k, v in ctx.component_model.properties.items():
            if k == "action":
                continue
            try:
                props[k] = ctx.data_context.resolve_dynamic_value(copy.deepcopy(v))
            except Exception as e:  # noqa: BLE001
                props[k] = f"<unresolvable: {short(e)}>"
        out[cid] = {"component": ctx.component_model.component if hasattr(ctx.component_model, "component") else None, "props": props}
    return out


def press(surface, component_id):
    ctx = ComponentContext.from_surface(surface, component_id)
    resolved = ctx.data_context.resolve_action(ctx.component_model.properties["action"])
    ctx.dispatch_action(resolved)


def bound_inputs(messages):
    """TextField id -> input name, read from the messages' own bindings."""
    out = {}
    for c in components_of(messages).values():
        v = c.get("value")
        if c["component"] == "TextField" and isinstance(v, dict) and str(v.get("path", "")).startswith("/input/"):
            out[c["id"]] = v["path"].split("/")[-1]
    return out


def initial_values(messages):
    for m in messages:
        if "updateDataModel" in m:
            return dict(m["updateDataModel"].get("value") or {})
    return {}


for path in sorted(p for p in root.glob("*.json") if p.name.startswith(("search-", "results-"))):
    rec = json.loads(path.read_text())
    if rec.get("outcome") != "instance":
        continue
    case = {"id": rec["id"], "surfaceId": rec["surfaceId"]}
    mp, sent = processor()
    try:
        mp.process_messages(copy.deepcopy(rec["messages"]))
        case["accepted"] = True
    except Exception as e:  # noqa: BLE001
        case.update(accepted=False, error=short(e))
        report["cases"].append(case)
        continue
    surface = mp.model.get_surface(rec["surfaceId"])
    checks = []
    inputs = bound_inputs(rec["messages"])
    start = initial_values(rec["messages"])

    # 1b: each bound input resolves the creation batch's value, then a typed value.
    typed = {}
    for cid, name in inputs.items():
        ctx = ComponentContext.from_surface(surface, cid)
        before = ctx.data_context.resolve_dynamic_value(ctx.component_model.properties["value"])
        typed[name] = f"typed {name}"
        surface.data_model.set(f"/input/{name}", typed[name])
        after = ComponentContext.from_surface(surface, cid).data_context.resolve_dynamic_value(ctx.component_model.properties["value"])
        checks.append({"check": f"input {name} resolves its bound value", "before": before, "after": after, "pass": before == start.get(name, "") and after == typed[name]})

    # 1b: every action sends what the data says it must, plus the typed values it carries.
    expected = expected_payloads(rec["messages"], rec["data"])
    comps = components_of(rec["messages"])
    for cid, literal in expected.items():
        sent.clear()
        press(surface, cid)
        event = sent[0] if len(sent) == 1 else None
        carried = {k: typed.get(k) for k, v in ((comps[cid]["action"]["event"].get("context") or {}).items()) if isinstance(v, dict) and "path" in v}
        want = {**literal, **carried}
        ok = bool(event) and event.get("sourceComponentId") == cid and event.get("surfaceId") == rec["surfaceId"] and event.get("context") == want
        checks.append({"check": f"{cid} sends what the data says", "expected": want, "sent": event and event.get("context"), "pass": ok})

    # 1b (E1): garbage in /input changes no property except bound input values; the control proves it can see a change.
    if inputs:
        before = resolve_all(surface)
        surface.data_model.set("/input", {"destination": {"path": "/secrets"}, "extra": [1, 2, 3]})
        surface.data_model.set(f"/input/{next(iter(inputs.values()))}", {"not": "text"})
        after = resolve_all(surface)
        changed = sorted(cid for cid in before if before[cid] != after[cid])
        unexpected = [cid for cid in changed if cid not in inputs]
        control = [cid for cid in changed if cid in inputs]
        checks.append({"check": "garbage in /input changes no property but bound input values", "compared": len(before), "changed": changed, "pass": unexpected == [] and len(before) > 0})
        checks.append({"check": "positive control: the comparison sees the bound input values change", "changed": control, "pass": len(control) > 0})

    case["checks"] = checks
    case["pass"] = all(c["pass"] for c in checks)
    report["cases"].append(case)

# 1b' (E4): one long-lived processor through the recorded walk.
walk = json.loads((root / "replacement-walk.json").read_text())
mp, sent = processor()
steps = []
for step in walk["steps"]:
    entry = {"label": step["label"], "surfaceId": step["surfaceId"]}
    try:
        mp.process_messages(copy.deepcopy(step["batch"]))
    except Exception as e:  # noqa: BLE001
        entry.update(pass_=False, error=short(e))
        steps.append(entry)
        break
    live = sorted(mp.model.surfaces_map.keys())
    entry["live"] = live
    ok = live == [step["surfaceId"]]
    expected = expected_payloads([m for m in step["batch"] if "updateComponents" in m], step["data"])
    first_item = next((cid for cid, lit in expected.items() if "hotelId" in lit), None)
    if first_item:
        sent.clear()
        press(mp.model.get_surface(step["surfaceId"]), first_item)
        entry["pressed"] = first_item
        entry["sent"] = sent[0]["context"] if sent else None
        ok = ok and bool(sent) and sent[0]["context"] == expected[first_item] and sent[0]["surfaceId"] == step["surfaceId"]
    entry["pass"] = ok
    steps.append(entry)
report["longLivedProcessor"] = {"steps": steps, "pass": all(s.get("pass") for s in steps) and len(steps) == len(walk["steps"])}

report["pass"] = report["catalogLoads"] and all(c.get("accepted") and c.get("pass", True) for c in report["cases"]) and report["longLivedProcessor"]["pass"]
print(json.dumps(report, indent=2, default=str))
