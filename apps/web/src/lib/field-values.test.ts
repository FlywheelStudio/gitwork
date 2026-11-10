import type { FieldView, TaskView } from "@gitwork/server";
import { describe, expect, it } from "vitest";
import { currentInput, fromInputValue, toInputValue, valueOf, withField } from "./field-values";

const status: FieldView = { id: "F_s", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Todo" }, { id: "o2", name: "Done" }] };
const sprint: FieldView = { id: "F_i", name: "Sprint", dataType: "ITERATION", iterations: [{ id: "i1", title: "Sprint 1", startDate: "2026-11-02", duration: 14 }] };
const due: FieldView = { id: "F_d", name: "Due", dataType: "DATE" };
const task = { id: "t", fields: { F_s: { type: "single_select", optionId: "o1", name: "Todo" } } } as unknown as TaskView;

describe("field values", () => {
  it("round-trips form strings for every type", () => {
    expect(fromInputValue(status, "o2")).toEqual({ type: "single_select", optionId: "o2" });
    expect(fromInputValue(sprint, "i1")).toEqual({ type: "iteration", iterationId: "i1" });
    expect(fromInputValue(due, "2026-12-01")).toEqual({ type: "date", date: "2026-12-01" });
    expect(fromInputValue({ id: "n", name: "Est", dataType: "NUMBER" }, "3")).toEqual({ type: "number", number: 3 });
    expect(fromInputValue(due, "")).toBeNull();
    expect(toInputValue({ type: "number", number: 3 })).toBe("3");
  });

  it("fills option names and iteration dates like the server cache", () => {
    expect(valueOf(status, { type: "single_select", optionId: "o2" })).toEqual({ type: "single_select", optionId: "o2", name: "Done" });
    expect(valueOf(sprint, { type: "iteration", iterationId: "i1" })).toEqual({
      type: "iteration",
      iterationId: "i1",
      title: "Sprint 1",
      startDate: "2026-11-02",
      duration: 14,
    });
    expect(valueOf(status, { type: "single_select", optionId: "nope" })).toBeNull();
  });

  it("sets and clears a field without touching the original task", () => {
    const moved = withField(status, { type: "single_select", optionId: "o2" })(task);
    expect(moved.fields.F_s).toEqual({ type: "single_select", optionId: "o2", name: "Done" });
    expect(task.fields.F_s).toMatchObject({ optionId: "o1" });
    expect(withField(status, null)(task).fields.F_s).toBeUndefined();
    expect(currentInput(status, task)).toEqual({ type: "single_select", optionId: "o1" });
    expect(currentInput(due, task)).toBeNull();
  });
});
