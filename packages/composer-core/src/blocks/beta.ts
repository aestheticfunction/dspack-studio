/**
 * Interface blocks (experimental): the beta's runtime switch
 * (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 4).
 *
 * The beta Worker reads its BLOCKS_BETA variable and reports it, normalized,
 * as the `blocks` field of its /api/models reply
 * (apps/composer/worker/blocks-beta.mjs):
 * - on:  { enabled: true, references: [...], blocks: [...] }
 * - off: { enabled: false, reason: "disabled" | "malformed" }
 * Production's Worker has no such variable, and its reply has no such field.
 *
 * The experimental client reads that reply before every build. Anything but a
 * well-formed switch naming known references and blocks fails closed: no
 * blocks, with a reason the build's note shows.
 */
import type { BlockDefinition } from "./schema";

export type BlocksBetaOff = "missing" | "unreadable" | "malformed" | "disabled";

export type BlocksBetaSwitch =
  | { readonly state: "on"; readonly references: readonly string[]; readonly blocks: readonly string[] }
  | { readonly state: "off"; readonly reason: BlocksBetaOff };

/** Why the switch offered a build nothing. */
export type BlocksBetaReason = `beta-switch-${BlocksBetaOff}` | "reference-not-in-beta" | "no-blocks-in-beta";

/** The ids the client knows: its packaged references, and the blocks their sidecars define. */
export interface BlocksBetaKnown {
  references: readonly string[];
  blocks: readonly string[];
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Exactly these own keys, no others (an own "__proto__" key included). */
const hasExactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

/** A list of distinct strings, each one of `known`. */
const knownList = (value: unknown, known: readonly string[]): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string" && known.includes(v)) && new Set(value).size === value.length;

const OFF_REASONS: readonly BlocksBetaOff[] = ["disabled", "malformed"];

/** The switch in an /api/models reply body, already parsed from JSON. */
export function parseBlocksBeta(reply: unknown, known: BlocksBetaKnown): BlocksBetaSwitch {
  if (!plainObject(reply)) return { state: "off", reason: "unreadable" };
  if (!Object.prototype.hasOwnProperty.call(reply, "blocks")) return { state: "off", reason: "missing" };
  const value = reply.blocks;
  const malformed = { state: "off", reason: "malformed" } as const;
  if (!plainObject(value)) return malformed;
  if (value.enabled === true && hasExactly(value, ["enabled", "references", "blocks"])) {
    if (!knownList(value.references, known.references) || !knownList(value.blocks, known.blocks)) return malformed;
    return { state: "on", references: [...value.references], blocks: [...value.blocks] };
  }
  if (value.enabled === false && hasExactly(value, ["enabled", "reason"]) && OFF_REASONS.includes(value.reason as BlocksBetaOff)) {
    return { state: "off", reason: value.reason as BlocksBetaOff };
  }
  return malformed;
}

/**
 * What a reference's eligible blocks come to under the switch: only a listed
 * reference is offered anything, and only the listed blocks, in sidecar order.
 */
export function gateBlocksBeta(
  blocks: readonly BlockDefinition[],
  referenceId: string,
  sw: BlocksBetaSwitch,
): { blocks: BlockDefinition[]; reason: BlocksBetaReason | null } {
  if (sw.state === "off") return { blocks: [], reason: `beta-switch-${sw.reason}` };
  if (!sw.references.includes(referenceId)) return { blocks: [], reason: "reference-not-in-beta" };
  const listed = blocks.filter((b) => sw.blocks.includes(b.id));
  return listed.length > 0 ? { blocks: listed, reason: null } : { blocks: [], reason: "no-blocks-in-beta" };
}
