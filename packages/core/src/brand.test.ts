import { describe, expect, it } from "vitest";
import { APP_NAME, botAttribution } from "./brand";

describe("botAttribution", () => {
  it("names the person and the app", () => {
    expect(botAttribution("Jane Doe")).toBe(`— Jane Doe via ${APP_NAME}`);
  });
});
