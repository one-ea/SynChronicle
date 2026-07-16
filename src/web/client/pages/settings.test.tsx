// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings.js";

describe("SettingsPage", () => {
  it("shows unavailable platform models with unknown-price warnings", async () => {
    const request = vi.fn(async (path: string) => path === "/api/usage/" ? { settings: { concurrencyLimit: 1, adminMaxConcurrency: 4, budgetUsd: null, balanceUsd: 5 }, perAgent: [], perModel: [], platformModels: [{ model: "custom/unknown", available: false, unknownPrice: true, reason: "unknown_price" }] } : { credentials: [] });
    render(<SettingsPage api={{ request } as never} />);
    expect(await screen.findByText("custom/unknown")).toBeVisible();
    expect(screen.getByText(/价格未知/)).toBeVisible();
  });
});
