/**
 * Enum values, read once.
 *
 * A dspack v0.4 enum prop's `values` may be bare values (`["sm","md"]`) or
 * value descriptor objects (`[{ value: "sm", description: "…" }]`). BOTH are
 * spec-valid, and the shipped shadcn contract uses the rich form throughout —
 * so every reader that assumes strings prints "[object Object]" at the user,
 * and every writer that emits strings puts a second shape for the same idea
 * into the same catalog.
 *
 * `enumMembers` is that one reader. It mirrors dspack-gen's `enumValues()`
 * (the canonical unwrap: `v.value` when the member is an object, the member
 * otherwise) and keeps the per-value description, which that reader
 * deliberately discards because generation has no use for it and a UI does.
 *
 * `parseEnumValues` is the matching writer: authoring produces the descriptor
 * form the contract already uses. Neither the contract nor the schema changes
 * — value descriptors require only `value` (dspack.v0.4 §valueDescriptor).
 */

/** One allowed value of an enum prop, in the shape a UI can render. */
export interface EnumMember {
  value: string;
  /** When to choose this value, when the contract says. */
  description?: string;
}

/** One member's text, whichever shape it arrived in. */
export function enumLabel(member: unknown): string {
  if (member && typeof member === "object" && "value" in member) return String((member as { value: unknown }).value);
  return String(member);
}

/**
 * The allowed values of a prop descriptor, or [] for anything that is not a
 * populated enum (a missing `values`, a non-array, a non-enum prop, a
 * descriptor carrying no value). Empty-safe by construction: a catalog page
 * renders whatever the contract holds, including a half-authored entry.
 */
export function enumMembers(prop: unknown): EnumMember[] {
  if (!prop || typeof prop !== "object") return [];
  const { type, values } = prop as { type?: unknown; values?: unknown };
  if (type !== "enum" || !Array.isArray(values)) return [];
  const members: EnumMember[] = [];
  for (const member of values) {
    if (member && typeof member === "object") {
      const { value, description } = member as { value?: unknown; description?: unknown };
      if (value === undefined || value === null) continue; // a descriptor with no value is not a value
      members.push({ value: String(value), ...(typeof description === "string" && description ? { description } : {}) });
      continue;
    }
    if (member === undefined || member === null) continue;
    members.push({ value: String(member) });
  }
  return members;
}

/** The values authored in the catalog's comma-separated field, as descriptors. */
export function parseEnumValues(input: string): EnumMember[] {
  const seen = new Set<string>();
  const members: EnumMember[] = [];
  for (const raw of input.split(",")) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    members.push({ value });
  }
  return members;
}
