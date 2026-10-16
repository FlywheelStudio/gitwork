import { describe, expect, it } from "vitest";
import { APP_NAME, botAttribution, withBotAttribution } from "./brand";

describe("botAttribution", () => {
  it("names the person and the app", () => {
    expect(botAttribution("Jane Doe")).toBe(`— Jane Doe via ${APP_NAME}`);
  });
});

describe("withBotAttribution", () => {
  it("appends one attribution line", () => {
    expect(withBotAttribution("Fix the header.", "Jane")).toBe(`Fix the header.\n\n— Jane via ${APP_NAME}`);
    expect(withBotAttribution("", "Jane")).toBe(`— Jane via ${APP_NAME}`);
  });

  it("replaces an earlier attribution instead of stacking", () => {
    const first = withBotAttribution("Fix it.", "Jane");
    expect(withBotAttribution(`${first}\n`, "Sam")).toBe(`Fix it.\n\n— Sam via ${APP_NAME}`);
  });

  it("leaves attribution-like text in the middle alone", () => {
    const body = `Quote: — Jane via ${APP_NAME}\nMore text.`;
    expect(withBotAttribution(body, "Sam")).toBe(`${body}\n\n— Sam via ${APP_NAME}`);
  });
});
