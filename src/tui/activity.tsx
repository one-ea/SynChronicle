import { Box, Text } from "ink";
import type { RuntimeEvent } from "../domain/index.js";
import { theme } from "./theme.js";

export function Activity({ events, stream, error }: { events: RuntimeEvent[]; stream: string; error?: string }) {
  return <Box borderStyle="round" flexDirection="column" paddingX={1}><Text bold color={theme.accent}>活动与流输出</Text>{events.slice(-12).map((event, index) => <Text key={`${event.time ?? ""}-${index}`} color={event.type === "error" ? theme.error : undefined}>{event.agent ? `${displayAgent(event.agent)} · ` : ""}{event.message ?? event.type}</Text>)}{stream && <Text>{stream}</Text>}{error && <Text color={theme.error}>错误: {error}</Text>}</Box>;
}
function displayAgent(name: string): string { return name.charAt(0).toUpperCase() + name.slice(1); }
