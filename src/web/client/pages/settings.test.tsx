// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings.js";

describe("SettingsPage", () => {
  it("shows unavailable platform models with unknown-price warnings", async () => {
    const request = vi.fn(async (path: string) => path === "/api/usage/" ? { settings: { concurrencyLimit: 1, adminMaxConcurrency: 4, budgetUsd: null, balanceUsd: 5 }, perAgent: [], perModel: [], platformModels: [{ model: "openai/gpt-5", available: true, unknownPrice: false, capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { reasoningEffort: ["low", "medium"] } } }, { model: "custom/unknown", available: false, unknownPrice: true, reason: "unknown_price", capabilities: { contextWindow: 0, maxOutputTokens: 0 } }] } : { credentials: [] });
    render(<SettingsPage api={{ request } as never} />);
    expect(await screen.findByText("custom/unknown")).toBeVisible();
    expect(screen.getByText(/价格未知/)).toBeVisible();
    expect(screen.getByText(/128[,.]?000/)).toBeVisible();
    expect(screen.getByText(/low \/ medium/)).toBeVisible();
  });
});
