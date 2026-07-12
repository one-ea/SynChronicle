import { z } from "zod";
export const TransitionDirection = z.enum(["forward", "backward"]); export type TransitionDirection = z.infer<typeof TransitionDirection>;
export const TransitionTarget = z.enum(["phase", "flow"]); export type TransitionTarget = z.infer<typeof TransitionTarget>;
export const TransitionSchema = z.object({ from: z.string(), to: z.string(), direction: TransitionDirection, target: TransitionTarget }).strict(); export type Transition = z.infer<typeof TransitionSchema>;
export const TransitionsSchema = z.array(TransitionSchema); export type Transitions = z.infer<typeof TransitionsSchema>;
export const mime = (path: string): string => ({ ".json": "application/json", ".jsonl": "application/x-ndjson", ".md": "text/markdown", ".txt": "text/plain", ".epub": "application/epub+zip" })[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
