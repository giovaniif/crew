import { act } from "@testing-library/react";
import type { Width } from "../App";

export class FakeWidth implements Width {
  private listeners = new Set<() => void>();

  constructor(private wide: boolean) {}

  readonly matches = (): boolean => this.wide;

  readonly onChange = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(wide: boolean): void {
    this.wide = wide;
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}
