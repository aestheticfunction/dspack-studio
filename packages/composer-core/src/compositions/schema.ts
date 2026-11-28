/**
 * Compositions (R1a spike): the sidecar 0.2 document format.
 *
 * A composition is an evolved block (ADR R1): a reusable definition that is
 * instantiated many times with validated data. Where a block has one template
 * the model fills, a composition has:
 *
 *   parameters  fixed when the composition is authored or approved (a block's
 *               props are upcast to parameters);
 *   data        arriving at instantiation, validated against its declared
 *               types and bounds whoever produced it (R0-REVIEW A11);
 *   states      each with a purpose (the contract intent its rules are judged
 *               under), a guard in a closed form, and its own template;
 *   inputs      text fields whose value is bound to a leaf path /input/<name>
 *               after emission (R0-REVIEW 3.2, attachment 1);
 *   actions     declared, with literal payloads fixed at instantiation
 *               (attachment 2), and consequential actions tied to a
 *               confirmation state;
 *   scenarios   the data sets an approval is re-checked against.
 *
 * Everything here is governed DATA. Templates use the block template language
 * unchanged (blocks/expand.ts): nothing in a composition is code.
 *
 * This module parses and structurally checks a 0.2 document. It does not read
 * 0.1 sidecars (load.ts upcasts those) and does not expand anything.
 */
import { z } from "zod";
import type { BlockConstraint, BlockDefinition, PropSpec, TemplateNode } from "../blocks/schema";
import { parseBlocksSidecar } from "../blocks/schema";

export const COMPOSITIONS_SIDECAR_VERSION = "0.2";
/**
 * 0.3 is 0.2 plus three optional, intent-only fields (decision 81): an action's `leadsTo`, and a state's
 * `title` and `description`. A definition that uses none of them is a 0.2 definition and hashes as before; one
 * that uses any of them needs a 0.3 document, so a reader that knows only 0.2 refuses it rather than
 * misreading it (0.2 stays strict).
 */
export const COMPOSITIONS_SIDECAR_VERSIONS = ["0.2", "0.3"] as const;
export type CompositionsSidecarVersion = (typeof COMPOSITIONS_SIDECAR_VERSIONS)[number];

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NAME = /^[a-z][a-zA-Z0-9]*$/;
const ACTION = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const PATH = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

/** Closed guard forms (R0-REVIEW A9). Paths name data or parameters. */
export type Guard =
  | { always: true }
  | { present: string }
  | { empty: string }
  | { minItems: { path: string; min: number } }
  | { all: Guard[] };

export interface CompositionState {
  id: string;
  /** 0.3: a short human name for the state (60 characters at most). Presentation only. */
  title?: string;
  /** 0.3: what the state is for, in a sentence or two (240 characters at most). Presentation only. */
  description?: string;
  /** The contract intent this state's surface is judged under (S3). */
  purpose: string;
  guard: Guard;
  template: TemplateNode;
}

/** What a typed input value must be. Text fields carry strings; the kind says how they are read. */
export interface InputSpec {
  name: string;
  /** The template node (a text-input with a literal id, outside any $each) the value binds to. */
  node: string;
  kind: "text" | "date" | "integer";
  required?: boolean;
  minLength?: number;
  maxLength: number;
  minimum?: number;
  maximum?: number;
  /**
   * A sensitive value (R1A-REVIEW decision D5) reaches the caller once, in the accepted action that carries
   * it, and nowhere else: never carried into a replacement, never written into a creation batch, never kept
   * by the host, and replaced by redactEvent in anything recorded.
   */
  sensitive?: boolean;
}

/** A payload value: a JSON scalar, or a reference resolved once, at instantiation. */
export type PayloadValue = string | number | boolean | { $prop: string };

export interface ActionSpec {
  /** The emitted A2UI action name (a dspack-emit slug of the node id). */
  name: string;
  /** The template node (a button with a literal id) that dispatches it. */
  node: string;
  /** States whose surface may dispatch it. */
  states: string[];
  /** For a repeated element: the list node (literal id, outside $each), the data array, and its loop name. */
  repeat?: { list: string; each: string; as: string; witness: string[] };
  /** Literal context, fixed at instantiation. Per-item references read `<as>.<field>`. */
  payload?: Record<string, PayloadValue>;
  /** Input names whose current values the action carries, as paths under /input/. */
  carries?: string[];
  /** A consequential action is accepted only from its confirmation state, once per surface. */
  consequential?: boolean;
  /**
   * 0.3: the states the designer intends this action to lead to. Intent only: the host never moves to them,
   * never refuses data that leads elsewhere, and never authorizes anything because of them. The next state is
   * still chosen by the data the agent returns (expand.ts selectState).
   */
  leadsTo?: string[];
}

export interface Scenario {
  id: string;
  state?: string;
  data: Record<string, unknown>;
  expect: "ok" | "refused";
  /**
   * For an expected refusal: the rule id (as lint reports it, e.g. "rule.review-offers-alternatives") or the
   * pipeline stage ("data", "state", "expand", "emit", "attach", "layout", "gates") that must refuse it
   * (R1A-REVIEW L3). Any other refusal fails the re-check.
   */
  refusedBy?: string;
  /** A short human name for the example, shown to designers (for example "Three hotels"). Optional. */
  title?: string;
}

export interface CompositionDefinition {
  id: string;
  version: number;
  status: "draft" | "approved";
  name: string;
  summary: string;
  parameters: PropSpec[];
  data: PropSpec[];
  /**
   * Cross-field checks over parameters and data, in the block constraint language. Set by the 0.1 upcast
   * from a block's constraints; not yet authorable in a 0.2 document.
   */
  constraints?: BlockConstraint[];
  inputs: InputSpec[];
  actions: ActionSpec[];
  states: CompositionState[];
  scenarios: Scenario[];
  /** Set by the 0.1 upcast: the block this composition was read from. */
  upcastFrom?: { block: string; version: number };
}

export interface CompositionsSidecar {
  compositionsSidecar: CompositionsSidecarVersion;
  status: "draft" | "approved";
  reference: { name: string; dspack: string; version: string };
  baseSha256: string;
  /** Blocks carried unchanged from 0.1 (each also upcast to a composition by load.ts). */
  blocks: BlockDefinition[];
  compositions: CompositionDefinition[];
}

export interface CompositionIssue {
  path: string;
  message: string;
}

const guardSchema: z.ZodType<Guard> = z.lazy(() =>
  z.union([
    z.object({ always: z.literal(true) }).strict(),
    z.object({ present: z.string().regex(PATH) }).strict(),
    z.object({ empty: z.string().regex(PATH) }).strict(),
    z.object({ minItems: z.object({ path: z.string().regex(PATH), min: z.number().int().min(0) }).strict() }).strict(),
    z.object({ all: z.array(guardSchema).min(1) }).strict(),
  ]),
);

const payloadValue = z.union([z.string(), z.number(), z.boolean(), z.object({ $prop: z.string().regex(PATH) }).strict()]);

const compositionSchema = z
  .object({
    id: z.string().regex(ID, "composition ids are kebab-case"),
    version: z.number().int().min(1),
    status: z.enum(["draft", "approved"]),
    name: z.string().min(1).max(80),
    summary: z.string().min(1).max(240),
    parameters: z.array(z.record(z.unknown())).default([]),
    data: z.array(z.record(z.unknown())).default([]),
    inputs: z
      .array(
        z
          .object({
            name: z.string().regex(NAME),
            node: z.string().min(1),
            kind: z.enum(["text", "date", "integer"]),
            required: z.boolean().optional(),
            minLength: z.number().int().min(0).optional(),
            maxLength: z.number().int().min(1).max(500),
            minimum: z.number().int().optional(),
            maximum: z.number().int().optional(),
            sensitive: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    actions: z
      .array(
        z
          .object({
            name: z.string().regex(ACTION),
            node: z.string().min(1),
            states: z.array(z.string().regex(ID)).min(1),
            repeat: z
              .object({
                list: z.string().min(1),
                each: z.string().regex(PATH),
                as: z.string().regex(NAME),
                witness: z.array(z.string().regex(PATH)).min(1),
              })
              .strict()
              .optional(),
            payload: z.record(payloadValue).optional(),
            carries: z.array(z.string().regex(NAME)).optional(),
            consequential: z.boolean().optional(),
            leadsTo: z.array(z.string().regex(ID)).min(1).optional(),
          })
          .strict(),
      )
      .default([]),
    states: z
      .array(
        z
          .object({
            id: z.string().regex(ID),
            title: z.string().trim().min(1).max(60).optional(),
            description: z.string().trim().min(1).max(240).optional(),
            purpose: z.string().min(1),
            guard: guardSchema,
            template: z.record(z.unknown()),
          })
          .strict(),
      )
      .min(1),
    scenarios: z
      .array(
        z
          .object({
            id: z.string().regex(ID),
            state: z.string().regex(ID).optional(),
            data: z.record(z.unknown()),
            expect: z.enum(["ok", "refused"]),
            refusedBy: z.string().min(1).optional(),
            title: z.string().trim().min(1).max(60).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const sidecarSchema = z
  .object({
    compositionsSidecar: z.enum(COMPOSITIONS_SIDECAR_VERSIONS),
    status: z.enum(["draft", "approved"]),
    reference: z.object({ name: z.string().min(1), dspack: z.string().min(1), version: z.string().min(1) }).strict(),
    baseSha256: z.string().regex(/^[0-9a-f]{64}$/),
    blocks: z.array(z.unknown()).default([]),
    compositions: z.array(compositionSchema).min(1),
  })
  .strict();

/**
 * Parse a 0.2 document. Prop specs are checked by re-using the 0.1 block
 * parser on a probe block, so the value-type language stays one language.
 */
export function parseCompositionsSidecar(json: unknown): { ok: true; sidecar: CompositionsSidecar } | { ok: false; issues: CompositionIssue[] } {
  const parsed = sidecarSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "$", message: i.message })) };
  }
  const doc = parsed.data;
  const issues: CompositionIssue[] = [];

  // Blocks carried from 0.1 parse with the 0.1 parser, unchanged.
  let blocks: BlockDefinition[] = [];
  if (doc.blocks.length > 0) {
    const probe = parseBlocksSidecar({ blocksSidecar: "0.1", status: doc.status, reference: doc.reference, baseSha256: doc.baseSha256, blocks: doc.blocks });
    if (probe.ok) blocks = probe.sidecar.blocks;
    else issues.push(...probe.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  doc.compositions.forEach((c, n) => {
    const at = `compositions.${n}`;
    for (const [field, specs] of [
      ["parameters", c.parameters],
      ["data", c.data],
    ] as const) {
      if (specs.length === 0) continue;
      const probe = parseBlocksSidecar(probeSidecar(doc, specs));
      if (!probe.ok) issues.push(...probe.issues.filter((i) => i.path.includes(".props")).map((i) => ({ path: `${at}.${field}${i.path.replace(/^blocks\.0\.props/, "")}`, message: i.message })));
    }
    const names = [...c.parameters, ...c.data].map((p) => String(p.name));
    const dup = names.find((name, i) => names.indexOf(name) !== i);
    if (dup) issues.push({ path: `${at}`, message: `'${dup}' is declared twice across parameters and data` });
    const stateIds = c.states.map((s) => s.id);
    if (new Set(stateIds).size !== stateIds.length) issues.push({ path: `${at}.states`, message: "state ids must be unique" });
    if (doc.compositionsSidecar === "0.2" && usesIntentFields(c as unknown as CompositionDefinition)) {
      issues.push({ path: at, message: "leadsTo, a state's title and a state's description need compositionsSidecar 0.3" });
    }
    c.actions.forEach((a, i) => {
      for (const s of a.states) if (!stateIds.includes(s)) issues.push({ path: `${at}.actions.${i}.states`, message: `unknown state '${s}'` });
      for (const s of a.leadsTo ?? []) if (!stateIds.includes(s)) issues.push({ path: `${at}.actions.${i}.leadsTo`, message: `unknown state '${s}'` });
      if (a.leadsTo && new Set(a.leadsTo).size !== a.leadsTo.length) issues.push({ path: `${at}.actions.${i}.leadsTo`, message: "a state is named twice in leadsTo" });
      if (a.consequential && a.leadsTo?.some((s) => a.states.includes(s))) issues.push({ path: `${at}.actions.${i}.leadsTo`, message: "a consequential action cannot lead back to its own confirmation state" });
      for (const name of a.carries ?? []) if (!c.inputs.some((x) => x.name === name)) issues.push({ path: `${at}.actions.${i}.carries`, message: `unknown input '${name}'` });
      if (a.repeat && a.carries?.length) issues.push({ path: `${at}.actions.${i}`, message: "a repeated action carries a literal payload only, never input values" });
    });
    c.scenarios.forEach((s, i) => {
      if (s.state && !stateIds.includes(s.state)) issues.push({ path: `${at}.scenarios.${i}.state`, message: `unknown state '${s.state}'` });
      if (s.expect === "refused" && !s.refusedBy) issues.push({ path: `${at}.scenarios.${i}.refusedBy`, message: "a refused scenario names the rule or stage that must refuse it (refusedBy)" });
      if (s.expect === "ok" && s.refusedBy) issues.push({ path: `${at}.scenarios.${i}.refusedBy`, message: "only a refused scenario names refusedBy" });
    });
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, sidecar: { ...(doc as unknown as CompositionsSidecar), blocks } };
}

/** Whether a definition uses any 0.3 field (leadsTo, a state's title or description). */
export function usesIntentFields(c: CompositionDefinition): boolean {
  return c.actions.some((a) => a.leadsTo !== undefined) || c.states.some((s) => s.title !== undefined || s.description !== undefined);
}

/** The oldest document version that can hold a definition: 0.2 unless it uses a 0.3 field. */
export function requiredSidecarVersion(c: CompositionDefinition): CompositionsSidecarVersion {
  return usesIntentFields(c) ? "0.3" : "0.2";
}

function probeSidecar(doc: { status: string; reference: unknown; baseSha256: string }, props: unknown[]) {
  return {
    blocksSidecar: "0.1",
    status: doc.status,
    reference: doc.reference,
    baseSha256: doc.baseSha256,
    blocks: [
      {
        id: "probe",
        version: 1,
        status: "draft",
        name: "probe",
        summary: "probe",
        intents: ["probe"],
        keywords: [],
        props,
        actions: [],
        streaming: "static-safe",
        template: { component: "text", text: "probe" },
        examples: [],
      },
    ],
  };
}
