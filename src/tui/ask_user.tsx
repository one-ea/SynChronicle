import { useRef, useState } from "react";
import { Text, useInput } from "ink";
import { Modal } from "./modal.js";
import { theme } from "./theme.js";

export interface AskQuestion { question: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }
export function AskUser({ questions, onSubmit }: { questions: AskQuestion[]; onSubmit(answers: Record<string, string>): void }) {
  const [questionIndex, setQuestionIndex] = useState(0); const [cursor, setCursor] = useState(0); const cursorRef = useRef(0); const [answers, setAnswers] = useState<Record<string, string>>({}); const question = questions[questionIndex];
  useInput((_input, key) => { if (!question) return; if (key.upArrow) { cursorRef.current = (cursorRef.current - 1 + question.options.length) % question.options.length; setCursor(cursorRef.current); } if (key.downArrow) { cursorRef.current = (cursorRef.current + 1) % question.options.length; setCursor(cursorRef.current); } if (key.return) { const next = { ...answers, [question.question]: question.options[cursorRef.current]?.label ?? "" }; if (questionIndex === questions.length - 1) onSubmit(next); else { setAnswers(next); setQuestionIndex((value) => value + 1); cursorRef.current = 0; setCursor(0); } } });
  if (!question) return null;
  return <Modal title={`需要补充信息 ${questionIndex + 1}/${questions.length}`}><Text>{question.question}</Text>{question.options.map((option, index) => <Text key={option.label} color={index === cursor ? theme.accent : undefined}>{index === cursor ? "›" : " "} {option.label} {option.description ? `· ${option.description}` : ""}</Text>)}</Modal>;
}
