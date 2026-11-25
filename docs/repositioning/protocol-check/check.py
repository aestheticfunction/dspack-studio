"""Run Composer's derived catalogs and emitted messages through the upstream
A2UI Python core (a2ui-core, built from the a2ui-project/a2ui clone)."""
import json, sys, traceback, copy
from a2ui.core.catalog import Catalog
from a2ui.core.processing import MessageProcessor, MessageProcessorOptions
from a2ui.core.validation import STRICT_VALIDATION

def short(e):
    return f"{type(e).__name__}: {str(e).splitlines()[0][:300]}"

def walk(o, fn, path="$"):
    if isinstance(o, dict):
        for k, v in o.items():
            fn(k, v, f"{path}.{k}")
            walk(v, fn, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk(v, fn, f"{path}[{i}]")

report = {}
for name in sys.argv[2:]:
    d = json.load(open(f"{sys.argv[1]}/emitted-{name}.json"))
    r = report[name] = {}
    for v in ["0.9.1", "1.0"]:
        cat_doc = d["catalogs"][v]
        entry = r[v] = {"catalogId": cat_doc.get("catalogId"), "protocolVersion": cat_doc.get("protocolVersion"), "components": len(cat_doc.get("components", {}))}
        # Binding spelling in the catalog's own definitions.
        defs = cat_doc.get("$defs", {})
        db = defs.get("DataBinding", {})
        entry["dataBindingKeys"] = sorted((db.get("properties") or {}).keys())
        try:
            cat = Catalog.from_json(cat_doc, protocol_version="1.0" if v == "1.0" else "0.9")
            entry["catalogLoads"] = True
        except Exception as e:
            entry["catalogLoads"] = False
            entry["catalogError"] = short(e)
            continue
        results = []
        for s in d["surfaces"]:
            if "refused" in s:
                results.append({"id": s["id"], "skipped": "refused by dspack-emit"})
                continue
            msgs = copy.deepcopy(s["messages"])
            try:
                mp = MessageProcessor([cat], options=MessageProcessorOptions(validation_config=STRICT_VALIDATION))
                mp.process_messages(msgs)
                results.append({"id": s["id"], "ok": True})
            except Exception as e:
                results.append({"id": s["id"], "ok": False, "error": short(e)})
        entry["surfaces"] = results
        entry["surfacesOk"] = sum(1 for x in results if x.get("ok"))
        entry["surfacesChecked"] = sum(1 for x in results if "ok" in x)
json.dump(report, open(f"{sys.argv[1]}/protocol-report.json", "w"), indent=1)
for name, r in report.items():
    for v, e in r.items():
        print(name, v, "catalogLoads=", e.get("catalogLoads"), e.get("catalogError", ""), "| surfaces ok", e.get("surfacesOk"), "/", e.get("surfacesChecked"), "| binding keys", e["dataBindingKeys"], "| protocolVersion", e["protocolVersion"])
        errs = {}
        for x in e.get("surfaces", []):
            if x.get("ok") is False:
                errs.setdefault(x["error"][:160], []).append(x["id"])
        for k, ids in errs.items():
            print("   ", len(ids), "x", k, ids[:3])
