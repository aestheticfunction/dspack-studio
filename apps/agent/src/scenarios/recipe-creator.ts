/**
 * Recipe creator: the second interactive scenario, deterministic and local.
 * Exercises component-level co-editing beyond data-model patches: servings
 * changes and constraint swaps re-deliver the ingredients table and badge
 * via updateComponents, while status/servings ride the shared data model.
 *
 * State schema:
 *   /recipe/servings    number
 *   /recipe/constraint  string ("" | vegetarian | vegan | gluten-free)
 *   /recipe/status      string (bound status Text)
 *   /recipe/variant     number (regeneration counter)
 *
 * Actions (correlation-id'd, idempotent at the server):
 *   change_servings {delta}        clamps 1..12; rescales the table
 *   apply_constraint {constraint}  validates against the known set; unknown -> REJECTED (recoverable)
 *   regenerate {}                  next deterministic variant
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ActionResponse } from "./appointment-booking.js";

const require = createRequire(import.meta.url);
const SURFACE_ID = "structured_editing";
const DM = (path: string, value: unknown) => ({ version: "v0.9", updateDataModel: { surfaceId: SURFACE_ID, path, value } });

/** Server-side session state per surface (deterministic; cleared on start). */
const sessions = new Map<string, { servings: number; constraint: string; variant: number }>();
const session = (id: string) => sessions.get(id) ?? { servings: 2, constraint: "", variant: 0 };

type Ingredient = { name: string; perServing: number; unit: string; tags: string[] };
const VARIANTS: Array<{ title: string; ingredients: Ingredient[] }> = [
  {
    title: "Weeknight pasta",
    ingredients: [
      { name: "Spaghetti", perServing: 90, unit: "g", tags: [] },
      { name: "Pancetta", perServing: 40, unit: "g", tags: ["meat"] },
      { name: "Parmesan", perServing: 25, unit: "g", tags: ["dairy"] },
      { name: "Cherry tomatoes", perServing: 120, unit: "g", tags: [] },
    ],
  },
  {
    title: "Lemon herb risotto",
    ingredients: [
      { name: "Arborio rice", perServing: 80, unit: "g", tags: [] },
      { name: "Chicken stock", perServing: 250, unit: "ml", tags: ["meat"] },
      { name: "Butter", perServing: 15, unit: "g", tags: ["dairy"] },
      { name: "Lemon", perServing: 0.5, unit: "", tags: [] },
    ],
  },
];
const SWAPS: Record<string, Record<string, string>> = {
  vegetarian: { Pancetta: "Smoked tofu", "Chicken stock": "Vegetable stock" },
  vegan: { Pancetta: "Smoked tofu", Parmesan: "Nutritional yeast", "Chicken stock": "Vegetable stock", Butter: "Olive oil" },
  "gluten-free": { Spaghetti: "GF spaghetti" },
};
const CONSTRAINTS = Object.keys(SWAPS);

function tableRows(variant: number, servings: number, constraint: string) {
  return VARIANTS[variant % VARIANTS.length].ingredients.map((ing) => {
    const name = SWAPS[constraint]?.[ing.name] ?? ing.name;
    const amount = ing.unit ? `${Math.round(ing.perServing * servings * 10) / 10} ${ing.unit}` : `${ing.perServing * servings}`;
    return { cells: [name, amount] };
  });
}

/**
 * Where the responder's component updates land. Authored-surface ids by
 * default (the deterministic start path); the enhancer retargets each slot
 * to the GENERATED surface's unambiguous counterpart, so co-edits reach the
 * components that actually exist instead of orphaning on authored ids.
 */
const AUTHORED_TARGETS = { title: "title", badge: "diet_badge", servingsLabel: "servings_label", table: "ingredients" };
let updateTargets = { ...AUTHORED_TARGETS };

/** updateComponents delivery for the recipe's mutable components. */
function recipeComponentsOps(variant: number, servings: number, constraint: string) {
  return [
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          { id: updateTargets.title, component: "Text", variant: "h2", text: VARIANTS[variant % VARIANTS.length].title },
          { id: updateTargets.badge, component: "Badge", label: constraint || "no constraints", variant: constraint ? "success" : "neutral" },
          { id: updateTargets.servingsLabel, component: "Text", variant: "body", text: `Servings: ${servings}` },
          { id: updateTargets.table, component: "Table", columns: ["Ingredient", "Amount"], data: tableRows(variant, servings, constraint), density: "compact" },
        ],
      },
    },
  ];
}

/** Fresh scenario state: sessions gone, updates back on authored ids. */
export function resetRecipeSessions(): void {
  sessions.clear();
  updateTargets = { ...AUTHORED_TARGETS };
}

/**
 * FM-3 continuation: restore the grounding a fork's prefix recorded (the
 * studio.surface.enhanced event carries it), so co-edits on the forked run
 * land on the same generated components the original run targeted.
 */
export function restoreRecipeGrounding(grounding: unknown): void {
  const targets = (grounding as { targets?: Partial<typeof AUTHORED_TARGETS> } | undefined)?.targets;
  if (targets) updateTargets = { ...AUTHORED_TARGETS, ...targets };
}

export function recipeStartOps(): unknown[] {
  // A fresh scenario start is a fresh session — deterministic across runs.
  resetRecipeSessions();
  const path = require.resolve("@dspack-studio/contracts/out/recipe-creator.surface.json");
  const emitted = JSON.parse(readFileSync(path, "utf8")) as { messages: any[] };
  const messages = structuredClone(emitted.messages);
  for (const m of messages) {
    for (const c of m?.updateComponents?.components ?? []) {
      if (c.id === "constraint_input") c.value = { path: "/recipe/constraint" };
      if (c.id === "status") c.text = { path: "/recipe/status" };
      if (c.id === "servings_down") c.action = { event: { name: "change_servings", context: { delta: -1 } } };
      if (c.id === "servings_up") c.action = { event: { name: "change_servings", context: { delta: 1 } } };
      if (c.id === "apply_constraint") c.action = { event: { name: "apply_constraint", context: { constraint: { path: "/recipe/constraint" } } } };
      if (c.id === "regenerate") c.action = { event: { name: "regenerate" } };
    }
  }
  messages.push(...recipeComponentsOps(0, 2, ""));
  messages.push(DM("/recipe", { servings: 2, constraint: "", status: "Edit servings or add a constraint.", variant: 0 }));
  return messages;
}



export function recipeRespond(name: string, context: Record<string, unknown>, sessionId = "default"): ActionResponse {
  const s = session(sessionId);
  switch (name) {
    case "change_servings": {
      const next = Math.max(1, Math.min(12, s.servings + Number(context.delta ?? 0)));
      if (next === s.servings) {
        return { outcome: "rejected", detail: `servings stay within 1–12 (already ${s.servings})`, ops: [DM("/recipe/status", `Servings stay within 1–12.`)] };
      }
      sessions.set(sessionId, { ...s, servings: next });
      return {
        outcome: "accepted",
        ops: [...recipeComponentsOps(s.variant, next, s.constraint), DM("/recipe/servings", next), DM("/recipe/status", `Scaled to ${next} servings.`)],
      };
    }
    case "apply_constraint": {
      const constraint = String(context.constraint ?? "").trim().toLowerCase();
      if (!CONSTRAINTS.includes(constraint)) {
        return {
          outcome: "rejected",
          detail: `unknown constraint '${constraint || "(empty)"}' — try ${CONSTRAINTS.join(", ")}`,
          ops: [DM("/recipe/status", `Unknown constraint. Try: ${CONSTRAINTS.join(", ")}.`)],
        };
      }
      sessions.set(sessionId, { ...s, constraint });
      return {
        outcome: "accepted",
        ops: [
          ...recipeComponentsOps(s.variant, s.servings, constraint),
          DM("/recipe/constraint", constraint),
          DM("/recipe/status", `Applied ${constraint}: ingredients swapped where needed.`),
        ],
      };
    }
    case "regenerate": {
      const variant = (s.variant + 1) % VARIANTS.length;
      sessions.set(sessionId, { ...s, variant });
      return {
        outcome: "accepted",
        ops: [
          ...recipeComponentsOps(variant, s.servings, s.constraint),
          DM("/recipe/variant", variant),
          DM("/recipe/status", `Regenerated: ${VARIANTS[variant].title}.`),
        ],
      };
    }
    default:
      return { outcome: "rejected", detail: `unknown action '${name}'`, ops: [] };
  }
}

/**
 * Deterministic enhancement of a GENERATED structured-editing delivery.
 * Unambiguous grounding only: single TextField -> /recipe/constraint;
 * single caption Text -> /recipe/status; single primary Button ->
 * regenerate; single constraint-labeled non-primary Button ->
 * apply_constraint. Servings buttons are NOT grounded (no validated semantic
 * distinguishes +/- deltas on arbitrary generated labels); their synthesized
 * actions resolve as unsupported — clearly, in the stream.
 */
export function enhanceGeneratedRecipeOps(ops: any[]): { ops: any[]; notes: string[]; grounding: { targets: typeof AUTHORED_TARGETS } } {
  const out = structuredClone(ops);
  const notes: string[] = [];
  const components = out.flatMap((m: any) => m?.updateComponents?.components ?? []);
  const textFields = components.filter((c: any) => c.component === "TextField");
  if (textFields.length === 1) {
    textFields[0].value = { path: "/recipe/constraint" };
    notes.push(`bound the single TextField '${textFields[0].id}' to /recipe/constraint`);
  }
  const captions = components.filter((c: any) => c.component === "Text" && c.variant === "caption");
  if (captions.length === 1) {
    captions[0].text = { path: "/recipe/status" };
    notes.push(`bound the single caption Text '${captions[0].id}' to /recipe/status`);
  }
  const primaries = components.filter((c: any) => c.component === "Button" && c.variant === "primary");
  if (primaries.length === 1) {
    primaries[0].action = { event: { name: "regenerate" } };
    notes.push(`grounded the single primary Button '${primaries[0].id}' as regenerate`);
  }
  // Validated label semantics (the slotFromLabel precedent): exactly one
  // non-primary button whose label names the constraint. "Single secondary"
  // alone is not a usable signal — the worked example itself carries three.
  const applyBtns = components.filter(
    (c: any) => c.component === "Button" && c.variant !== "primary" && /constraint/i.test(String(c.label ?? "")),
  );
  if (applyBtns.length === 1) {
    applyBtns[0].action = { event: { name: "apply_constraint", context: { constraint: { path: "/recipe/constraint" } } } };
    notes.push(`grounded the constraint-labeled Button '${applyBtns[0].id}' as apply_constraint`);
  }
  // Retarget the responder's component updates onto the GENERATED surface,
  // unambiguous slots only — otherwise updates orphan on authored ids that
  // may not exist here. Each slot keeps its authored default when the
  // generated surface has zero or several candidates.
  updateTargets = { ...AUTHORED_TARGETS };
  const tables = components.filter((c: any) => c.component === "Table");
  if (tables.length === 1) updateTargets.table = tables[0].id;
  const badges = components.filter((c: any) => c.component === "Badge");
  if (badges.length === 1) updateTargets.badge = badges[0].id;
  const headings = components.filter((c: any) => c.component === "Text" && /^h[123]$/.test(String(c.variant)));
  if (headings.length === 1) updateTargets.title = headings[0].id;
  const servingsTexts = components.filter((c: any) => c.component === "Text" && /servings/i.test(String(c.text ?? "")));
  if (servingsTexts.length === 1) updateTargets.servingsLabel = servingsTexts[0].id;
  notes.push(
    `component updates target { title: '${updateTargets.title}', badge: '${updateTargets.badge}', servingsLabel: '${updateTargets.servingsLabel}', table: '${updateTargets.table}' }`,
  );

  const surfaceId = out[0]?.createSurface?.surfaceId ?? out.find((m: any) => m.updateComponents)?.updateComponents?.surfaceId;
  if (surfaceId) {
    out.push({ version: "v0.9", updateDataModel: { surfaceId, path: "/recipe", value: { servings: 2, constraint: "", status: "Generated. Edit the constraint or regenerate.", variant: 0 } } });
    notes.push("initialized /recipe data model");
  }
  sessions.clear();
  return { ops: out, notes, grounding: { targets: { ...updateTargets } } };
}
