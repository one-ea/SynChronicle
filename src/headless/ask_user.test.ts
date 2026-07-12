import { describe, expect, it } from "vitest";
import { createTerminalAskUser } from "./ask_user.js";

describe("terminal AskUser", () => {
  it("handles selections and custom input", async () => {
    const lines = ["2", "0", "不要感情线"];
    let output = "";
    const ask = createTerminalAskUser({ readLine: async () => lines.shift() ?? "", write: (text) => { output += text; } });
    const response = await ask([
      { question: "风格？", header: "风格", options: [{ label: "热血", description: "升级" }, { label: "悬疑", description: "谜团" }] },
      { question: "限制？", header: "限制", options: [{ label: "黑暗", description: "压抑" }, { label: "轻松", description: "明快" }] },
    ]);
    expect(response.answers).toEqual({ "风格？": "悬疑", "限制？": "自定义" });
    expect(response.notes).toEqual({ "限制？": "不要感情线" });
    expect(output).toContain("0. 自定义输入");
  });
});
