/**
 * Appointment booking: the first interactive scenario. Everything here is
 * deterministic and local — no booking provider, no model call.
 *
 * Structure comes from the contract (surfaces/appointment-booking.dsurface.json,
 * emitted by dspack-emit at build time). This module adds the INTERACTION
 * OVERLAY — data-model bindings and named actions with context — which is
 * exactly the layer dspack v0.4 declares out of scope ("Deliberate Ceiling":
 * actions and bindings are protocol-level, below the contract's vocabulary).
 *
 * State schema (the surface data model):
 *   /booking/name       string   two-way bound to the name TextField
 *   /booking/slot       string   selected slot ("" until chosen)
 *   /booking/status     string   status line (bound Text)
 *   /booking/confirmed  boolean  success state
 *
 * Action flow (all correlation-id'd, duplicate-protected):
 *   select_slot {slot, name}  name empty -> REJECTED (validation) ; else ACCEPTED, holds slot
 *   confirm_booking {slot,name}  no slot -> REJECTED ; else ACCEPTED, confirmed=true
 *   cancel_booking            ACCEPTED, resets slot/status/confirmed
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SURFACE_ID = "scheduling";
const DM = (path: string, value: unknown) => ({
  version: "v0.9",
  updateDataModel: { surfaceId: SURFACE_ID, path, value },
});

/** The emitted surface ops + the interaction overlay + initial data model. */
export function bookingStartOps(): unknown[] {
  const path = require.resolve("@dspack-studio/contracts/out/appointment-booking.surface.json");
  const emitted = JSON.parse(readFileSync(path, "utf8")) as { messages: any[] };
  const messages = structuredClone(emitted.messages);

  for (const m of messages) {
    const components: any[] = m?.updateComponents?.components ?? [];
    for (const c of components) {
      if (c.id === "name_input") c.value = { path: "/booking/name" };
      if (c.id === "status") c.text = { path: "/booking/status" };
      if (c.id?.startsWith("slot_")) {
        const slot = c.label;
        c.action = { event: { name: "select_slot", context: { slot, name: { path: "/booking/name" } } } };
      }
      if (c.id === "confirm") {
        c.action = {
          event: {
            name: "confirm_booking",
            context: { slot: { path: "/booking/slot" }, name: { path: "/booking/name" } },
          },
        };
      }
      if (c.id === "cancel") c.action = { event: { name: "cancel_booking" } };
    }
  }

  messages.push(DM("/booking", { name: "", slot: "", status: "Pick a time to begin.", confirmed: false }));
  return messages;
}

/**
 * Deterministic enhancement of a GENERATED scheduling delivery: attach the
 * shared-state plumbing the generator cannot express. Grounding is
 * unambiguous-only (never label heuristics): exactly one TextField -> bind
 * /booking/name; exactly one supporting-variant Text -> bind /booking/status.
 * Every attachment is reported so the caller can record it in the stream.
 */
export function enhanceGeneratedOps(ops: any[]): { ops: any[]; notes: string[] } {
  const out = structuredClone(ops);
  const notes: string[] = [];
  const components = out.flatMap((m: any) => m?.updateComponents?.components ?? []);
  const textFields = components.filter((c: any) => c.component === "TextField");
  if (textFields.length === 1) {
    textFields[0].value = { path: "/booking/name" };
    notes.push(`bound the single TextField '${textFields[0].id}' to /booking/name`);
  } else if (textFields.length > 1) {
    notes.push(`ambiguous: ${textFields.length} TextFields — no binding attached`);
  }
  const TIME_TOKEN = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
  const slotFromLabel = (label: unknown): string | null => {
    if (typeof label !== "string") return null;
    const hits = label.trim().match(TIME_TOKEN);
    return hits && hits.length === 1 ? label.trim() : null;
  };
  for (const c of components) {
    if (c.component !== "Button") continue;
    const slot = slotFromLabel(c.label);
    if (slot) {
      c.action = { event: { name: "select_slot", context: { slot, name: { path: "/booking/name" } } } };
      notes.push(`grounded time-labeled Button '${c.id}' as select_slot('${slot}')`);
    }
  }
  const primaries = components.filter((c: any) => c.component === "Button" && c.variant === "primary" && slotFromLabel(c.label) === null);
  if (primaries.length === 1) {
    primaries[0].action = { event: { name: "confirm_booking", context: { slot: { path: "/booking/slot" }, name: { path: "/booking/name" } } } };
    notes.push(`grounded the single primary Button '${primaries[0].id}' as confirm_booking`);
  }
  const ghosts = components.filter((c: any) => c.component === "Button" && c.variant === "ghost");
  if (ghosts.length === 1) {
    ghosts[0].action = { event: { name: "cancel_booking" } };
    notes.push(`grounded the single ghost Button '${ghosts[0].id}' as cancel_booking`);
  }
  const statusTexts = components.filter((c: any) => c.component === "Text" && c.variant === "caption");
  if (statusTexts.length === 1) {
    statusTexts[0].text = { path: "/booking/status" };
    notes.push(`bound the single caption Text '${statusTexts[0].id}' to /booking/status`);
  }
  const surfaceId = out[0]?.createSurface?.surfaceId ?? out.find((m: any) => m.updateComponents)?.updateComponents?.surfaceId;
  if (surfaceId) {
    out.push({ version: "v0.9", updateDataModel: { surfaceId, path: "/booking", value: { name: "", slot: "", status: "Pick a time to begin.", confirmed: false } } });
    notes.push("initialized /booking data model");
  }
  return { ops: out, notes };
}

export interface ActionResponse {
  outcome: "accepted" | "rejected";
  detail?: string;
  ops: unknown[];
  /**
   * FM-7: the agent has a question for the human. The server runs this
   * surface (or, live, this prompt) through the ORDINARY pipeline — real
   * S1/S2/S3 gates, real emission, real audit — and delivers the result as
   * its own surface. Never synthesized into the stream directly.
   */
  question?: { surface: unknown; prompt: string };
}

/** The question surface's own id: it rides beside the booking surface, never replacing it. */
export const QUESTION_SURFACE_ID = "scheduling_question";

/**
 * FM-7 session state: a question is on canvas awaiting the human's answer.
 * The agent is deliberately single-session (documented); /fork rebuilds this
 * by replaying accepted actions through this same responder.
 */
let questionActive = false;
export function resetBookingSession(): void {
  questionActive = false;
}

/**
 * The authored HITL question (FM-7): a governed AlertDialog surface asking
 * for the booking decision. Engineering-authored like the scenario surface;
 * governed by the unscoped rules — the action label MUST name the slot
 * (rule.alertdialog-action-label-specific forbids "OK"/"Confirm"), and
 * title/description/actionLabel are required (rule.alertdialog-carries-content).
 */
export function bookingQuestionSurface(slot: string, name: string): unknown {
  return {
    dspackSurface: "0.1",
    system: "Astryx",
    intent: "scheduling",
    root: {
      component: "card",
      children: [
        {
          component: "alert-dialog",
          props: {
            title: `Book ${slot} for ${name}?`,
            description: `The slot is held under your name. Nothing is booked until you confirm; declining releases it.`,
            actionLabel: `Book ${slot}`,
            actionVariant: "primary",
          },
        },
        { component: "button", props: { label: "Back to the times", variant: "ghost" } },
      ],
    },
  };
}

/** The visitor-typable prompt the live path gives a model for the same question. */
export function bookingQuestionPrompt(slot: string, name: string): string {
  return (
    `Ask the user to confirm booking the ${slot} consultation slot held for ${name}. ` +
    `The question must be an alert dialog whose confirm action names the slot, plus a ghost button back to the time list.`
  );
}

/**
 * Ground a question delivery (FM-7): unambiguous-only, like every studio
 * enhancement. Exactly one AlertDialog -> confirm_booking with LITERAL
 * slot/name context (the agent knows them; no binding guesswork); exactly
 * one ghost Button -> cancel_booking. Every op is re-scoped to the question
 * surface id so the booking surface underneath is never replaced. Anything
 * ambiguous refuses clearly — the caller falls back and says so.
 */
export function enhanceQuestionOps(
  ops: any[],
  slot: string,
  name: string,
): { ok: true; ops: any[]; notes: string[] } | { ok: false; reason: string } {
  const out = structuredClone(ops);
  const notes: string[] = [];
  for (const m of out) {
    for (const key of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
      if (m?.[key]?.surfaceId) m[key].surfaceId = QUESTION_SURFACE_ID;
    }
  }
  notes.push(`re-scoped the question delivery to surface '${QUESTION_SURFACE_ID}'`);
  const components = out.flatMap((m: any) => m?.updateComponents?.components ?? []);
  const dialogs = components.filter((c: any) => c.component === "AlertDialog");
  if (dialogs.length !== 1) {
    return { ok: false, reason: dialogs.length === 0 ? "no AlertDialog to carry the question" : `ambiguous: ${dialogs.length} AlertDialogs` };
  }
  dialogs[0].action = { event: { name: "confirm_booking", context: { slot, name } } };
  notes.push(`grounded the AlertDialog '${dialogs[0].id}' as confirm_booking('${slot}' for '${name}')`);
  const ghosts = components.filter((c: any) => c.component === "Button" && c.variant === "ghost");
  if (ghosts.length === 1) {
    ghosts[0].action = { event: { name: "cancel_booking", context: { name } } };
    notes.push(`grounded the single ghost Button '${ghosts[0].id}' as cancel_booking`);
  } else {
    notes.push(`no unambiguous decline affordance (${ghosts.length} ghost Buttons); the dialog's confirm is the only grounded action`);
  }
  return { ok: true, ops: out, notes };
}

export function bookingRespond(name: string, context: Record<string, unknown>): ActionResponse {
  const userName = String(context.name ?? "").trim();
  const slot = String(context.slot ?? "").trim();

  /** Answering the question removes exactly the question surface. */
  const dropQuestion = () => {
    if (!questionActive) return [] as unknown[];
    questionActive = false;
    return [{ version: "v0.9", deleteSurface: { surfaceId: QUESTION_SURFACE_ID } }];
  };

  switch (name) {
    case "select_slot":
      if (!userName) {
        return {
          outcome: "rejected",
          detail: "Name is required to hold a slot.",
          ops: [DM("/booking/status", "Please enter your name first: the slot is held under it.")],
        };
      }
      questionActive = true;
      return {
        outcome: "accepted",
        // An accepted action COMMITS its submitted values: user input is
        // client-local until an action carries it (A2UI's sync-on-action),
        // so the agent writes the name back into the shared data model —
        // that is what survives replays and reconstruction.
        ops: [
          DM("/booking/name", userName),
          DM("/booking/slot", slot),
          DM("/booking/status", `Holding ${slot} for ${userName}.`),
        ],
        // FM-7: the confirmation question is a real governed surface, run
        // through the ordinary pipeline by the server (scripted from this
        // authored surface, or generated live from the prompt).
        question: { surface: bookingQuestionSurface(slot, userName), prompt: bookingQuestionPrompt(slot, userName) },
      };

    case "confirm_booking":
      if (!slot) {
        return {
          outcome: "rejected",
          detail: "Pick a time before confirming.",
          ops: [DM("/booking/status", "Pick a time before confirming.")],
        };
      }
      if (!userName) {
        return {
          outcome: "rejected",
          detail: "Name is required.",
          ops: [DM("/booking/status", "Please enter your name first.")],
        };
      }
      return {
        outcome: "accepted",
        ops: [
          ...dropQuestion(),
          DM("/booking/confirmed", true),
          DM("/booking/status", `Booked ${slot} for ${userName}. See you then!`),
        ],
      };

    case "cancel_booking":
      return {
        outcome: "accepted",
        ops: [
          ...dropQuestion(),
          DM("/booking/slot", ""),
          DM("/booking/confirmed", false),
          DM("/booking/status", "Pick a time to begin."),
        ],
      };

    default:
      return { outcome: "rejected", detail: `unknown action '${name}'`, ops: [] };
  }
}
