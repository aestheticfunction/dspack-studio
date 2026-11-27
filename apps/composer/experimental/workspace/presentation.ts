/**
 * Presentation labels for the packaged sample compositions (D0, D0.1): the words a designer reads, kept
 * beside the definitions rather than in them. Approved versions cannot change (their hashes are pinned), so
 * their human wording lives here; a definition's own words, as authoring will write them, always win.
 *
 * Nothing here is consulted by governance: the contract, the rules and the host never see these labels.
 */

/** Human names for the examples of the packaged approved versions. A scenario's own `title` wins. */
export const SAMPLE_NAMES: Record<string, Record<string, string>> = {
  "hotel-search": { ready: "An empty search", invalid: "A search with an error" },
  "hotel-results": { three: "Three hotels", two: "Two hotels", one: "One hotel", none: "No hotels found", confirm: "Confirm a reservation" },
};

/**
 * The plain-language lead for a refusal by a design rule, keyed by rule id. The contract's own rationale and
 * the rule id stay available under Technical details; without an entry here, the rationale leads.
 */
export const RULE_LEADS: Record<string, string> = {
  "rule.review-offers-alternatives": "A comparison needs at least two options to choose from.",
};

/**
 * What a draft changes relative to the approved version it follows, keyed `id@version`. `paths` are the
 * definition paths the summary accounts for: a unit test holds them equal to the actual difference between
 * the two definitions, so the summary cannot drift from what changed.
 */
export const VERSION_CHANGES: Record<string, { paths: string[]; summary: string[] }> = {
  "hotel-results@2": {
    paths: [
      "/states[2]/template/children[1]/text/$concat[1]",
      "/states[2]/template/children[3]/props/label",
      "/scenarios[0]/title",
      "/scenarios[1]/title",
      "/scenarios[2]/title",
      "/scenarios[3]/title",
      "/scenarios[4]/title",
    ],
    summary: [
      "The note under the title reads “Prices are per night, before taxes.” instead of “Compare and choose one.”",
      "The “New search” button reads “Change search”.",
      "The examples’ names are stored in the draft itself. They read the same as before.",
    ],
  },
};

/**
 * Every leaf path at which two definitions differ, ignoring `version` and `status` (which always differ
 * between a draft and the approved version it follows).
 */
export function definitionDifferences(a: unknown, b: unknown): string[] {
  const leaves = (value: unknown, path: string, out: Map<string, string>) => {
    if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) leaves(v, `${path}/${k}`, out);
    else out.set(path, JSON.stringify(value));
    return out;
  };
  const left = leaves(a, "", new Map());
  const right = leaves(b, "", new Map());
  return [...new Set([...left.keys(), ...right.keys()])].filter((p) => p !== "/version" && p !== "/status" && left.get(p) !== right.get(p)).sort();
}
