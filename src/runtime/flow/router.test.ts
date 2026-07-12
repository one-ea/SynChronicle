import { describe, expect, it } from "vitest";
import routerFixtures from "./fixtures/router.json";
import { formatMessage, route, type FlowRouterState, type Instruction } from "./router.js";

describe("route Go compatibility fixtures", () => {
  for (const fixture of routerFixtures) {
    it(fixture.name, () => {
      expect(route(fixture.state as FlowRouterState)).toEqual(fixture.expected as Instruction | null);
    });
  }
});

describe("formatMessage", () => {
  it("preserves the Go coordinator instruction format", () => {
    const message = formatMessage({ agent: "writer", task: "写第 5 章", reason: "续写", chapter: 0 });
    for (const text of ["[Host 下达指令]", "subagent(writer, \"写第 5 章\")", "agent: writer", "task: \"写第 5 章\"", "续写", "必须原样使用", "不要改写 task", "不要先调 novel_context"]) {
      expect(message).toContain(text);
    }
  });
});
