import { Box, Text } from "ink";
import type { TuiSnapshot } from "./events.js";
import { theme } from "./theme.js";

export function Outline({ snapshot }: { snapshot: TuiSnapshot }) {
  return <Box borderStyle="round" flexDirection="column" paddingX={1}><Text bold color={theme.accent}>大纲</Text>{(snapshot.outline ?? []).length === 0 ? <Text color={theme.muted}>等待大纲生成</Text> : snapshot.outline?.map((entry) => <Text key={entry.chapter}>{entry.chapter <= (snapshot.completedCount ?? 0) ? "●" : "○"} {entry.chapter}. {entry.title}</Text>)}</Box>;
}
