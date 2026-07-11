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
}

export function bookingRespond(name: string, context: Record<string, unknown>): ActionResponse {
  const userName = String(context.name ?? "").trim();
  const slot = String(context.slot ?? "").trim();

  switch (name) {
    case "select_slot":
      if (!userName) {
        return {
          outcome: "rejected",
          detail: "Name is required to hold a slot.",
          ops: [DM("/booking/status", "Please enter your name first: the slot is held under it.")],
        };
      }
      return {
        outcome: "accepted",
        // An accepted action COMMITS its submitted values: user input is
        // client-local until an action carries it (A2UI's sync-on-action),
        // so the agent writes the name back into the shared data model —
        // that is what survives replays and reconstruction.
        ops: [
          DM("/booking/name", userName),
          DM("/booking/slot", slot),
          DM("/booking/status", `Holding ${slot} for ${userName}. Confirm to book.`),
        ],
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
          DM("/booking/confirmed", true),
          DM("/booking/status", `Booked ${slot} for ${userName}. See you then!`),
        ],
      };

    case "cancel_booking":
      return {
        outcome: "accepted",
        ops: [
          DM("/booking/slot", ""),
          DM("/booking/confirmed", false),
          DM("/booking/status", "Pick a time to begin."),
        ],
      };

    default:
      return { outcome: "rejected", detail: `unknown action '${name}'`, ops: [] };
  }
}
