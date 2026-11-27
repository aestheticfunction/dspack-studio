/**
 * Composition authoring, the first increment (M1 authoring A1 to A4): create and discard a draft, edit a
 * draft's details, parameters and examples, run its checks, and approve it on this device.
 *
 * Nothing here is a second editor, schema or pipeline. Drafts are forked and edited with editComposition,
 * approved with approveDraft and discarded with discardDraft (composer-core versions.ts); every edited
 * definition is validated by the same loader a packaged composition goes through (definitionIssues); checks
 * are recheck; and the only things written are the workspace's own validated records (storage.ts).
 *
 * Approval is all or nothing. The approved definition hashes differently from the draft (its status is part
 * of it), so it is re-checked under the packaged rules before anything is written, and it is exposed only
 * after the one write that records it succeeded. A failed re-check or write changes nothing.
 */
import {
  approvalRecord,
  approveDraft,
  discardDraft,
  editComposition,
  pinsFor,
  recheck,
  samePins,
  validateInstanceInput,
  versionKey,
  type Approval,
  type CompositionDefinition,
  type Governor,
  type Scenario,
  type ScenarioResult,
} from "@dspack-studio/composer-core/compositions";
import { interactionIssues } from "./interaction";
import { definitionIssues, type LoadedLibrary, type VersionCheck } from "./runtime";
import { readRecord, withApproval, writeRecord, type KeyValueStore } from "./storage";

type Json = Record<string, any>;

export type AuthoringResult = { ok: true; loaded: LoadedLibrary; version: number; warning?: string } | { ok: false; reason: string };

const keyOf = (c: CompositionDefinition) => versionKey(c.id, c.version);

/** Rebuild the loaded library around a new library, with the stored drafts and device versions as now held. */
function withLibrary(loaded: LoadedLibrary, library: LoadedLibrary["library"], stored: Partial<LoadedLibrary["stored"]>, origin?: Map<string, "packaged" | "device">): LoadedLibrary {
  return { ...loaded, library, origin: origin ?? loaded.origin, stored: { ...loaded.stored, ...stored } };
}

function draftsWith(loaded: LoadedLibrary, draft: CompositionDefinition): CompositionDefinition[] {
  return [...loaded.stored.drafts.filter((d) => keyOf(d) !== keyOf(draft)), draft];
}

/** A1: a draft of an approved version, numbered above every version of its composition. */
export async function createDraft(loaded: LoadedLibrary, id: string, store: KeyValueStore | null): Promise<AuthoringResult> {
  const entry = loaded.library.entry(id);
  if (!entry) return { ok: false, reason: `no composition '${id}'` };
  if (entry.draft) return { ok: false, reason: `draft v${entry.draft.version} already exists; open it to keep editing` };
  if (!entry.approved) return { ok: false, reason: "there is no approved version to start a draft from" };
  const r = editComposition(loaded.library, id, entry.approved.version, () => {});
  if (!r.ok) return { ok: false, reason: r.reason };
  const drafts = draftsWith(loaded, r.draft);
  const written = writeRecord("drafts", { drafts: drafts.map((d) => structuredClone(d)) }, store);
  const origin = new Map(loaded.origin).set(keyOf(r.draft), "device");
  return { ok: true, loaded: withLibrary(loaded, r.library, { drafts }, origin), version: r.draft.version, ...(written.ok ? {} : { warning: `The draft is kept for this session only: ${written.reason}.` }) };
}

/**
 * A2: one edit to a draft. The edit receives a mutable copy; the result is validated by the packaged loader
 * and refused, with the reason, if it is not a valid composition. A valid edit replaces the draft and is
 * stored at once. Approved versions are never edited here: editComposition would fork, and this refuses that.
 */
export async function editDraft(loaded: LoadedLibrary, id: string, version: number, edit: (draft: CompositionDefinition) => void, store: KeyValueStore | null): Promise<AuthoringResult> {
  const target = loaded.library.get(id, version);
  if (!target || target.status !== "draft") return { ok: false, reason: "only a draft can be edited; create a draft first" };
  const r = editComposition(loaded.library, id, version, edit);
  if (!r.ok) return { ok: false, reason: r.reason };
  const issues = await definitionIssues(r.draft);
  if (issues.length > 0) return { ok: false, reason: issues[0]! };
  const drafts = draftsWith(loaded, r.draft);
  const written = writeRecord("drafts", { drafts: drafts.map((d) => structuredClone(d)) }, store);
  const origin = new Map(loaded.origin).set(keyOf(r.draft), "device");
  return { ok: true, loaded: withLibrary(loaded, r.library, { drafts }, origin), version, ...(written.ok ? {} : { warning: `This edit is kept for this session only: ${written.reason}.` }) };
}

/** A1: discard a draft. A packaged draft is withdrawn on this device only; approved versions are untouched. */
export async function discardDraftVersion(loaded: LoadedLibrary, id: string, version: number, store: KeyValueStore | null): Promise<AuthoringResult> {
  const r = discardDraft(loaded.library, id, version);
  if (!r.ok) return { ok: false, reason: r.reason };
  const key = versionKey(id, version);
  const drafts = loaded.stored.drafts.filter((d) => keyOf(d) !== key);
  const packaged = loaded.packaged.some((c) => keyOf(c) === key);
  const retired = packaged && !loaded.stored.retired.includes(key) ? [...loaded.stored.retired, key] : loaded.stored.retired;
  // Withdraw a packaged draft first: if that cannot be recorded, nothing is discarded.
  if (retired !== loaded.stored.retired) {
    const w = writeRecord("versions", { approved: loaded.stored.approved.map((c) => structuredClone(c)), retired }, store);
    if (!w.ok) return { ok: false, reason: `the draft was not discarded: ${w.reason}` };
  }
  const written = writeRecord("drafts", { drafts: drafts.map((d) => structuredClone(d)) }, store);
  const origin = new Map(loaded.origin);
  origin.delete(key);
  return { ok: true, loaded: withLibrary(loaded, r.library, { drafts, retired }, origin), version, ...(written.ok ? {} : { warning: `Discarded for this session; ${written.reason}.` }) };
}

/** Whether a check is the passing check of exactly this definition under these rules: what approval needs. */
export async function checkIsCurrent(governor: Governor, definition: CompositionDefinition, check: VersionCheck | undefined): Promise<boolean> {
  if (!check?.approval || check.definition !== definition) return false;
  return samePins(check.approval.pins, await pinsFor(governor, definition));
}

export type ApproveResult =
  | { ok: true; loaded: LoadedLibrary; approved: CompositionDefinition; approval: Approval; scenarios: ScenarioResult[]; warning?: string }
  | { ok: false; reason: string };

/**
 * A4: a person approves a checked draft on this device.
 *
 * Refused unless the draft's latest check passed for exactly this definition under these rules (a stale
 * pass never approves). The approved definition is re-checked under the same rules; only if that passes is
 * it written, in one write of the versions record. Only then is it exposed. The leftover draft copy is
 * removed afterwards; if that removal cannot be written, loading ignores the copy (runtime.ts).
 */
export async function approveVersion(loaded: LoadedLibrary, governor: Governor, id: string, version: number, check: VersionCheck | undefined, store: KeyValueStore | null): Promise<ApproveResult> {
  const draft = loaded.library.get(id, version);
  if (!draft || draft.status !== "draft") return { ok: false, reason: "only a draft can be approved" };
  if (!(await checkIsCurrent(governor, draft, check))) return { ok: false, reason: "run the checks on this exact draft first; approval needs a passing check of the current version" };
  // A private field must be masked on screen before a version that takes it is approved (interaction.ts).
  const blocking = interactionIssues(draft);
  if (blocking.length > 0) return { ok: false, reason: blocking[0]!.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) };
  const r = approveDraft(loaded.library, id, version);
  if (!r.ok) return { ok: false, reason: r.reason };
  const again = await recheck(governor, r.approved);
  if (!again.approval) return { ok: false, reason: "the approved version did not pass its own re-check, so nothing was approved" };
  const key = versionKey(id, version);
  const retired = loaded.packaged.some((c) => keyOf(c) === key) && !loaded.stored.retired.includes(key) ? [...loaded.stored.retired, key] : loaded.stored.retired;
  const approved = [...loaded.stored.approved.filter((c) => keyOf(c) !== key), r.approved];
  const written = writeRecord("versions", { approved: approved.map((c) => structuredClone(c)), retired }, store);
  if (!written.ok) return { ok: false, reason: `nothing was approved: ${written.reason}` };
  const drafts = loaded.stored.drafts.filter((d) => keyOf(d) !== key);
  const cleaned = writeRecord("drafts", { drafts: drafts.map((d) => structuredClone(d)) }, store);
  // Evidence only (versions.ts): the record of this check, never an authorization.
  const evidence = readRecord("approvals", store);
  if (evidence.status !== "incompatible") writeRecord("approvals", withApproval(evidence.value, approvalRecord(again.approval)), store);
  const origin = new Map(loaded.origin).set(key, "device");
  return {
    ok: true,
    loaded: withLibrary(loaded, r.library, { drafts, approved, retired }, origin),
    approved: r.approved,
    approval: again.approval,
    scenarios: again.scenarios,
    ...(cleaned.ok ? {} : { warning: "The approved version is recorded; the old draft copy could not be removed and will be ignored." }),
  };
}

// ---- Examples (scenarios) -------------------------------------------------------------------------------------

/** "Two hotels, one sold out" -> "two-hotels-one-sold-out"; unique among the ids given. */
export function exampleId(title: string, taken: Iterable<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "example";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** A starting value for each declared data field: empty, but of the declared shape. */
export function emptyData(specs: Json[]): Json {
  const out: Json = {};
  for (const spec of specs) {
    if (!spec.required) continue;
    out[spec.name] = emptyValue(spec);
  }
  return out;
}

export function emptyValue(spec: Json): unknown {
  switch (spec.type) {
    case "string":
      return "";
    case "integer":
      return typeof spec.minimum === "number" ? spec.minimum : 0;
    case "boolean":
      return false;
    case "enum":
      return spec.values?.[0] ?? "";
    case "array":
      return [];
    case "object":
      return emptyData(spec.props ?? []);
    default:
      return null;
  }
}

/** The refusals an example may expect: the contract's rules, and the pipeline stages a designer can cause. */
export function refusalOptions(contract: Json): Array<{ value: string; label: string }> {
  const rules = ((contract.rules ?? []) as Json[]).map((r) => ({ value: String(r.id), label: String(r.id) }));
  return [...rules, { value: "data", label: "data" }, { value: "state", label: "state" }];
}

/**
 * What is wrong with an example before it is checked, in a designer's words: its data against the declared
 * fields, its expected refusal against the contract, and its state against the composition.
 */
export function exampleIssues(definition: CompositionDefinition, scenario: Scenario, contract: Json): string[] {
  const issues: string[] = [];
  for (const i of validateInstanceInput(definition, {}, scenario.data as Json)) issues.push(plainDataIssue(i));
  if (scenario.expect === "refused") {
    if (!scenario.refusedBy) issues.push("Choose the rule that should refuse this example.");
    else if (!refusalOptions(contract).some((o) => o.value === scenario.refusedBy)) issues.push(`“${scenario.refusedBy}” is not a rule of this design system.`);
  }
  if (scenario.state && !definition.states.some((s) => s.id === scenario.state)) issues.push(`There is no “${scenario.state}” state.`);
  return issues;
}

/** "$.hotels[0].price: must be >= 1" or "$.errors.0: shorter than 1" -> "Hotels, item 1, price: …". */
export function plainDataIssue(issue: string): string {
  const cut = issue.indexOf(": ");
  const path = cut > 0 ? issue.slice(0, cut) : "";
  const message = cut > 0 ? plainMessage(issue.slice(cut + 2)) : plainMessage(issue);
  const words = path
    .replace(/^\$\.?/, "")
    .split(/\.|(?=\[)/)
    .filter(Boolean)
    .map((part) => {
      const index = /^\[?(\d+)\]?$/.exec(part);
      return index ? `item ${Number(index[1]) + 1}` : part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
    });
  const where = words.join(", ");
  return where ? `${where.charAt(0).toUpperCase()}${where.slice(1)}: ${message}` : message;
}

/** The validator's terse messages, said as a designer would read them. Unknown messages pass through. */
function plainMessage(m: string): string {
  return m
    .replace(/^shorter than (\d+)$/, (_, n) => (n === "1" ? "is empty; it needs some text" : `needs at least ${n} characters`))
    .replace(/^longer than (\d+)$/, (_, n) => `is longer than ${n} characters`)
    .replace(/^below (-?\d+)$/, (_, n) => `must be at least ${n}`)
    .replace(/^above (-?\d+)$/, (_, n) => `must be at most ${n}`)
    .replace(/^expected an integer$/, "needs a whole number")
    .replace(/^required$/, "is required")
    .replace(/^'([^']+)' is not declared$/, (_, k) => `“${k}” is not one of this composition's fields`)
    .replace(/^expected a string$/, "needs text")
    .replace(/^expected one of (.+)$/, (_, v) => `must be one of: ${v}`)
    .replace(/^fewer than (\d+) items?$/, (_, n) => `needs at least ${n} ${n === "1" ? "item" : "items"}`)
    .replace(/^more than (\d+) items?$/, (_, n) => `allows at most ${n} items`);
}

/** A data refusal's reason ("data: $.a: x; $.b: y") as plain sentences. */
export function plainDataReason(reason: string | undefined): string[] {
  if (!reason) return [];
  return reason
    .replace(/^data:\s*/, "")
    .split(/;\s*/)
    .filter(Boolean)
    .map(plainDataIssue);
}
