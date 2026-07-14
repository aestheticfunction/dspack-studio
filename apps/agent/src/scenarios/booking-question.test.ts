/**
 * FM-7: the agent's HITL question is a real governed surface. New expected
 * behavior, written BEFORE the implementation (fail-first): selecting a slot
 * yields a question descriptor whose authored surface carries a governed
 * AlertDialog (specific action label, never the forbidden generics), the
 * enhancement grounds exactly the unambiguous components, and answering the
 * question restores the booking surface with the outcome committed.
 */
import { describe, expect, it } from "vitest";
import {
  bookingQuestionSurface,
  bookingRespond,
  enhanceQuestionOps,
  resetBookingSession,
} from "./appointment-booking";

const dm = (ops: unknown[]) =>
  Object.fromEntries(ops.filter((o: any) => o.updateDataModel).map((o: any) => [o.updateDataModel.path, o.updateDataModel.value]));

describe("FM-7: the question is a governed surface", () => {
  it("select_slot acceptance carries the question descriptor (surface + visitor-typable prompt)", () => {
    resetBookingSession();
    const r = bookingRespond("select_slot", { slot: "10:30", name: "Ada" }) as any;
    expect(r.outcome).toBe("accepted");
    expect(r.question).toBeDefined();
    expect(r.question.surface.intent).toBe("scheduling");
    expect(typeof r.question.prompt).toBe("string");
    expect(r.question.prompt).toContain("10:30");
  });

  it("the authored question surface is a governed AlertDialog with a specific action label", () => {
    const s = bookingQuestionSurface("10:30", "Ada") as any;
    const dialog = s.root.children.find((c: any) => c.component === "alert-dialog");
    expect(dialog).toBeDefined();
    // rule.alertdialog-carries-content: title, description, actionLabel.
    expect(dialog.props.title).toContain("10:30");
    expect(dialog.props.description.length).toBeGreaterThan(0);
    // rule.alertdialog-action-label-specific: never the forbidden generics.
    expect(["OK", "Confirm", "Yes", "Continue"]).not.toContain(dialog.props.actionLabel);
    expect(dialog.props.actionLabel).toContain("10:30");
  });

  it("enhancement grounds exactly the unambiguous components, with literal context", () => {
    const s = bookingQuestionSurface("10:30", "Ada");
    const ops = [
      { updateComponents: { surfaceId: "scheduling", components: [
        { id: "q", component: "AlertDialog", title: (s as any).root.children[0].props.title },
        { id: "back", component: "Button", label: "Back to the times", variant: "ghost" },
      ] } },
    ];
    const out = enhanceQuestionOps(ops as any[], "10:30", "Ada") as any;
    expect(out.ok).toBe(true);
    const comps = out.ops[0].updateComponents.components;
    expect(comps[0].action.event.name).toBe("confirm_booking");
    expect(comps[0].action.event.context).toEqual({ slot: "10:30", name: "Ada" });
    expect(comps[1].action.event.name).toBe("cancel_booking");
    expect(out.notes.length).toBeGreaterThan(0);
    // The question rides its OWN surface so the booking surface underneath
    // is never replaced: every op is re-scoped to the question surface id.
    expect(out.ops[0].updateComponents.surfaceId).toBe("scheduling_question");
  });

  it("ambiguous question surfaces do not ground (two dialogs, no guessing)", () => {
    const ops = [
      { updateComponents: { surfaceId: "scheduling", components: [
        { id: "q1", component: "AlertDialog" },
        { id: "q2", component: "AlertDialog" },
      ] } },
    ];
    const out = enhanceQuestionOps(ops as any[], "10:30", "Ada") as any;
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/ambiguous|no alertdialog/i);
  });

  it("confirming after the question deletes the question surface and books, leaving the booking surface untouched", () => {
    resetBookingSession();
    bookingRespond("select_slot", { slot: "10:30", name: "Ada" });
    const confirm = bookingRespond("confirm_booking", { slot: "10:30", name: "Ada" }) as any;
    expect(confirm.outcome).toBe("accepted");
    // The question is its own surface; the answer removes exactly it. The
    // underlying booking surface (authored or generated) is never touched.
    expect(confirm.ops.some((o: any) => o.deleteSurface?.surfaceId === "scheduling_question")).toBe(true);
    expect(confirm.ops.some((o: any) => o.createSurface)).toBe(false);
    expect(dm(confirm.ops)["/booking/confirmed"]).toBe(true);
    expect(dm(confirm.ops)["/booking/status"]).toMatch(/Booked 10:30 for Ada/);
  });

  it("declining after the question deletes the question surface and releases the slot", () => {
    resetBookingSession();
    bookingRespond("select_slot", { slot: "10:30", name: "Ada" });
    const decline = bookingRespond("cancel_booking", { name: "Ada" }) as any;
    expect(decline.outcome).toBe("accepted");
    expect(decline.ops.some((o: any) => o.deleteSurface?.surfaceId === "scheduling_question")).toBe(true);
    expect(dm(decline.ops)["/booking/confirmed"]).toBe(false);
    expect(dm(decline.ops)["/booking/slot"]).toBe("");
  });
});
