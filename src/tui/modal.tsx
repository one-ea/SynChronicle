import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

export function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return <Box borderStyle="double" borderColor={theme.accent} flexDirection="column" paddingX={1}><Text bold>{title}</Text>{children}</Box>;
}
