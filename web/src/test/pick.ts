import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

export async function pick(user: UserEvent, select: HTMLElement, option: string | RegExp): Promise<void> {
  await user.click(select);
  await user.click(screen.getByRole("option", { name: option }));
}
