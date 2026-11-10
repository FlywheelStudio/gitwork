"use client";
/**
 * Binds the shared keymap (@gitwork/core keymap.ts) to the page. One window listener; components
 * register handlers for the commands they can run right now.
 */
import { type CommandId, type Scope, commandById, createMatcher } from "@gitwork/core";
import { useEffect, useRef } from "react";

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** True when keys typed into `el` are text, not commands: inputs, textareas, selects, editors. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.closest(".cm-editor")) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset"].includes(el.type);
  return false;
}

/** A modal that is open, not one animating out after it closed. */
const modalOpen = () =>
  document.querySelector('[role="dialog"][aria-modal="true"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])') !== null;

export type Handlers = Partial<Record<CommandId, () => void>>;

/**
 * Runs `handlers[id]` when its keys are pressed. `scopes` says which keymap scopes apply now
 * (a list on screen, a task in focus). Commands without a handler are not matched, so their keys
 * stay free for the browser.
 */
export function useShortcuts(handlers: Handlers, scopes: Scope[]) {
  const latest = useRef({ handlers, scopes });
  useEffect(() => {
    latest.current = { handlers, scopes };
  });

  useEffect(() => {
    const matcher = createMatcher(isMac());
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // A dialog animating out still calls preventDefault on Escape. With no modal open, Escape is ours.
      if (e.defaultPrevented && !(e.key === "Escape" && !modalOpen())) return;
      const { handlers, scopes } = latest.current;
      const typing = isTypingTarget(e.target);
      const id = matcher.press(e, scopes, e.timeStamp);
      if (id === "pending") {
        if (!typing) e.preventDefault();
        return;
      }
      if (!id) return;
      const command = commandById(id);
      if (typing && !command.inInputs) return;
      // In a modal (the command menu, a dialog) only its own keys and the menu toggle apply.
      if (modalOpen() && id !== "menu.open") return;
      const run = handlers[id];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
