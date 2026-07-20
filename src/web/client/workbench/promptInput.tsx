import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client.js";

export function PromptInput({ onSend }: { onSend(instruction: string): Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; instruction: string } | null>(null);
  async function deliver(instruction: string, reset?: HTMLFormElement) {
    setPending(true);
    setError(null);
    try { await onSend(instruction); reset?.reset(); }
    catch (cause) { const requestId = cause instanceof ApiError && cause.requestId ? ` 请求 ID：${cause.requestId}` : ""; setError({ message: `指令发送失败，请重试。${requestId}`, instruction }); }
    finally { setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("instruction") as HTMLInputElement;
    const instruction = input.value.trim();
    if (!instruction) return;
    await deliver(instruction, form);
  }
  return <form className="prompt-input mobile-composer" onSubmit={(event) => void submit(event)}>
    <label htmlFor="steer-instruction">干预指令</label>
    <div><input id="steer-instruction" name="instruction" maxLength={4000} placeholder="例如：加强结尾悬念" /><button className="button button-primary" type="submit" disabled={pending}>{pending ? "发送中" : "发送"}</button></div>
    {error && <p className="message message-error" role="alert">{error.message}<button type="button" disabled={pending} onClick={() => void deliver(error.instruction)}>重试</button></p>}
  </form>;
}
