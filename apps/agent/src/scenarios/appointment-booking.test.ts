import { describe, expect, it } from "vitest";
import { bookingRespond, bookingStartOps, resetBookingSession } from "./appointment-booking";

const dm = (ops: unknown[]) =>
  Object.fromEntries(ops.filter((o: any) => o.updateDataModel).map((o: any) => [o.updateDataModel.path, o.updateDataModel.value]));

describe("appointment-booking responder (deterministic HITL)", () => {
  it("start ops carry the emitted surface, the interaction overlay, and the initial data model", () => {
    const ops = bookingStartOps() as any[];
    expect(ops[0].createSurface.surfaceId).toBe("scheduling");
    const components = ops.find((o) => o.updateComponents)?.updateComponents.components as any[];
    const nameInput = components.find((c) => c.id === "name_input");
    expect(nameInput.value).toEqual({ path: "/booking/name" });
    const slot = components.find((c) => c.id === "slot_1030");
    expect(slot.action.event.name).toBe("select_slot");
    expect(slot.action.event.context.slot).toBe("10:30");
    const init = ops.find((o) => o.updateDataModel)?.updateDataModel;
    expect(init.path).toBe("/booking");
    expect(init.value.confirmed).toBe(false);
  });

  it("validation failure: selecting a slot without a name is rejected with a status update", () => {
    const r = bookingRespond("select_slot", { slot: "9:00", name: "" });
    expect(r.outcome).toBe("rejected");
    expect(r.detail).toMatch(/Name is required/);
    expect(dm(r.ops)["/booking/status"]).toMatch(/enter your name/);
  });

  it("happy path: select -> governed question -> confirm reaches the success state", () => {
    resetBookingSession();
    const select = bookingRespond("select_slot", { slot: "10:30", name: "Ada" });
    expect(select.outcome).toBe("accepted");
    expect(dm(select.ops)["/booking/slot"]).toBe("10:30");
    // FM-7: acceptance carries the agent's question for the pipeline.
    expect(select.question).toBeDefined();

    const confirm = bookingRespond("confirm_booking", { slot: "10:30", name: "Ada" });
    expect(confirm.outcome).toBe("accepted");
    expect(dm(confirm.ops)["/booking/confirmed"]).toBe(true);
    expect(dm(confirm.ops)["/booking/status"]).toMatch(/Booked 10:30 for Ada/);
  });

  it("confirm without a slot is rejected; cancel resets", () => {
    expect(bookingRespond("confirm_booking", { slot: "", name: "Ada" }).outcome).toBe("rejected");
    const cancel = bookingRespond("cancel_booking", {});
    expect(cancel.outcome).toBe("accepted");
    expect(dm(cancel.ops)["/booking/slot"]).toBe("");
    expect(dm(cancel.ops)["/booking/confirmed"]).toBe(false);
  });

  it("unknown actions are rejected, not crashed", () => {
    expect(bookingRespond("nuke_everything", {}).outcome).toBe("rejected");
  });
});
