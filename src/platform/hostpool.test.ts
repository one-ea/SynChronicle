import { describe, expect, it, vi } from "vitest";
import { HostPool } from "./hostpool.js";
import type { Host } from "../runtime/host.js";

function fakeHost(): Host {
  return { abort: vi.fn(() => undefined) } as unknown as Host;
}

describe("HostPool", () => {
  it("caches per user and book keys", () => {
    const pool = new HostPool();
    const hostA = fakeHost();
    pool.put("u-1", "b-1", hostA);
    expect(pool.get("u-1", "b-1")).toBe(hostA);
    expect(pool.get("u-2", "b-1")).toBeUndefined();
    expect(pool.get("u-1", "b-2")).toBeUndefined();
  });

  it("enforces per-user and global concurrency limits", () => {
    const pool = new HostPool(8, 2, 3);
    expect(pool.acquire("u-1")).toBe(true);
    expect(pool.acquire("u-1")).toBe(true);
    expect(pool.acquire("u-1")).toBe(false);
    expect(pool.acquire("u-2")).toBe(true);
    expect(pool.acquire("u-3")).toBe(false);
    pool.release("u-1");
    expect(pool.acquire("u-3")).toBe(true);
    pool.release("u-1");
    pool.release("u-2");
    pool.release("u-3");
    expect(pool.runningCount("u-1")).toBe(0);
  });

  it("evicts lru entries beyond the cap and aborts them", () => {
    const pool = new HostPool(2);
    const h1 = fakeHost(); const h2 = fakeHost(); const h3 = fakeHost();
    pool.put("u-1", "b-1", h1);
    pool.put("u-1", "b-2", h2);
    pool.get("u-1", "b-1");
    pool.put("u-1", "b-3", h3);
    expect(pool.size()).toBe(2);
    expect(pool.get("u-1", "b-1")).toBe(h1);
    expect(pool.get("u-1", "b-2")).toBeUndefined();
    expect(pool.get("u-1", "b-3")).toBe(h3);
    expect(h2.abort).toHaveBeenCalledWith("Host 池逐出", "warn");
    expect(h1.abort).not.toHaveBeenCalled();
  });

  it("invalidates by book and by user with abort", () => {
    const pool = new HostPool();
    const h1 = fakeHost(); const h2 = fakeHost(); const h3 = fakeHost();
    pool.put("u-1", "b-1", h1);
    pool.put("u-2", "b-1", h2);
    pool.put("u-1", "b-2", h3);
    pool.invalidateBook("b-1");
    expect(pool.size()).toBe(1);
    expect(pool.get("u-1", "b-2")).toBe(h3);
    expect(h1.abort).toHaveBeenCalled();
    expect(h2.abort).toHaveBeenCalled();
    pool.put("u-3", "b-3", fakeHost());
    pool.acquire("u-3");
    pool.invalidateUser("u-3");
    expect(pool.runningCount("u-3")).toBe(0);
    expect(pool.get("u-3", "b-3")).toBeUndefined();
  });
});
