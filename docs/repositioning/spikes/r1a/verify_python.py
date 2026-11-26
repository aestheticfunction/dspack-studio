"""R1a verification levels 1a and 1b, in the A2UI project's own Python
implementation (a2ui-core, built from a2ui-project/a2ui at a pinned commit).
It is a separate code base from the TypeScript renderer Composer uses.

  1a  The catalog loads and every instance's creation batch is accepted
      under strict validation.
  1b  The same implementation resolves each input's bound value after the
      person types (a data-model write), resolves each button's action and
      dispatches it: the k-th repeated button sends item k's payload, the
      search sends the typed values. Garbage written into the input paths
      changes no governed property.

These are claims about the MESSAGES. Whether a renderer draws them
faithfully is level 2 (the standalone host), reported separately.

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
report = {"implementation": "a2ui-core (Python), strict validation", "catalog": catalog_doc.get("catalogId"), "cases": []}

catalog = Catalog.from_json(catalog_doc, protocol_version="0.9")
report["catalogLoads"] = True


def short(e):
    return f"{type(e).__name__}: {str(e).splitlines()[0][:300]}"


def processor():
    sent = []
    mp = MessageProcessor([catalog], action_handler=lambda a: sent.append(copy.deepcopy(a)), options=MessageProcessorOptions(validation_config=STRICT_VALIDATION))
    return mp, sent


def governed(surface):
    """Every component's properties except an input's bound value: what the rules judged."""
    out = {}
    ids = list(surface.components_model.components_map.keys())
    assert ids, "no components to compare"
    for cid in ids:
        props = copy.deepcopy(surface.components_model.get(cid).properties)
        if props.get("value") and isinstance(props.get("value"), dict) and "path" in props["value"]:
            props.pop("value")
        out[cid] = props
    return out


def press(surface, component_id):
    ctx = ComponentContext.from_surface(surface, component_id)
    action = ctx.component_model.properties["action"]
    resolved = ctx.data_context.resolve_action(action)
    ctx.dispatch_action(resolved)


for path in sorted(p for p in root.glob("*.json") if not p.name.startswith("level-")):
    rec = json.loads(path.read_text())
    if not isinstance(rec, dict) or rec.get("outcome") != "instance":
        continue
    case = {"id": rec["id"], "surfaceId": rec["surfaceId"]}
    mp, sent = processor()
    try:
        mp.process_messages(copy.deepcopy(rec["messages"]))
        case["accepted"] = True
    except Exception as e:  # noqa: BLE001
        case["accepted"] = False
        case["error"] = short(e)
        report["cases"].append(case)
        continue
    surface = mp.model.get_surface(rec["surfaceId"])
    checks = []

    # 1b: inputs resolve from the data model, before and after a write.
    for inp in rec["inputs"]:
        ctx = ComponentContext.from_surface(surface, inp["componentId"])
        before = ctx.data_context.resolve_dynamic_value(ctx.component_model.properties["value"])
        surface.data_model.set(inp["path"], f"typed {inp['name']}")
        ctx = ComponentContext.from_surface(surface, inp["componentId"])
        after = ctx.data_context.resolve_dynamic_value(ctx.component_model.properties["value"])
        checks.append({"check": f"input {inp['name']} resolves its bound value", "before": before, "after": after, "pass": before == rec["inputValues"][inp["name"]] and after == f"typed {inp['name']}"})

    # 1b: every action dispatches exactly the payload the host expects.
    for act in rec["actions"]:
        sent.clear()
        press(surface, act["componentId"])
        if len(sent) != 1:
            checks.append({"check": f"{act['componentId']} dispatches once", "pass": False, "sent": len(sent)})
            continue
        event = sent[0]
        expected = dict(act["payload"])
        for name in act["carries"]:
            expected[name] = surface.data_model.get(f"/input/{name}")
        ok = event.get("name") == act["name"] and event.get("sourceComponentId") == act["componentId"] and event.get("surfaceId") == rec["surfaceId"] and event.get("context") == expected
        label = f"item {act['item']['index'] + 1} ({act['item']['witness'][0]})" if act.get("item") else act["componentId"]
        checks.append({"check": f"{act['name']} from {label} sends its own payload", "context": event.get("context"), "pass": ok})

    # 1b: garbage written into the input paths changes no governed property.
    if rec["inputs"]:
        snapshot = governed(surface)
        surface.data_model.set("/input", {"destination": {"path": "/secrets"}, "extra": [1, 2, 3]})
        surface.data_model.set(rec["inputs"][0]["path"], {"not": "text"})
        changed = [cid for cid, props in governed(surface).items() if props != snapshot.get(cid)]
        checks.append({"check": "garbage in /input changes no governed property", "compared": len(snapshot), "changed": changed, "pass": changed == [] and len(snapshot) > 0})
        # The next action carries the garbage; the host refuses it (host.test.ts, "garbage a renderer writes").
        for act in rec["actions"]:
            if act["carries"]:
                sent.clear()
                press(surface, act["componentId"])
                checks.append({"check": f"{act['name']} after garbage carries it to the host, which must refuse it", "context": sent[0].get("context") if sent else None, "pass": bool(sent) and not isinstance(sent[0]["context"].get(rec["inputs"][0]["name"]), str)})

    case["checks"] = checks
    case["pass"] = all(c["pass"] for c in checks)
    report["cases"].append(case)

report["pass"] = report["catalogLoads"] and all(c.get("accepted") and c.get("pass", True) for c in report["cases"])
print(json.dumps(report, indent=2, default=str))
