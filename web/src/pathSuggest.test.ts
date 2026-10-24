import { describe, expect, it } from "vitest";
import { pathSuggestions } from "./pathSuggest";

describe("pathSuggestions", () => {
  it("keeps the typed folder part and ends each folder with a slash", () => {
    expect(pathSuggestions("~/w", [{ Name: "web" }, { Name: "www" }])).toEqual(["~/web/", "~/www/"]);
    expect(pathSuggestions("/srv/a", [{ Name: "api" }])).toEqual(["/srv/api/"]);
    expect(pathSuggestions("~/www/", [{ Name: "bolao-app" }])).toEqual(["~/www/bolao-app/"]);
    expect(pathSuggestions("co", [{ Name: "code" }])).toEqual(["code/"]);
  });

  it("gives nothing for an empty text", () => {
    expect(pathSuggestions("", [{ Name: "web" }])).toEqual([]);
  });
});
