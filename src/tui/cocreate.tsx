import { Text } from "ink";
import { Modal } from "./modal.js";
export function CoCreate({ prompt }: { prompt: string; onStart(prompt: string): void }) { return <Modal title="共创规划"><Text>{prompt}</Text><Text>当前需求已整理，按 Enter 开始创作</Text></Modal>; }
