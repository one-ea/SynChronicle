import { describe, expect, it } from "vitest";
import { titleHue } from "./publish.js";
describe("publish domain", () => { it("generates stable cover hues", () => { expect(titleHue("雨夜书局")).toBe(titleHue("雨夜书局")); expect(titleHue("雨夜书局")).toBeGreaterThanOrEqual(0); }); });
