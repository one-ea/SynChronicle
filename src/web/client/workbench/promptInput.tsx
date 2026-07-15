import { useState, type FormEvent } from "react";

export function PromptInput({ onSend }: { onSend(instruction: string): Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("instruction") as HTMLInputElement;
    const instruction = input.value.trim();
    if (!instruction) return;
    setPending(true);
    setError(null);
    try {
      await onSend(instruction);
      form.reset();
    } catch {
      setError("指令发送失败，请重试。");
    } finally {
      setPending(false);
    }
  }
  return <form className="prompt-input" onSubmit={(event) => void submit(event)}>
    <label htmlFor="steer-instruction">干预指令</label>
    <div><input id="steer-instruction" name="instruction" maxLength={4000} placeholder="例如：加强结尾悬念" /><button className="button button-primary" type="submit" disabled={pending}>{pending ? "发送中" : "发送"}</button></div>
    {error && <p className="message message-error" role="alert">{error}</p>}
  </form>;
}
