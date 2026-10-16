/**
 * The beta's block switch (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 4;
 * docs/deployment.md, "The beta composer").
 *
 * The beta Worker's BLOCKS_BETA variable, set in the Cloudflare dashboard,
 * holds strict JSON naming what the beta offers, for example
 *   {"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}
 * GET /api/models reports it, normalized, as its `blocks` field, and the
 * experimental client reads that before every build. Exactly the three fields,
 * each once; references from BETA_REFERENCES and blocks from BETA_BLOCKS, each
 * named once, and at least one of each when enabled. Text must be exactly the
 * switch it parses to, whitespace aside, so a repeated field (JSON.parse keeps
 * the last) is malformed. Anything else is malformed, and malformed, like
 * enabled false, turns blocks off. Without the variable there is no field:
 * production's reply is unchanged.
 *
 * The beta offers Astryx only: the owner chose branch C, which withholds
 * shadcn/ui v3 blocks while their evaluation is inconclusive
 * (docs/blocks/PHASE-2-DECISION-RECORD.md). Offering another reference is a
 * code change here, never a variable.
 */

export const BETA_REFERENCES = Object.freeze(["astryx"]);
/** The Astryx sidecar's approved blocks (apps/composer/experimental/blocks/astryx.blocks.json). */
export const BETA_BLOCKS = Object.freeze(["records-table", "auth-form", "guide-steps"]);

const FIELDS = ["enabled", "references", "blocks"];
const MALFORMED = Object.freeze({ enabled: false, reason: "malformed" });
const DISABLED = Object.freeze({ enabled: false, reason: "disabled" });

const plainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Distinct strings, each one of `allowed`. */
const allowedList = (value, allowed) =>
  Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.includes(v)) && new Set(value).size === value.length;

/**
 * The switch to report, or undefined when the variable is not set. Never
 * echoes what a malformed variable held.
 */
export function blocksBetaFor(env) {
  const raw = env?.BLOCKS_BETA;
  if (raw === undefined) return undefined;
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return MALFORMED;
    }
  }
  if (!plainObject(value)) return MALFORMED;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== FIELDS.length || !FIELDS.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return MALFORMED;
  if (typeof value.enabled !== "boolean") return MALFORMED;
  if (!allowedList(value.references, BETA_REFERENCES) || !allowedList(value.blocks, BETA_BLOCKS)) return MALFORMED;
  // The ids allowed hold no whitespace, so all whitespace in the text lies
  // between tokens; what remains must be the parsed switch, written back.
  if (typeof raw === "string" && raw.replace(/\s+/g, "") !== JSON.stringify(value)) return MALFORMED;
  if (!value.enabled) return DISABLED;
  if (value.references.length === 0 || value.blocks.length === 0) return MALFORMED;
  return { enabled: true, references: [...value.references], blocks: [...value.blocks] };
}
