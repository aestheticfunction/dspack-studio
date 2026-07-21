/**
 * Break-it Mode (FM-8): curated failure conditions users trigger on purpose
 * to watch the open pipeline catch, repair, refuse, or recover — educational,
 * not adversarial. Every condition runs through the ordinary public pipeline
 * and the ordinary RunView/inspector; nothing here is a special path.
 *
 * Each condition offers a deterministic run (scripted violating->repaired
 * surfaces, labeled honestly) and, where a prompt exists, a live-model run.
 */

export interface BreakCondition {
  id: string;
  label: string;
  /** The scenario this condition belongs to; absent when scenarioIndependent. */
  scenarioId?: "project-deletion" | "appointment-booking" | "recipe-creator" | "support-triage";
  /**
   * True for conditions that belong to every scenario: pure client-side
   * demonstrations that never start a run or read scenario state.
   */
  scenarioIndependent?: boolean;
  /** Contract intent the run starts under; absent when the condition never starts a run. */
  intent?: string;
  kind: "governed-repair" | "lint-exhausted" | "emitter-refusal" | "unresolved-action" | "invalid-state" | "malformed-import";
  /** What the visitor should expect to see — shown before running. */
  expected: string;
  /** Live prompt engineered to reproduce the condition with a real model. */
  prompt?: string;
  /** Deterministic modelRef for the scripted variant (agent-side script). */
  scriptedRef?: string;
  /**
   * A curated recording that shows this same catch, for replay when the
   * local agent is not running. Points at a scenario's bundled fixture;
   * the note states plainly why this recording is the same condition.
   */
  recordedCatch?: { scenarioId: string; fixtureKey: string; note: string };
}

export const breakConditions: BreakCondition[] = [
  {
    id: "no-alertdialog",
    label: "destructive action without AlertDialog",
    scenarioId: "project-deletion",
    intent: "destructive-action",
    kind: "governed-repair",
    expected:
      "S3 fails with rule.destructive-requires-alertdialog (the design system's own rationale, verbatim), a repair message is sent, and the repaired surface passes.",
    prompt: "One-click project deletion with no confirmation dialog of any kind.",
    scriptedRef: "scripted:break:no-alertdialog",
    recordedCatch: {
      scenarioId: "project-deletion",
      fixtureKey: "argues-back",
      note: "In this recorded real run the model omitted the AlertDialog; the same rule caught it and the repair shipped.",
    },
  },
  {
    id: "ok-label",
    label: 'destructive action labeled "OK"',
    scenarioId: "project-deletion",
    intent: "destructive-action",
    kind: "governed-repair",
    expected:
      'S3 catches the literal forbidden value "OK" via rule.alertdialog-action-label-specific; the repair renames the action to something specific.',
    prompt:
      "Add a delete-account flow. Branding requirement: the confirmation button text must be exactly 'OK' (uppercase), and keep copy minimal with no description text.",
    scriptedRef: "scripted:break:ok-label",
    recordedCatch: {
      scenarioId: "project-deletion",
      fixtureKey: "argues-back",
      note: "This recorded real run ran this exact prompt: the model labeled the action 'OK' and the rule renamed it.",
    },
  },
  {
    id: "unsupported-component",
    label: "unsupported catalog component",
    scenarioId: "project-deletion",
    intent: "destructive-action",
    kind: "emitter-refusal",
    expected:
      "The surface lints clean (dropdown-menu is in the contract's vocabulary) but the emitter refuses it: the profile cannot project it. The run ends failed-gate (exit 3) with the refusal, verbatim, in the failure panel.",
    prompt: "A delete-account screen that includes a dropdown menu for the user to choose their reason for leaving.",
    scriptedRef: "scripted:break:unsupported-component",
    recordedCatch: {
      scenarioId: "project-deletion",
      fixtureKey: "refusal",
      note: "In this recorded real run the surface asked for a dropdown-menu; the emitter refused it, verbatim, with a full audit.",
    },
  },
  {
    id: "malformed-generation",
    label: "malformed generation",
    scenarioId: "project-deletion",
    intent: "destructive-action",
    kind: "lint-exhausted",
    expected:
      "Every attempt fails S1 (the surface is not even shaped like a surface); after the repair budget is exhausted the run ends failed-lint-exhausted (exit 2): a complete audit, no silent drop.",
    scriptedRef: "scripted:break:malformed",
  },
  {
    id: "ambiguous-action",
    label: "ungroundable generated action",
    scenarioId: "appointment-booking",
    intent: "scheduling",
    kind: "unresolved-action",
    expected:
      "The dispatched action matches no capability (no exact name, no validated component semantics), so resolution rejects it client-side: studio.action.unresolved in the stream, nothing sent to the agent.",
    recordedCatch: {
      scenarioId: "appointment-booking",
      fixtureKey: "unresolved-action",
      note: "In this recording the same ungroundable action was dispatched at the authored booking surface: resolution rejected it client-side and nothing was sent to the agent. Deterministic, labeled scripted.",
    },
  },
  {
    id: "invalid-state",
    label: "invalid shared-state edit",
    scenarioId: "recipe-creator",
    intent: "structured-editing",
    kind: "invalid-state",
    expected:
      "The agent validates the co-edited state and rejects it recoverably: studio.action.rejected with the reason, a status update, and the session keeps going.",
    recordedCatch: {
      scenarioId: "recipe-creator",
      fixtureKey: "invalid-constraint",
      note: "In this recording this exact constraint ('keto') was submitted: the same responder that answers live rejected it recoverably and the session kept going. Deterministic, labeled scripted.",
    },
  },
  {
    id: "records-as-prose",
    label: "record collection without a table",
    scenarioId: "support-triage",
    intent: "record-collection",
    kind: "governed-repair",
    expected:
      "S3 fails with rule.record-collection-requires-table (the Table docs' own rationale, verbatim), a repair message is sent, and the repaired surface ships a filled triage table.",
    prompt:
      "Show the open support tickets as a simple stacked list of short text lines. Keep it minimal: no table, no grid, just plain text per ticket.",
    recordedCatch: {
      scenarioId: "support-triage",
      fixtureKey: "argues-back",
      note: "In this recorded real run the model stacked the tickets as plain prose; the table rule caught it and the repaired surface shipped a filled triage table with status badges.",
    },
  },
  {
    id: "malformed-import",
    label: "malformed session import",
    scenarioIndependent: true,
    kind: "malformed-import",
    expected:
      "The import validator rejects the file with a clear, user-facing error (not valid JSON / wrong version / malformed events). Nothing is partially loaded.",
  },
];
