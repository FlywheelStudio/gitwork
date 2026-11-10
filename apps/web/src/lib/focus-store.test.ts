import { describe, expect, it, vi } from "vitest";
import { FocusStore } from "./focus-store";

describe("FocusStore", () => {
  it("notifies on change only, and keeps a stable state between changes", () => {
    const store = new FocusStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();
    store.setFocused("a");
    store.setFocused("a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).not.toBe(before);
    expect(store.getState()).toBe(store.getState());
    expect(store.isFocused("a")).toBe(true);
    store.setSelected(new Set(["a", "b"]));
    expect(store.isSelected("b")).toBe(true);
    expect(store.getState().selected.size).toBe(2);
  });
});
