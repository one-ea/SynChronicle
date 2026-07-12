import { describe, expect, it } from "vitest";
import pauseFixtures from "./fixtures/pause.json";
import { resolvePausePoint, type PausePoint, type PauseProgress, type PauseResolution } from "./pause.js";

describe("resolvePausePoint Go compatibility fixtures", () => {
  for (const fixture of pauseFixtures) {
    it(fixture.name, () => {
      expect(resolvePausePoint(fixture.pausePoint as PausePoint | null, fixture.progress as PauseProgress | null)).toBe(fixture.expected as PauseResolution);
    });
  }
});
