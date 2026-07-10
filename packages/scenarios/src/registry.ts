/**
 * The scenario shelf. "ready" scenarios carry real recorded fixtures and run
 * live today; "planned" scenarios state exactly what they are waiting on
 * (usually contract expansion — new intents/rules/examples are owner-authored
 * governance content, per the project plan).
 */
import type { Scenario } from "./types";
import fixture001 from "@dspack-studio/replay/fixtures/fixture-001.json";
import fixture002 from "@dspack-studio/replay/fixtures/fixture-002.json";
import fixture003 from "@dspack-studio/replay/fixtures/fixture-003.json";
import fixture005 from "@dspack-studio/replay/fixtures/fixture-005.json";

export const scenarios: Scenario[] = [
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
        blurb: "Lint-clean surface uses a component the protocol profile cannot project — the pipeline refuses, with receipts.",
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
    needs: ["contract intent 'data-collection' + worked example (owner-authored)", "recorded fixtures"],
    seedPrompts: ["A signup form asking for name and email, with a clear call to action."],
    fixtures: [],
  },
  {
    id: "support-triage",
    name: "Support-ticket triage",
    tagline: "Collections choose tables; status becomes badges — component choice at scale.",
    intent: "record-collection",
    status: "planned",
    needs: ["contract intent + rules (owner-authored)", "recorded fixtures"],
    seedPrompts: ["A triage view of open support tickets with status and priority."],
    fixtures: [],
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
        key: "generated-live",
        label: "generated, then booked",
        blurb:
          "A real model generates the booking surface under the scheduling intent; the enhancement grounds it, a slot is held, the booking confirms — every round-trip recorded.",
        fixture: fixture005,
      },
    ],
  },
  {
    id: "recipe-creator",
    name: "Recipe creator",
    tagline: "Co-edit one live recipe with the agent: servings rescale the table, constraints swap ingredients.",
    intent: "structured-editing",
    status: "ready",
    interactive: true,
    needs: ["live generation awaits the owner-approved 'structured-editing' governance proposal"],
    seedPrompts: ["A weeknight pasta recipe for two, editable servings."],
    fixtures: [],
  },
  {
    id: "hotel-reservations",
    name: "Hotel reservations",
    tagline: "Search, compare, reserve — once the contract carries the vocabulary for it.",
    intent: "transactional-review",
    status: "planned",
    needs: ["contract expansion (components + intent, owner-authored)", "recorded fixtures"],
    seedPrompts: ["Find a hotel in Lisbon for two nights in September."],
    fixtures: [],
  },
];

export const readyScenarios = scenarios.filter((s) => s.status === "ready");
