/**
 * Deterministic Break-it scripts: authored violating surfaces (and their
 * repaired second attempts) played through the ORDINARY pipeline by the
 * scripted adapter — so every break condition demonstrates the real gates,
 * real repair messages, and real refusals offline and in CI. Labeled
 * scripted; the live-model variant of each condition uses the same prompt a
 * visitor could type.
 */
import type { ScriptEntry } from "@aestheticfunction/dspack-gen";

const REPAIRED = {
  dspackSurface: "0.1",
  system: "Astryx",
  intent: "destructive-action",
  root: {
    component: "card",
    children: [
      { component: "text", props: { type: "display-3" }, text: "Delete project" },
      { component: "text", props: { type: "body" }, text: "This permanently removes the project and its data." },
      { component: "button", props: { label: "Delete project", variant: "destructive" } },
      {
        component: "alert-dialog",
        props: {
          title: "Delete this project?",
          description: "This cannot be undone.",
          actionLabel: "Delete project",
          cancelLabel: "Cancel",
          actionVariant: "destructive",
        },
      },
    ],
  },
};

/** Violating: no alert-dialog anywhere on a destructive surface. */
const NO_ALERTDIALOG = {
  ...REPAIRED,
  root: { ...REPAIRED.root, children: REPAIRED.root.children.filter((c: any) => c.component !== "alert-dialog") },
};

/** Violating: the confirm action carries the forbidden literal "OK". */
const OK_LABEL = structuredClone(REPAIRED) as any;
OK_LABEL.root.children[3].props.actionLabel = "OK";
OK_LABEL.root.children[3].props.description = "";

/** Lint-clean but unprojectable: dropdown-menu is a profile casualty. */
const UNSUPPORTED = structuredClone(REPAIRED) as any;
UNSUPPORTED.root.children.splice(2, 0, { component: "dropdown-menu", props: { items: [] } });

/** Not even surface-shaped: S1 fails on every attempt. */
const MALFORMED = { totally: "not-a-surface", widgets: [1, 2, 3] };

export const BREAK_SCRIPTS: Record<string, ScriptEntry[]> = {
  "scripted:break:no-alertdialog": [{ output: NO_ALERTDIALOG }, { output: REPAIRED }],
  "scripted:break:ok-label": [{ output: OK_LABEL }, { output: REPAIRED }],
  // Three identical entries: since dspack-gen 0.4.0 an emitter refusal rides
  // the repair loop, so the scenario replays the same unprojectable surface
  // through both repairs — demonstrating that a declared casualty stays
  // refused (verbatim reason, terminal failed-gate) even WITH repair turns.
  "scripted:break:unsupported-component": [{ output: UNSUPPORTED }, { output: UNSUPPORTED }, { output: UNSUPPORTED }],
  "scripted:break:malformed": [{ output: MALFORMED }, { output: MALFORMED }, { output: MALFORMED }],
};
