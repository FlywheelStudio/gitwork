/**
 * Keyboard focus and multi-selection, outside React state. Each row subscribes to its own
 * boolean (useFocused / useIsSelected), so moving focus re-renders two rows, not the whole list.
 */
export class FocusStore {
  private focused: string | null = null;
  private selection: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();
  private state = { focusedId: this.focused, selected: this.selection };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.state = { focusedId: this.focused, selected: this.selection };
    for (const l of this.listeners) l();
  }

  getState = () => this.state;
  isFocused = (id: string) => this.focused === id;
  isSelected = (id: string) => this.selection.has(id);

  setFocused = (id: string | null) => {
    if (id === this.focused) return;
    this.focused = id;
    this.emit();
  };

  setSelected = (next: ReadonlySet<string>) => {
    this.selection = next;
    this.emit();
  };
}
