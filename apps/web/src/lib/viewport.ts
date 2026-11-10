"use client";
/**
 * Window-scroll virtualization for a block of fixed-height items (the list, the timeline).
 * The scroll position, relative to the block, is an external store in 100 px steps, so a
 * component re-renders once per step, not once per scroll event.
 */
import { useState, useSyncExternalStore } from "react";

/** The block's scroll position relative to the viewport, in 100 px steps. */
class Viewport {
  private el: HTMLElement | null = null;
  private snap = "0:10";
  private listeners = new Set<() => void>();
  attach = (el: HTMLElement | null) => {
    this.el = el;
    this.update();
  };
  subscribe = (listener: () => void) => {
    if (this.listeners.size === 0) {
      window.addEventListener("scroll", this.update, { passive: true });
      window.addEventListener("resize", this.update);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        window.removeEventListener("scroll", this.update);
        window.removeEventListener("resize", this.update);
      }
    };
  };
  update = () => {
    if (!this.el) return;
    const top = this.el.getBoundingClientRect().top;
    const next = `${Math.floor(-top / 100)}:${Math.ceil(window.innerHeight / 100)}`;
    if (next === this.snap) return;
    this.snap = next;
    for (const l of this.listeners) l();
  };
  getSnapshot = () => this.snap;
  /** Scrolls the window so a list offset is in view. */
  reveal(offset: number, height: number) {
    if (!this.el) return;
    const top = this.el.getBoundingClientRect().top + offset;
    if (top < 80) window.scrollBy({ top: top - 80 });
    else if (top + height > window.innerHeight - 24) window.scrollBy({ top: top + height - window.innerHeight + 24 });
  }
}

const SERVER_SNAPSHOT = () => "0:10";

/**
 * `attach` goes on the block's element. `from`/`to` are the block offsets (px) to render, with
 * `overscan` px of margin. `reveal` scrolls an offset into view (for J / K).
 */
export function useViewport(overscan: number) {
  // Methods, not the instance: the React Compiler treats an object passed as `ref` as a ref.
  const [{ attach, subscribe, getSnapshot, reveal }] = useState(() => {
    const v = new Viewport();
    return { attach: v.attach, subscribe: v.subscribe, getSnapshot: v.getSnapshot, reveal: (offset: number, h: number) => v.reveal(offset, h) };
  });
  const [scrolled, screens] = useSyncExternalStore(subscribe, getSnapshot, SERVER_SNAPSHOT).split(":").map(Number) as [number, number];
  return { attach, reveal, from: scrolled * 100 - overscan, to: (scrolled + screens) * 100 + overscan };
}
