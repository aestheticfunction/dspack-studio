"use client";

/**
 * Surface authoring (the "Surfaces" view): build .dsurface trees through forms
 * constrained to the contract's vocabulary (components + sub-components; props
 * from the declared descriptors), with the gates and the preview live on every
 * edit. A saved surface IS a contract worked example — "there is no third
 * example format" — so authoring here simultaneously builds the few-shot
 * corpus and the emit/preview corpus.
 *
 * The file, the component, and the data-testids keep their `scenario` history;
 * only what a person reads changed (the ratified vocabulary: Surface, Flow,
 * Step, Example).
 */
import { useMemo, useState } from "react";
import { buildVocabulary } from "@aestheticfunction/dspack-spec/lib/validate.mjs";
import { A2uiCanvas } from "@dspack-studio/a2ui-ingest";
import { wireframeRegistryFor } from "@dspack-studio/wireframe-renderers";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";
import { surfaceTitle } from "../surface-identity";
import { browserEmit, lintOneSurface } from "../validation";

const field = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "4px 6px",
  borderRadius: 2,
} as const;
const label = { fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" } as const;

interface SurfaceNode {
  component: string;
  id?: string;
  props?: Record<string, unknown>;
  text?: string;
  children?: SurfaceNode[];
}

function NodeEditor({
  node,
  onChange,
  onRemove,
  vocabOptions,
  propsOf,
  depth,
}: {
  node: SurfaceNode;
  onChange: (n: SurfaceNode) => void;
  onRemove?: () => void;
  vocabOptions: Array<{ id: string; sub: boolean }>;
  propsOf: (id: string) => Map<string, any>;
  depth: number;
}) {
  const descriptors = propsOf(node.component);
  const setProp = (name: string, value: unknown, remove = false) => {
    const props = { ...(node.props ?? {}) };
    if (remove || value === "" || value === undefined) delete props[name];
    else props[name] = value;
    onChange({ ...node, props: Object.keys(props).length ? props : undefined });
  };

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 4, padding: "8px 10px", margin: "6px 0", marginLeft: depth * 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          style={field}
          value={node.component}
          onChange={(e) => onChange({ component: e.target.value, id: node.id, children: node.children })}
          data-testid={`node-component-${depth}`}
        >
          {vocabOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.sub ? `↳ ${o.id}` : o.id}
            </option>
          ))}
        </select>
        <input style={{ ...field, width: 90 }} placeholder="id (optional)" value={node.id ?? ""} onChange={(e) => onChange({ ...node, id: e.target.value || undefined })} />
        <input style={{ ...field, flex: 1, minWidth: 120 }} placeholder="text (optional)" value={node.text ?? ""} onChange={(e) => onChange({ ...node, text: e.target.value || undefined })} data-testid={`node-text-${depth}`} />
        {onRemove && (
          <button className="st-link" style={{ color: "var(--err)" }} onClick={onRemove}>
            remove
          </button>
        )}
      </div>

      {descriptors.size > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          {[...descriptors.entries()].map(([name, d]) => {
            const value = node.props?.[name];
            if (d.type === "enum" && Array.isArray(d.values)) {
              const values = d.values.map((v: any) => (v && typeof v === "object" ? v.value : v));
              return (
                <span key={name} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                  {name}={" "}
                  <select style={field} value={(value as string) ?? ""} onChange={(e) => setProp(name, e.target.value)} data-testid={`node-prop-${name}`}>
                    <option value="">unset</option>
                    {values.map((v: string) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </span>
              );
            }
            if (d.type === "boolean") {
              return (
                <label key={name} style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-body)" }}>
                  <input type="checkbox" checked={value === true} onChange={(e) => setProp(name, e.target.checked ? true : undefined)} /> {name}
                </label>
              );
            }
            return (
              <span key={name} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                {name}={" "}
                <input
                  style={{ ...field, width: 110 }}
                  value={(value as string) ?? ""}
                  placeholder={d.type}
                  onChange={(e) => setProp(name, d.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value || undefined)}
                  data-testid={`node-prop-${name}`}
                />
              </span>
            );
          })}
        </div>
      )}

      {(node.children ?? []).map((child, i) => (
        <NodeEditor
          key={i}
          node={child}
          depth={depth + 1}
          vocabOptions={vocabOptions}
          propsOf={propsOf}
          onChange={(n) => onChange({ ...node, children: node.children!.map((c, j) => (j === i ? n : c)) })}
          onRemove={() => onChange({ ...node, children: node.children!.filter((_, j) => j !== i) })}
        />
      ))}
      <button
        className="st-btn st-btn--dashed"
        style={{ marginTop: 4 }}
        onClick={() => onChange({ ...node, children: [...(node.children ?? []), { component: vocabOptions[0].id }] })}
        data-testid={`add-child-${depth}`}
      >
        Add child
      </button>
    </div>
  );
}

export function ScenarioView() {
  const { contract, profile, saveContract, mode, referenceExampleIds, manifest, isExample } = useComposer();
  const [editing, setEditing] = useState<string | null>(null);
  const [meta, setMeta] = useState({ id: "", intent: "", name: "", prompt: "", description: "" });
  const [root, setRoot] = useState<SurfaceNode | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  const vocab = useMemo(() => (contract ? buildVocabulary(contract) : null), [contract]);

  const draftSurface = useMemo(() => {
    if (!contract || !root || !meta.intent) return null;
    return { dspackSurface: "0.1", system: contract.name, intent: meta.intent, root } as Record<string, unknown>;
  }, [contract, root, meta.intent]);

  const lint = useMemo(() => {
    if (!contract || !draftSurface) return [];
    return lintOneSurface(meta.id || "draft", draftSurface, contract);
  }, [contract, draftSurface, meta.id]);

  const preview = useMemo(() => {
    if (!contract || !profile || !draftSurface) return null;
    const result = browserEmit(contract, profile, [{ name: "draft", surface: draftSurface }]);
    const emitted = result.surfaces[0];
    if (!emitted?.messages || !result.catalog) return { error: emitted?.error ?? "no catalog", registry: null, catalog: null, messages: null };
    return { error: null, catalog: result.catalog, registry: wireframeRegistryFor(result.catalog), messages: emitted.messages };
  }, [contract, profile, draftSurface]);

  if (!contract || !vocab) return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No contract loaded.</p>;

  const intents: Array<{ id: string }> = contract.intents ?? [];
  const examples: Array<Record<string, any>> = contract.examples ?? [];
  const vocabOptions = [
    ...[...vocab.components.keys()].map((id) => ({ id, sub: false })),
    ...[...vocab.subComponents.keys()].map((id) => ({ id, sub: true })),
  ];
  const propsOf = (id: string) => vocab.components.get(id)?.props ?? new Map();

  const startNew = () => {
    setEditing("(new)");
    setMeta({ id: "", intent: intents[0]?.id ?? "", name: "", prompt: "", description: "" });
    setRoot({ component: vocabOptions[0]?.id ?? "" });
    setIssue(null);
  };
  const startEdit = (example: Record<string, any>) => {
    setEditing(example.id);
    setMeta({ id: example.id, intent: example.intent, name: example.name ?? "", prompt: example.prompt ?? "", description: example.description ?? "" });
    setRoot(structuredClone(example.surface?.root ?? { component: vocabOptions[0]?.id ?? "" }));
    setIssue(null);
  };
  /** Copy a REFERENCE surface into the project: the editor opens prefilled
   *  with the id cleared, so saving mints a project-owned surface — the
   *  canonical reference row itself is never edited in place. */
  const startCopy = (example: Record<string, any>) => {
    setEditing("(new)");
    setMeta({ id: "", intent: example.intent, name: example.name ? `${example.name} (copy)` : "", prompt: example.prompt ?? "", description: example.description ?? "" });
    setRoot(structuredClone(example.surface?.root ?? { component: vocabOptions[0]?.id ?? "" }));
    setIssue(null);
  };

  const save = async () => {
    if (!draftSurface) return;
    const id = meta.id.startsWith("ex.") ? meta.id : `ex.${meta.id}`;
    const doc = structuredClone(contract);
    const entry = {
      id,
      intent: meta.intent,
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.prompt ? { prompt: meta.prompt } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      surface: { ...draftSurface },
    };
    doc.examples = [...(doc.examples ?? []).filter((e: any) => e.id !== id && e.id !== editing), entry];
    const result = await saveContract(doc);
    if (Array.isArray(result) && result.length > 0) {
      setIssue(result.map((f) => f.message).join("; "));
      return;
    }
    setIssue(null);
    setEditing(null);
  };

  if (editing === null) {
    // Ownership first: the project's own surfaces (accepted builds + authored
    // here) are the primary list; the design system's reference surfaces are a
    // clearly labeled secondary corpus — available as few-shot and teaching
    // context, never presented as the user's own work. In an EXAMPLE
    // workspace, the reference corpus IS the content being shown.
    const yours = isExample ? examples : referenceExampleIds ? examples.filter((e) => !referenceExampleIds.has(e.id)) : examples;
    const refs = isExample ? [] : referenceExampleIds ? examples.filter((e) => referenceExampleIds.has(e.id)) : [];
    // The title leads; the canonical id stays beside it, small, for audit.
    const row = (e: Record<string, any>, isRef: boolean) => (
      <li key={e.id} style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 0" }} data-testid={`scenario-${e.id}`}>
        <span style={{ color: isRef ? "var(--fg-dim)" : "var(--fg)" }}>{surfaceTitle(e, e.id, 64)}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", marginLeft: 8 }}>{e.id}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", marginLeft: 8 }}>{e.intent}</span>
        {isRef ? (
          <button
            className="st-link"
            style={{ marginLeft: 10, fontSize: 12 }}
            onClick={() => startCopy(e)}
            title="Copy this reference surface into the project and edit the copy"
            data-testid={`copy-${e.id}`}
          >
            copy to project
          </button>
        ) : (
          <button className="st-link" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => startEdit(e)} data-testid={`edit-${e.id}`}>
            edit
          </button>
        )}
      </li>
    );
    return (
      <section>
        <ViewHeader
          eyebrow="Surfaces"
          lead="Every screen this project has built or authored. A surface proves a governed context is buildable, previews in your design system, and becomes context the next build learns from."
        />
        <p className="af-label" style={{ margin: "14px 0 4px" }}>
          {isExample ? "Example surfaces" : "Your surfaces"}
        </p>
        {yours.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--fg-dim)" }} data-testid="scenarios-none-yet">
            None yet — accept a Build result (&ldquo;Add to project&rdquo;), or author one below.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, fontSize: 13, margin: 0 }}>{yours.map((e) => row(e, false))}</ul>
        )}
        <button className="st-btn" style={{ marginTop: 10 }} onClick={startNew} disabled={intents.length === 0} data-testid="new-scenario">
          New surface
        </button>
        {intents.length === 0 && <p style={{ fontSize: 12, color: "var(--warn)" }}>Author an intent first (Governance) — every surface is bound to one.</p>}
        {refs.length > 0 && (
          <div style={{ marginTop: 22 }} data-testid="scenarios-reference">
            <p className="af-label" style={{ margin: "0 0 4px", color: "var(--fg-dim)" }}>
              Reference surfaces · {manifest?.name ?? "design system"}
            </p>
            <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 4px" }}>
              The design system&rsquo;s own surfaces — teaching material, and context generation learns from. Copy one into
              the project to make it yours.
            </p>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 13, margin: 0 }}>{refs.map((e) => row(e, true))}</ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(420px, 1fr) minmax(320px, 1fr)" }}>
      <div>
        <button className="st-link" onClick={() => setEditing(null)}>
          ← surfaces
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "10px 0" }}>
          <input style={field} placeholder="ex.id" value={meta.id} onChange={(e) => setMeta({ ...meta, id: e.target.value })} data-testid="scenario-id" />
          <select style={field} value={meta.intent} onChange={(e) => setMeta({ ...meta, intent: e.target.value })} data-testid="scenario-intent">
            {intents.map((i) => (
              <option key={i.id}>{i.id}</option>
            ))}
          </select>
          <input
            style={field}
            placeholder="title — what this surface is called"
            aria-label="Surface title"
            value={meta.name}
            onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          />
          <input style={field} placeholder="prompt a model would receive" value={meta.prompt} onChange={(e) => setMeta({ ...meta, prompt: e.target.value })} data-testid="scenario-prompt" />
        </div>

        <span style={label}>surface tree (vocabulary is the contract's — ↳ marks sub-components)</span>
        {root && (
          <NodeEditor node={root} onChange={setRoot} vocabOptions={vocabOptions} propsOf={propsOf} depth={0} />
        )}

        <button className="st-btn" style={{ marginTop: 8 }} disabled={!draftSurface || meta.id.length < 3 || lint.some((f) => f.severity === "error")} onClick={() => void save()} data-testid="save-scenario">
          Save surface
        </button>
        {lint.some((f) => f.severity === "error") && <span style={{ fontSize: 12, color: "var(--warn)", marginLeft: 8 }}>gates first</span>}
        {issue && <p style={{ fontSize: 12, color: "var(--err)" }}>{issue}</p>}
        {mode === "demo" && <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Saves to this project in your browser.</p>}
      </div>

      <aside>
        <h3 style={{ fontFamily: "var(--hl)", fontSize: 13, textTransform: "uppercase", color: "var(--fg)" }}>Gates, live</h3>
        {lint.length === 0 ? (
          <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ok)" }} data-testid="lint-clean">
            S1 S2 S3 clean
          </p>
        ) : (
          <ul style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--fg-body)", paddingLeft: 16 }} data-testid="lint-findings">
            {lint.map((f, i) => (
              <li key={i} style={{ color: f.severity === "error" ? "var(--err)" : "var(--warn)" }}>
                {f.gate} {f.code}: {f.message}
              </li>
            ))}
          </ul>
        )}

        <h3 style={{ fontFamily: "var(--hl)", fontSize: 13, textTransform: "uppercase", color: "var(--fg)", marginTop: 14 }}>Preview, live</h3>
        {preview?.error ? (
          <p style={{ fontSize: 12, color: "var(--err)" }} data-testid="preview-refused">
            emitter refusal: {preview.error}
          </p>
        ) : preview?.messages && preview.registry && preview.catalog ? (
          <div style={{ border: "1px solid var(--line)", borderRadius: 4, padding: 12, background: "var(--bg-1)" }} data-testid="scenario-preview">
            <A2uiCanvas key={JSON.stringify(preview.messages).length} catalog={preview.catalog} registry={preview.registry} messages={preview.messages} />
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Pick an intent and build the tree.</p>
        )}
      </aside>
    </section>
  );
}
