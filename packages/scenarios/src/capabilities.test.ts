import { describe, expect, it } from "vitest";
import { bookingCapabilities, resolveAction, type SurfaceComponentLike } from "./capabilities";

const components: SurfaceComponentLike[] = [
  { id: "slot_1030", component: "Button", label: "10:30", variant: "secondary" },
  { id: "confirm", component: "Button", label: "Confirm booking", variant: "primary" },
  { id: "cancel", component: "Button", label: "Start over", variant: "ghost" },
  { id: "name_input", component: "TextField", label: "Your name" },
];

describe("resolveAction (scenario-neutral capability resolution)", () => {
  it("direct name matches resolve as exact-name and keep caller context", () => {
    const r = resolveAction({ name: "select_slot", context: { slot: "9:00" } }, components, bookingCapabilities);
    expect(r).toMatchObject({ ok: true, capability: "select_slot", method: "exact-name", context: { slot: "9:00" } });
  });

  it("synthesized slugs resolve through validated component semantics, preserving provenance", () => {
    const r = resolveAction({ name: "slot_1030", sourceComponentId: "slot_1030" }, components, bookingCapabilities);
    expect(r).toMatchObject({
      ok: true,
      capability: "select_slot",
      method: "semantic:time-labeled-button",
      originalName: "slot_1030",
      context: { slot: "10:30" },
    });
    const c = resolveAction({ name: "confirm" /* slug */, sourceComponentId: "confirm" }, components, bookingCapabilities);
    expect(c).toMatchObject({ ok: true, capability: "confirm_booking", method: "semantic:primary-non-time-button" });
  });

  it("unsupported actions reject clearly with the original identifier", () => {
    const r = resolveAction({ name: "your_name", sourceComponentId: "name_input" }, components, bookingCapabilities);
    expect(r).toMatchObject({ ok: false, reason: "unsupported", originalName: "your_name" });
  });

  it("ambiguous grounding is rejected, not guessed", () => {
    const ambiguous = [...bookingCapabilities, { capability: "other", names: ["select_slot"] }];
    const r = resolveAction({ name: "select_slot" }, components, ambiguous);
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    // A primary time-labeled button would ground both slot + confirm matchers.
    const weird = [{ id: "x", component: "Button", label: "10:30", variant: "primary" } as SurfaceComponentLike];
    // 10:30 + primary: time matcher hits; confirm matcher requires non-time -> single hit, resolves.
    expect(resolveAction({ name: "x", sourceComponentId: "x" }, weird, bookingCapabilities)).toMatchObject({ ok: true, capability: "select_slot" });
  });

  it("resolution is a pure function of (action, components) — deterministic for replay", () => {
    const a = resolveAction({ name: "slot_1030", sourceComponentId: "slot_1030" }, components, bookingCapabilities);
    const b = resolveAction({ name: "slot_1030", sourceComponentId: "slot_1030" }, components, bookingCapabilities);
    expect(a).toEqual(b);
  });
});
