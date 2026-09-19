import { describe, expect, it } from "vitest";
import { PrepMessageSchema, PrepSessionSchema } from "./prep.js";

describe("prep domain", () => {
  it("applies session and message defaults", () => {
    const session = PrepSessionSchema.parse({ id: "prep-1", bookId: "book-1", createdAt: "now", updatedAt: "now" });
    expect(session.status).toBe("active");
    expect(session.stage).toBe("intent");
    expect(session.rounds).toBe(0);
    expect(session.messages).toEqual([]);
    const message = PrepMessageSchema.parse({ id: "m-1", role: "assistant", content: "hi", ts: "now", stage: "intent" });
    expect(message.suggestions).toEqual([]);
  });
});
