"""Probe the derived 1.0 catalog against final A2UI 1.0: the official
catalog_definition schema, and bindings written the 1.0 way (@path) versus
the 0.9 way (path)."""
import json, sys, copy
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from a2ui.core.catalog import Catalog
from a2ui.core.processing import MessageProcessor, MessageProcessorOptions
from a2ui.core.validation import STRICT_VALIDATION

spec = sys.argv[1]; work = sys.argv[2]
defn = json.load(open(f"{spec}/catalog_definition.json"))
common = json.load(open(f"{spec}/common_types.json"))
reg = Registry().with_resources([(r["$id"], Resource.from_contents(r)) for r in (defn, common) if "$id" in r])
val = Draft202012Validator(defn, registry=reg)

def short(e): return f"{type(e).__name__}: {str(e).splitlines()[0][:220]}"

for name in sys.argv[3:]:
    d = json.load(open(f"{work}/emitted-{name}.json"))
    cat_doc = d["catalogs"]["1.0"]
    errs = sorted(val.iter_errors(cat_doc), key=lambda e: list(e.path))
    print(f"== {name} 1.0 catalog vs official catalog_definition.json: {len(errs)} error(s)")
    seen = set()
    for e in errs:
        k = (e.validator, e.message[:120])
        if k in seen: continue
        seen.add(k); print("   ", "/".join(map(str, e.path))[:80] or "(root)", "|", e.message[:200])
        if len(seen) >= 8: break
    # A minimal surface using the catalog's own TextField, three ways.
    comps = cat_doc["components"]
    tf = "TextField" if "TextField" in comps else None
    if not tf: continue
    cid = cat_doc.get("catalogId")
    cat = Catalog.from_json(cat_doc, protocol_version="1.0")
    for label, value in [("0.9 spelling {path}", {"path": "/form/name"}), ("1.0 spelling {@path}", {"@path": "/form/name"})]:
        msgs = [
            {"version": "1.0", "createSurface": {"surfaceId": "probe", "catalogId": cid}},
            {"version": "1.0", "updateComponents": {"surfaceId": "probe", "components": [{"id": "root", "component": tf, "label": "Name", "value": value}]}},
            {"version": "1.0", "updateDataModel": {"surfaceId": "probe", "path": "/form", "value": {"name": "Ada"}}},
        ]
        try:
            MessageProcessor([cat], options=MessageProcessorOptions(validation_config=STRICT_VALIDATION)).process_messages(copy.deepcopy(msgs))
            print(f"   1.0 message, TextField value as {label}: accepted")
        except Exception as e:
            print(f"   1.0 message, TextField value as {label}: REJECTED  {short(e)}")
