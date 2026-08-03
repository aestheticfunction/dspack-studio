/**
 * The wireframe registry: visuals derived from the catalog itself.
 *
 * `wireframeRegistryFor(catalogJson)` builds a Registry entry for EVERY
 * catalog name — a labeled outline box showing scalar props as a mini table,
 * rendering ComponentId/ChildList props as nested slots via buildChild, and
 * Action props as inert buttons. It is the honest universal preview: any
 * conformant catalog renders immediately, no user code executes, and targets
 * with no native renderer (a future Vue library) degrade here instead of
 * failing.
 *
 * The invariant holds by construction: the registry is keyed off the
 * catalog's own names (a registry can never add vocabulary), and the accepted
 * schema still comes from buildComponentApi via buildCatalog.
 */
import type { CSSProperties, FC } from "react";
import { withProvenance, type Registry } from "@dspack-studio/a2ui-ingest";
import { classifyProps, type WireProp } from "./classify-props.js";

const box: CSSProperties = {
  border: "1px dashed var(--line, #8884)",
  borderRadius: 6,
  padding: "8px 10px",
  margin: 2,
  fontFamily: "var(--mono, ui-monospace, monospace)",
  fontSize: 12,
  color: "var(--fg, inherit)",
  background: "transparent",
};

const nameStyle: CSSProperties = { opacity: 0.65, letterSpacing: "0.04em", fontSize: 10, textTransform: "uppercase" };
const valueStyle: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 0" };
const chip: CSSProperties = { border: "1px solid var(--line, #8884)", borderRadius: 4, padding: "0 4px", opacity: 0.9 };
const actionStyle: CSSProperties = { ...chip, cursor: "not-allowed", background: "var(--bg-1, transparent)" };

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function makeWireframe(name: string, wireProps: WireProp[]): FC<any> {
  const valueProps = wireProps.filter((p) => p.kind === "value");
  const childProps = wireProps.filter((p) => p.kind === "child");
  const childrenProps = wireProps.filter((p) => p.kind === "children");
  const actionProps = wireProps.filter((p) => p.kind === "action");

  const Wireframe: FC<any> = ({ props, buildChild }) => (
    <div style={box} data-wireframe={name}>
      <div style={nameStyle}>{name}</div>
      {valueProps.some((p) => props?.[p.name] !== undefined) && (
        <div style={valueStyle}>
          {valueProps
            .filter((p) => props?.[p.name] !== undefined)
            .map((p) => (
              <span key={p.name} style={chip}>
                {p.name}={display(props[p.name])}
              </span>
            ))}
        </div>
      )}
      {actionProps
        .filter((p) => props?.[p.name] !== undefined)
        .map((p) => (
          <button key={p.name} type="button" disabled style={actionStyle}>
            action: {p.name}
          </button>
        ))}
      {childProps.map((p) =>
        props?.[p.name] && buildChild ? <div key={p.name}>{buildChild(props[p.name])}</div> : null,
      )}
      {childrenProps.map((p) => {
        const ids = props?.[p.name];
        if (!Array.isArray(ids) || !buildChild) return null;
        return <div key={p.name}>{ids.map((id: string) => buildChild(id))}</div>;
      })}
    </div>
  );
  return Wireframe;
}

/** Build the wireframe Registry for one catalog: every name gets a visual. */
export function wireframeRegistryFor(catalog: Record<string, any>): Registry {
  const custom: Record<string, FC<any>> = {};
  for (const name of Object.keys(catalog.components ?? {})) {
    custom[name] = withProvenance(name, makeWireframe(name, classifyProps(catalog, name)));
  }
  return { reuseBasic: new Set<string>(), custom };
}
