/**
 * Interface blocks (experimental): loading a sidecar for use.
 *
 * - Binding: the sidecar's baseSha256 must equal the packaged base contract's
 *   digest, or no block is usable (a contract edit never leaves blocks
 *   silently half-working).
 * - B0: each block's template may emit only what generation itself could emit
 *   under the same profile, rule for rule with dspack-gen's generation schema
 *   (src/core/generation-schema.ts): the casualty-free component set, declared
 *   props only (none on sub-components or prop-less components), enum values
 *   from the contract, and an id wherever a profile join keys on it. (The
 *   schema's unroll depth constrains decoding, not the S1 surface gate, so it
 *   does not bind an expansion.) H1 belongs to B0 too: every node the profile
 *   gives an action has an id built only from literals and enum props, and the
 *   names the template can emit equal its declared actions (actions.ts). A
 *   block that fails B0 is disabled and reported; the others stay usable.
 * - emitCheck: the representability check every expansion passes before the
 *   pipeline, and the source of B2's emitted action names.
 */
import { emitSurface, type Profile } from "@aestheticfunction/dspack-emit";
import { actionIssues } from "./actions";
import type { CallIssue } from "./call";
import { contractDigest } from "./digest";
import { alwaysPresent, parseBlocksSidecar, rootScope, specAtPath, type BlockDefinition, type BlocksSidecar, type Scope, type TemplateChild } from "./schema";
import { generationView, type GenerationView } from "./view";

type Json = Record<string, unknown>;

/** dspack-gen enumValues: bare values or { value } descriptors. */
function enumValues(descriptor: Json): string[] | null {
  if (descriptor.type !== "enum" || !Array.isArray(descriptor.values)) return null;
  return descriptor.values.map((v) => (typeof v === "string" ? v : String((v as Json | null)?.value ?? "")));
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** B0 for one block against a generation view. Empty means clean. */
export function b0Issues(block: BlockDefinition, view: GenerationView): string[] {
  const issues: string[] = [];
  const components = (view.contract.components ?? {}) as Record<string, Json>;

  const checkEnumValue = (value: unknown, allowed: string[], at: string, scope: Scope) => {
    const bad = (v: unknown) => issues.push(`${at}: '${String(v)}' is not one of ${allowed.join(", ")}`);
    if (typeof value === "string") {
      if (!allowed.includes(value)) bad(value);
    } else if (isObject(value) && "$case" in value) {
      for (const v of Object.values(isObject(value.map) ? value.map : {})) if (!allowed.includes(v as string)) bad(v);
      if (value.default !== undefined && !allowed.includes(value.default as string)) bad(value.default);
    } else if (isObject(value) && "$prop" in value) {
      const spec = specAtPath(scope, String(value.$prop));
      if (spec?.type === "enum") for (const v of spec.values ?? []) if (!allowed.includes(v)) bad(v);
      else issues.push(`${at}: '${String(value.$prop)}' is not an enum, so it cannot be held to the contract's values`);
      if (value.default !== undefined && !allowed.includes(value.default as string)) bad(value.default);
    } else {
      issues.push(`${at}: an enum prop takes a literal, a $case, or an enum $prop`);
    }
  };

  const walkNode = (node: Json, at: string, scope: Scope) => {
    const id = String(node.component);
    if (!view.components.has(id)) issues.push(`${at}: '${id}' is not in the generation view (not in the contract, or a casualty under this profile)`);
    if (view.joinIdComponents.has(id)) {
      const nodeId = node.id;
      const mayBeAbsent = isObject(nodeId) && "$prop" in nodeId && nodeId.default === undefined && !alwaysPresent(scope, String(nodeId.$prop));
      if (nodeId === undefined || mayBeAbsent) issues.push(`${at}: '${id}' needs an id, because a profile join keys on it`);
    }
    if (node.props !== undefined && isObject(node.props)) {
      const declared = isObject(components[id]?.props) ? (components[id]!.props as Record<string, Json>) : {};
      const entries = Object.entries(node.props);
      if (Object.keys(declared).length === 0) {
        if (entries.length > 0) issues.push(`${at}.props: '${id}' declares no props`);
      } else {
        for (const [key, value] of entries) {
          const descriptor = Object.hasOwn(declared, key) ? declared[key] : undefined;
          if (!descriptor) {
            issues.push(`${at}.props.${key}: '${id}' has no prop '${key}'`);
            continue;
          }
          const allowed = enumValues(descriptor);
          if (allowed) checkEnumValue(value, allowed, `${at}.props.${key}`, scope);
        }
      }
    }
    if (Array.isArray(node.children)) walkChildren(node.children as TemplateChild[], `${at}.children`, scope);
  };

  const walkChildren = (children: TemplateChild[], at: string, scope: Scope) => {
    children.forEach((child, i) => {
      const entry = child as Json;
      const path = `${at}.${i}`;
      if ("$each" in entry) {
        const items = specAtPath(scope, String(entry.$each))?.items;
        const inner: Scope = new Map(scope);
        if (items) inner.set(String(entry.as), { spec: items, loop: true });
        walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, inner);
      } else if ("$if" in entry) {
        walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, scope);
        walkChildren((entry.else ?? []) as TemplateChild[], `${path}.else`, scope);
      } else {
        walkNode(entry, path, scope);
      }
    });
  };

  walkNode(block.template as unknown as Json, "template", rootScope(block));
  issues.push(...actionIssues(block, view.actionComponents));
  return issues;
}

export interface LoadedBlocks {
  /** ok: bound to this base; mismatch: the base moved; invalid: the sidecar does not parse. */
  binding: "ok" | "mismatch" | "invalid";
  sidecar?: BlocksSidecar;
  /** Blocks that bound and passed B0, in sidecar order. */
  usable: BlockDefinition[];
  /** Blocks disabled at load, with their B0 reasons. */
  disabled: Array<{ block: string; issues: string[] }>;
  /** Sidecar-level reasons (parse issues, binding mismatch). */
  issues: string[];
}

/** Parse, bind and B0-check a sidecar against the packaged base contract. */
export async function loadBlocks(raw: unknown, options: { baseContract: Json; profile?: Profile }): Promise<LoadedBlocks> {
  const parsed = parseBlocksSidecar(raw);
  if (!parsed.ok) {
    return { binding: "invalid", usable: [], disabled: [], issues: parsed.issues.map((i) => `${i.path}: ${i.message}`) };
  }
  const sidecar = parsed.sidecar;
  const digest = await contractDigest(options.baseContract);
  if (digest !== sidecar.baseSha256) {
    return {
      binding: "mismatch",
      sidecar,
      usable: [],
      disabled: [],
      issues: [`bound to base ${sidecar.baseSha256.slice(0, 12)}, but the packaged base is ${digest.slice(0, 12)}; re-bind the sidecar`],
    };
  }
  const view = generationView(options.baseContract, options.profile);
  const usable: BlockDefinition[] = [];
  const disabled: LoadedBlocks["disabled"] = [];
  for (const block of sidecar.blocks) {
    const issues = b0Issues(block, view);
    if (issues.length > 0) disabled.push({ block: block.id, issues });
    else usable.push(block);
  }
  return { binding: "ok", sidecar, usable, disabled, issues: [] };
}

/** Every A2UI action name a set of emitted messages can dispatch. */
export function emittedActionNames(messages: unknown): string[] {
  const out = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (isObject(value)) {
      const event = value.event;
      if (isObject(event) && typeof event.name === "string") out.add(event.name);
      Object.values(value).forEach(walk);
    }
  };
  walk(messages);
  return [...out].sort();
}

export type EmitCheck = { ok: true; actions: string[] } | { ok: false; refusal: string };

/** Emit under the reference profile. A refusal is reported, never thrown. */
export function emitCheck(surface: unknown, contract: Json, profile?: Profile): EmitCheck {
  try {
    const { messages } = emitSurface(surface as never, contract as never, profile ? { profile } : {});
    return { ok: true, actions: emittedActionNames(messages) };
  } catch (error) {
    return { ok: false, refusal: (error instanceof Error ? error.message : String(error)).trim().slice(0, 600) || "refused" };
  }
}

/** B2's second half: the expansion dispatches only the block's declared actions. */
export function checkActions(block: Pick<BlockDefinition, "id" | "actions">, actions: readonly string[]): CallIssue[] {
  return actions
    .filter((a) => !block.actions.includes(a))
    .map((a) => ({ path: "actions", message: `emitted action '${a}' is not declared by ${block.id}` }));
}
