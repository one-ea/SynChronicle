import { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export function Startup({ version, onStart, onCoCreate }: { version?: string; onStart(prompt: string): void; onCoCreate(prompt: string): void }) {
  const [prompt, setPrompt] = useState(""); const promptRef = useRef(""); const [coCreate, setCoCreate] = useState(false); const coCreateRef = useRef(false);
  useInput((input, key) => { if (key.tab) { coCreateRef.current = !coCreateRef.current; setCoCreate(coCreateRef.current); return; } if (key.return) { const value = promptRef.current.trim(); if (value) (coCreateRef.current ? onCoCreate : onStart)(value); return; } if (key.backspace || key.delete) promptRef.current = promptRef.current.slice(0, -1); else if (!key.ctrl && !key.meta && input) promptRef.current += input; setPrompt(promptRef.current); });
  return <Box flexDirection="column" alignItems="center"><Text bold color={theme.accent}>SYNCHRONICLE {version}</Text><Text>AI-Powered Novel Creation Engine</Text><Text>{coCreate ? "  快速开始   [共创规划]" : "[快速开始]   共创规划  "}</Text><Text color={theme.muted}>Tab 切换模式 · Enter 开始</Text><Text color={theme.accent}>❯ {prompt || "输入一句小说需求"}</Text></Box>;
}
