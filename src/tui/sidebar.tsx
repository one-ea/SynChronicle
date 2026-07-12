import { Box, Text } from "ink";
import type { TuiSnapshot } from "./events.js";
import { theme } from "./theme.js";

export function Sidebar({ snapshot }: { snapshot: TuiSnapshot }) {
  const agents = snapshot.agents ?? [{ name: "coordinator", state: snapshot.runtimeState }];
  return <Box borderStyle="round" flexDirection="column" paddingX={1}><Text bold color={theme.accent}>状态</Text><Text>阶段 {snapshot.phase ?? "准备"}</Text><Text>进度 {snapshot.completedCount ?? 0}/{snapshot.totalChapters ?? "?"} 章</Text>{snapshot.recoveryLabel && <Text color={theme.secondary}>{snapshot.recoveryLabel}</Text>}<Text bold>Agent</Text>{agents.map((agent) => <Text key={agent.name}>{displayAgent(agent.name)} [{agent.state}] {agent.summary ?? ""}</Text>)}<Text>{snapshot.usage.totalTokens} tokens · ${snapshot.usage.costUSD.toFixed(2)}</Text>{snapshot.pendingSteer && <Text color={theme.accent}>待干预 {snapshot.pendingSteer}</Text>}</Box>;
}
function displayAgent(name: string): string { return name.charAt(0).toUpperCase() + name.slice(1); }
