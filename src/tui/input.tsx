import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export function InterventionInput({ disabled, onSubmit }: { disabled?: boolean; onSubmit(value: string): void }) {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (disabled) return;
    if (key.return) { const next = value.trim(); if (next) onSubmit(next); setValue(""); return; }
    if (key.backspace || key.delete) setValue((current) => current.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) setValue((current) => current + input);
  });
  return <Box><Text color={theme.accent}>❯ </Text><Text>{disabled ? "正在执行命令..." : value || "输入干预或 /command"}</Text></Box>;
}
