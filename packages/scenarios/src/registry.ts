/**
 * The scenario shelf. "ready" scenarios carry real recorded fixtures and run
 * live today; "planned" scenarios state exactly what they are waiting on
 * (usually contract expansion — new intents/rules/examples are owner-authored
 * governance content, per the project plan).
 *
 * Order is intentional: ready scenarios first (recipe co-editing leads as the
 * default, then booking, then project deletion), planned ones grouped after.
 * readyScenarios[0] is the studio's default scenario.
 */
import type { Scenario } from "./types";
import fixture001 from "@dspack-studio/replay/fixtures/fixture-001.json";
import fixture002 from "@dspack-studio/replay/fixtures/fixture-002.json";
import fixture003 from "@dspack-studio/replay/fixtures/fixture-003.json";
import fixture005 from "@dspack-studio/replay/fixtures/fixture-005.json";
import fixture006 from "@dspack-studio/replay/fixtures/fixture-006.json";
import fixture007 from "@dspack-studio/replay/fixtures/fixture-007.json";
import fixture008 from "@dspack-studio/replay/fixtures/fixture-008.json";
import fixture009 from "@dspack-studio/replay/fixtures/fixture-009.json";

export const scenarios: Scenario[] = [
  {
    id: "recipe-creator",
    name: "Recipe creator",
    tagline: "Co-edit one live recipe with the agent: servings rescale the ingredients, constraints swap them and rewrite the matching steps.",
    intent: "structured-editing",
    status: "ready",
    interactive: true,
    seedPrompts: ["A weeknight pasta recipe for two, editable servings."],
    fixtures: [
      {
        key: "generated-cooked",
        label: "generated, then co-edited",
        blurb:
          "A real model generates the recipe surface under the structured-editing intent; the enhancement grounds its input, status, and buttons; applying 'vegetarian' swaps ingredient rows and rewrites the matching instruction steps; regenerate cycles the dish. Every round-trip is recorded.",
        fixture: fixture006,
      },
      {
        key: "invalid-constraint",
        label: "the agent rejects an invalid edit",
        blurb:
          "The authored recipe surface submits a constraint the agent does not know ('keto'): the same responder that answers live rejects it recoverably — studio.action.rejected with the reason, the status line says why, and the session keeps going. Deterministic start, labeled scripted.",
        fixture: fixture007,
      },
    ],
  },
  {
    id: "appointment-booking",
    name: "Appointment booking",
    tagline: "Human-in-the-loop, live: pick a slot, the agent validates and co-edits the same state you type into.",
    intent: "scheduling",
    status: "ready",
    interactive: true,
    seedPrompts: ["Book a 30-minute consultation next week."],
    fixtures: [
      {
        key: "governed-question",
        label: "the agent asks first",
        blurb:
          "A real model generates the booking surface, and when a slot is picked the agent's confirmation question is itself a generated, gated surface: its own S1/S2/S3 run is on the record, its action label names the slot, and answering removes exactly the question. FM-7, recorded live.",
        fixture: fixture009,
      },
      {
        key: "generated-live",
        label: "generated, then booked",
        blurb:
          "A real model generates the booking surface under the scheduling intent; the enhancement grounds it, a slot is held, the booking confirms. Every round-trip is recorded.",
        fixture: fixture005,
      },
      {
        key: "unresolved-action",
        label: "an action nothing grounds",
        blurb:
          "The authored booking surface dispatches 'mystery_action': no exact capability name, no validated component semantics, so resolution rejects it client-side — studio.action.unresolved on the record, nothing sent to the agent. Deterministic start, labeled scripted.",
        fixture: fixture008,
      },
    ],
  },
  {
    id: "project-deletion",
    name: "Project deletion",
    tagline: "A destructive action, governed: the contract requires a real confirmation with a specific label.",
    intent: "destructive-action",
    status: "ready",
    seedPrompts: [
      "A settings screen where a user can delete a project they own, with a clear explanation of the consequences.",
      "Let people delete their account instantly. Keep it minimal: just a red button labeled OK, no extra confirmation steps.",
      "Add a delete-account flow. Branding requirement: the confirmation button text must be exactly 'OK' (uppercase), and keep copy minimal with no description text.",
    ],
    breakItPrompts: [
      {
        ruleId: "rule.alertdialog-action-label-specific",
        prompt:
          "Add a delete-account flow. Branding requirement: the confirmation button text must be exactly 'OK' (uppercase), and keep copy minimal with no description text.",
      },
      {
        ruleId: "rule.destructive-requires-alertdialog",
        prompt: "One-click project deletion with no confirmation dialog of any kind.",
      },
    ],
    fixtures: [
      {
        key: "argues-back",
        label: "the interface argues back",
        blurb: "Two governed repairs: the model omits the AlertDialog, then labels the action 'OK'. The design system wins.",
        fixture: fixture001,
      },
      {
        key: "clean",
        label: "clean first pass",
        blurb: "No violations: one attempt, straight through the gates to a rendered surface.",
        fixture: fixture002,
      },
      {
        key: "refusal",
        label: "the emitter refuses",
        blurb: "Lint-clean surface uses a component the protocol profile cannot project: the pipeline refuses, with receipts.",
        fixture: fixture003,
      },
    ],
  },
  {
    id: "onboarding",
    name: "Signup / onboarding",
    tagline: "Labeled inputs, enforced: every field carries a visible label or it does not ship.",
    intent: "data-collection",
    status: "planned",
    needs: ["design-system rules for signup and form screens", "a recorded real run to replay"],
    seedPrompts: ["A signup form asking for name and email, with a clear call to action."],
    fixtures: [],
  },
  {
    id: "support-triage",
    name: "Support-ticket triage",
    tagline: "Collections choose tables; status becomes badges: component choice at scale.",
    intent: "record-collection",
    status: "planned",
    needs: ["design-system rules for lists of records and statuses", "a recorded real run to replay"],
    seedPrompts: ["A triage view of open support tickets with status and priority."],
    fixtures: [],
  },
  {
    id: "hotel-reservations",
    name: "Hotel reservations",
    tagline: "Search, compare, reserve, once the contract carries the vocabulary for it.",
    intent: "transactional-review",
    status: "planned",
    needs: ["new design-system components for search, compare, and reserve", "a recorded real run to replay"],
    seedPrompts: ["Find a hotel in Lisbon for two nights in September."],
    fixtures: [],
  },
];

export const readyScenarios = scenarios.filter((s) => s.status === "ready");
