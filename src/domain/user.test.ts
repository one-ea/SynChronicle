import { describe, expect, it } from "vitest";
import { UserRecordSchema, UsersFileSchema, validatePassword } from "./user.js";

describe("user domain", () => {
  it("applies safe user defaults", () => {
    const user = UserRecordSchema.parse({ id: "u-1", name: "admin", salt: "a".repeat(16), hash: "b".repeat(64), createdAt: "now" });
    expect(user.role).toBe("writer");
    expect(user.disabled).toBe(false);
    expect(UsersFileSchema.parse({ updatedAt: "now" }).users).toEqual([]);
  });

  it("validates password length", () => {
    expect(validatePassword("short")).toContain("8");
    expect(validatePassword("valid-password")).toBeNull();
    expect(validatePassword("x".repeat(257))).toContain("256");
  });
});
