/**
 * Block promotion in the Library (M1 advanced authoring, slice D): the blocks a designer can start from, the
 * confirmation that says what a promotion makes, and the inspector's "From a block" section that lists every
 * interaction the block had and whether the composition can declare it.
 *
 * Nothing here maps anything by itself. Mapping a button declares its action through the ordinary action
 * authoring (interaction.ts); removing a part removes it through the ordinary template editing (composer-core
 * template.ts). Both are undoable edits to the draft, checked by the same loader as every other edit.
 */
import { useMemo, useState } from "react";
import type { BlockDefinition } from "@dspack-studio/composer-core/blocks";
import { constraintStandings, promoteBlock, promotionIssues, promotionMappings, promotionPartKey, removeNode, type CompositionDefinition, type PromotionMapping } from "@dspack-studio/composer-core/compositions";
import { applyActionChange } from "./interaction";
import type { Promotion } from "./storage";

const words = (s: string) => s.replace(/[_.-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().trim();
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const PURPOSE: Record<string, string> = {
  "data-collection": "asks a person for details",
  "record-collection": "shows many records of one kind",
  "structured-editing": "walks through a structured task",
};

/** The Compositions panel's list of blocks, each with its promotion confirmation. */
export function BlockList({ blocks, taken, reference, promote }: { blocks: BlockDefinition[]; taken: ReadonlySet<string>; reference: string; promote: (block: BlockDefinition) => Promise<string | null> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (blocks.length === 0) return null;
  return (
    <section className="cl-blocks" aria-labelledby="cl-blocks-title" data-testid="block-list">
      <h3 className="cl-label" id="cl-blocks-title">
        Start from a block
      </h3>
      <p className="cl-dim">A block is a reusable piece of the {reference} design system. Promoting one makes a new draft composition from it; the block itself does not change.</p>
      <ul className="cl-list">
        {blocks.map((b) => (
          <li key={b.id} className="cl-block" data-testid={`block-${b.id}`}>
            <span className="cl-item__name">{b.name}</span>
            <span className="cl-item__summary">{b.summary}</span>
            {open === b.id ? (
              <PromoteConfirm
                block={b}
                taken={taken}
                reference={reference}
                busy={busy}
                problem={problem}
                cancel={() => {
                  setOpen(null);
                  setProblem(null);
                }}
                confirm={async () => {
                  setBusy(true);
                  const p = await promote(b);
                  setBusy(false);
                  setProblem(p);
                  if (!p) setOpen(null);
                }}
              />
            ) : (
              <button className="cl-tool" onClick={() => setOpen(b.id)} aria-expanded={false} data-testid={`promote-${b.id}`}>
                Promote to a composition…
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PromoteConfirm({ block, taken, reference, busy, problem, cancel, confirm }: { block: BlockDefinition; taken: ReadonlySet<string>; reference: string; busy: boolean; problem: string | null; cancel: () => void; confirm: () => void }) {
  // The same promotion the confirmation would make, on a copy: what is said here is what will happen.
  const { composition, report } = useMemo(() => promoteBlock(block, { reference, taken }), [block, reference, taken]);
  const toResolve = promotionIssues(composition, block.actions ?? [], block.constraints).length;
  return (
    <div className="cl-bar cl-bar--confirm" role="group" aria-labelledby={`cl-promote-${block.id}`} data-testid="promote-confirm">
      <p className="cl-bar__title" id={`cl-promote-${block.id}`}>
        Make “{block.name}” a composition?
      </p>
      <ul className="cl-plain">
        <li>A new draft, “{composition.name}” v1, that {PURPOSE[composition.states[0]!.purpose] ?? words(composition.states[0]!.purpose)}. Nothing is approved or published.</li>
        <li>
          What the block was given ({composition.data.map((d) => words(String(d.name))).join(", ")}) becomes the data an agent provides; its {composition.scenarios.length === 1 ? "example becomes an example" : `${composition.scenarios.length} examples become examples`}.
        </li>
        <li data-testid="promote-to-resolve">
          {toResolve === 0 ? "Every action it has can be declared as it is." : `${toResolve} ${toResolve === 1 ? "thing" : "things"} to resolve before it can be approved: buttons and fields whose actions are not declared, or whose ids are computed from data. Nothing is mapped for you.`}
        </li>
        {report.notCarried.map((n) => (
          <li key={n} className="cl-dim">
            Not carried: {n}
          </li>
        ))}
      </ul>
      {problem && (
        <p className="cl-bad" role="alert">
          {problem}
        </p>
      )}
      <div className="cl-bar__actions">
        <button className="cl-tool cl-tool--primary" onClick={confirm} disabled={busy} data-testid="promote-confirm-button">
          {busy ? "Promoting…" : "Promote to a draft"}
        </button>
        <button className="cl-tool" onClick={cancel} autoFocus>
          Cancel
        </button>
      </div>
    </div>
  );
}

type Row = { id: string; title: string; status: "resolved" | "to-resolve" | "info"; detail: string; action?: { label: string; run: () => void; testid: string }; inspect?: string };

/** One row per interaction of the block, with what can be done about it. Computed actions are grouped by repeat. */
function rows(definition: CompositionDefinition, actions: readonly string[], editable: boolean, ops: PromotionOps): Row[] {
  const mappings = promotionMappings(definition, actions);
  const out: Row[] = [];
  const grouped = new Map<string, PromotionMapping[]>();
  const missing: string[] = [];
  for (const m of mappings) {
    if (m.kind === "action" && m.status === "computed") {
      grouped.set(m.repeat!, [...(grouped.get(m.repeat!) ?? []), m]);
      continue;
    }
    if (m.kind === "action" && m.status === "mappable") {
      const declared = definition.actions.find((a) => a.node === m.node);
      out.push(
        declared
          ? { id: m.name, title: sentence(words(m.name)), status: "resolved", detail: `Mapped: pressing “${m.node}” sends ${words(declared.name)}.`, inspect: `#${m.node}` }
          : {
              id: m.name,
              title: sentence(words(m.name)),
              status: "to-resolve",
              detail: `Not mapped. Its button “${m.node}” is always shown, so its action can be declared.`,
              inspect: `#${m.node}`,
              ...(editable ? { action: { label: "Map to its button", run: () => ops.map(m.node!), testid: `promotion-map-${m.name}` } } : {}),
            },
      );
    } else if (m.kind === "action" && m.status === "conditional") {
      out.push({
        id: m.name,
        title: sentence(words(m.name)),
        status: "to-resolve",
        detail: `Its button is shown only when “${words(m.when!)}” is set, so a screen without the button would still carry the action. Remove that part, or replace it with a button that is always shown.`,
        inspect: `#${m.node}`,
        ...(editable ? { action: { label: "Remove that part", run: () => ops.remove("condition", m.when!), testid: `promotion-remove-${m.name}` } } : {}),
      });
    } else if (m.kind === "action" && m.status === "missing") {
      missing.push(m.name);
    } else if (m.kind === "input" && m.status === "computed") {
      out.push({
        id: `input-${m.repeat}`,
        title: m.name,
        status: "to-resolve",
        detail: "Their ids are computed from data, so what is typed cannot be bound. Add text fields of your own (Insert), then remove these.",
        ...(editable ? { action: { label: "Remove them", run: () => ops.remove("repeat", m.repeat!), testid: `promotion-remove-input-${m.repeat}` } } : {}),
      });
    } else if (m.kind === "input") {
      const input = definition.inputs.find((i) => i.node === m.node);
      const detail = !input ? "Not declared: what is typed goes nowhere." : input.sensitive ? "Declared and private: masked on screen, sent once with its action, never kept." : "Declared: what is typed is sent with an action.";
      out.push({ id: `input-${m.node}`, title: `Text field “${m.node}”`, status: input ? "resolved" : "info", detail, inspect: `#${m.node}` });
    }
  }
  for (const [repeat, list] of grouped)
    out.push({
      id: `repeat-${repeat}`,
      title: `Buttons for each item in “${words(repeat)}”`,
      status: "to-resolve",
      detail: `${list.map((m) => sentence(words(m.name))).join(", ")}: their ids are computed from data, so they cannot be mapped. Remove them, or add buttons of your own.`,
      ...(editable ? { action: { label: "Remove them", run: () => ops.remove("repeat", repeat), testid: `promotion-remove-repeat-${repeat}` } } : {}),
    });
  if (missing.length)
    out.push({ id: "removed", title: missing.length === 1 ? "No longer sent" : `${missing.length} actions no longer sent`, status: "info", detail: `${missing.map((n) => sentence(words(n))).join(", ")}: no element sends ${missing.length === 1 ? "it" : "them"} any more, so there is nothing to map.` });
  return out;
}

export interface PromotionOps {
  /** Declare the action of the button with this id. */
  map: (node: string) => void;
  /** Remove the repeat over, or the condition on, this field. */
  remove: (kind: "repeat" | "condition", field: string) => void;
  /** Select an element by its Structure key. */
  inspect: (key: string) => void;
}

/** The edit that declares a mapped button's action; refused by the loader if it would not be valid. */
export const mapEdit = (node: string) => (d: CompositionDefinition) => applyActionChange(d, { op: "declare", node });

/** The edit that removes the part an unresolved mapping sits in, or null if the draft no longer has it. */
export function removeEdit(definition: CompositionDefinition, kind: "repeat" | "condition", field: string): ((d: CompositionDefinition) => void) | null {
  const part = promotionPartKey(definition, kind, field);
  if (!part) return null;
  return (d) => {
    const r = removeNode(d, part.state, part.key);
    if (!r.ok) throw new Error(r.reason);
  };
}

/** The inspector's "From a block" section body. */
export function PromotionDetails({ definition, promotion, block, editable, ops, status }: { definition: CompositionDefinition; promotion: Promotion; block: BlockDefinition | null | undefined; editable: boolean; ops: PromotionOps; status: { text: string; tone: "ok" | "bad" } | null }) {
  if (block === undefined) return <p className="cl-dim">Reading the block it came from…</p>;
  if (!block)
    return (
      <p className="cl-warn" data-testid="promotion-missing">
        Promoted from the {promotion.reference} block {promotion.block} v{promotion.version}, which is not available now, so its actions cannot be checked. It cannot be approved until it is.
      </p>
    );
  const list = rows(definition, block.actions ?? [], editable && definition.status === "draft", ops);
  // The block's checks between fields (decision 82): blocking while the composition still shows what they
  // protect; genuinely resolved, and said so, once it no longer reads a field they constrain.
  const standings = constraintStandings(definition, block.constraints);
  const blocking = standings.filter((k) => k.status === "blocking");
  const moot = standings.filter((k) => k.status === "moot");
  const listed = (ks: typeof standings) => ks.map((k) => k.text).join("; ");
  if (blocking.length)
    list.push({ id: "checks-blocking", title: blocking.length === 1 ? "A check between fields" : `${blocking.length} checks between fields`, status: "to-resolve", detail: `The block checks that ${listed(blocking)}. A composition cannot carry ${blocking.length === 1 ? "that check" : "these checks"}, and this one still shows those fields, so data that breaks ${blocking.length === 1 ? "it" : "them"} would be shown. Remove what reads them.` });
  if (moot.length)
    list.push({ id: "checks-moot", title: moot.length === 1 ? "A check between fields, no longer needed" : `${moot.length} checks between fields, no longer needed`, status: "resolved", detail: `The block checks that ${listed(moot)}. This composition no longer shows a field ${moot.length === 1 ? "it constrains" : "they constrain"}.` });
  // Checks between fields are listed above with their standing; what else is not carried is said here.
  const notCarried = promoteBlock(block, { reference: promotion.reference, taken: new Set() }).report.notCarried.filter((n) => !n.startsWith("The block's check") && !/^The block's \d+ checks/.test(n));
  const open = list.filter((r) => r.status === "to-resolve").length;
  return (
    <div className="cl-promo" data-testid="promotion-details" data-open={open}>
      <p className="cl-text" data-testid="promotion-source">
        Promoted on this device from the {promotion.reference} block “{block.name}” ({block.id} v{block.version}). The block is unchanged.
      </p>
      <p className={open ? "cl-warn" : "cl-ok"} data-testid="promotion-summary" role="status">
        {definition.status === "approved"
          ? "Every action from the block was resolved before this version was approved."
          : open === 0
            ? "Everything from the block is resolved. Run the checks, then it can be approved."
            : `${open} ${open === 1 ? "thing" : "things"} to resolve before this draft can be approved.`}
      </p>
      <ul className="cl-promo__list">
        {list.map((r) => (
          <li key={r.id} className={`cl-promo__row cl-promo__row--${r.status}`} data-testid={`promotion-row-${r.id}`} data-status={r.status}>
            <span className="cl-promo__title">
              <span className="cl-promo__mark" aria-hidden="true">
                {r.status === "resolved" ? "✓" : r.status === "to-resolve" ? "!" : "·"}
              </span>
              {r.title}
              <span className="cl-sr">{r.status === "resolved" ? " (resolved)" : r.status === "to-resolve" ? " (to resolve)" : ""}</span>
            </span>
            <span className="cl-promo__detail">{r.detail}</span>
            {(r.action || r.inspect) && (
              <span className="cl-promo__actions">
                {r.action && (
                  <button className="cl-tool" onClick={r.action.run} data-testid={r.action.testid}>
                    {r.action.label}
                  </button>
                )}
                {r.inspect && (
                  <button className="cl-link" onClick={() => ops.inspect(r.inspect!)}>
                    Select it
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {notCarried.length > 0 && (
        <ul className="cl-plain" data-testid="promotion-not-carried">
          {notCarried.map((n) => (
            <li key={n} className="cl-dim">
              Not carried: {n}
            </li>
          ))}
        </ul>
      )}
      {status && (
        <p className={status.tone === "bad" ? "cl-bad" : "cl-ok"} role="status" data-testid="promotion-status">
          {status.text}
        </p>
      )}
    </div>
  );
}
