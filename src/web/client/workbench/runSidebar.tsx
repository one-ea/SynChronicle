import type { ConnectionState, RunViewState } from "../realtime/useRunEvents.js";
import { useState, type FormEvent } from "react";
import type { WorkbenchProject } from "../pages/workbench.js";
import { ApiError } from "../api/client.js";

const connectionCopy: Record<ConnectionState, string> = {
  idle: "等待运行",
  connecting: "正在连接",
  connected: "实时连接正常",
  reconnecting: "正在重新连接",
  backpressure: "创作流过快，正在从游标恢复",
  error: "实时事件解析失败",
};

interface RunSidebarProps {
  state: RunViewState;
  connection: ConnectionState;
  status?: string;
  agents: NonNullable<WorkbenchProject["agents"]>;
  usage?: WorkbenchProject["usage"];
  pendingQuestion?: WorkbenchProject["pendingQuestion"];
  diagnostics: string | null;
  abortWaiting: boolean;
  controlsDisabled: boolean;
  collapsed: boolean;
  onToggle(): void;
  onCommand(command: "pause" | "resume" | "abort"): Promise<void>;
  onAnswer(questionId: string, answers: Record<string, string>): Promise<void>;
  onSwitchModel(role: string, provider: string, model: string): Promise<void>;
  onDiagnose(): Promise<void>;
}

export function RunSidebar(props: RunSidebarProps) {
  const { state, connection, status, collapsed, onToggle } = props;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => Promise<void> } | null>(null);
  async function run(action: () => Promise<void>) { setPending(true); setFailure(null); try { await action(); } catch (error) { const requestId = error instanceof ApiError && error.requestId ? ` 请求 ID：${error.requestId}` : ""; setFailure({ message: `${error instanceof ApiError && error.kind === "request" ? "网络或服务请求失败" : "操作失败"}。${requestId}`, retry: action }); } finally { setPending(false); } }
  async function answer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.pendingQuestion) return;
    const data = new FormData(event.currentTarget);
    const answers = Object.fromEntries(props.pendingQuestion.questions.map(({ question }) => [question, String(data.get(question) ?? "")]).filter(([, value]) => value));
    await run(() => props.onAnswer(props.pendingQuestion!.id, answers));
  }
  async function model(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => props.onSwitchModel(String(data.get("role")), String(data.get("provider")), String(data.get("model"))));
  }
  const connectionRole = connection === "backpressure" || connection === "error" ? "alert" : "status";
  return <aside className="workbench-panel run-sidebar" aria-label="运行状态" data-collapsed={collapsed}>
    <header className="panel-heading">
      <button className="panel-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "展开运行状态" : "折叠运行状态"}>{collapsed ? "<" : ">"}</button>
      <div><p className="eyebrow">Run room</p><h2>运行状态</h2></div>
    </header>
    {!collapsed && <div className="run-sidebar-body">
      <p className={`connection-state connection-${connection}`} role={connectionRole}>{connectionCopy[connection]}</p>
      <dl className="run-facts"><div><dt>阶段</dt><dd>{status ?? "未开始"}</dd></div><div><dt>游标</dt><dd>{state.lastSequence}</dd></div><div><dt>上下文事件</dt><dd>{state.events.length}/200</dd></div></dl>
      {state.reflection && <section className="reflection-card" aria-label="反思进度">
        <p>Reviewer · 第 {state.reflection.round ?? "-"}/{state.reflection.maxRounds ?? "-"} 轮</p>
        <strong>{state.reflection.score ?? "-"}</strong><small>{state.reflection.passed ? "通过" : "继续修订"}</small>
      </section>}
      <section className="agent-list"><h3>Agents</h3>{props.agents.length ? props.agents.map((agent) => <p key={agent.name}><span>{agent.name}</span><small>{agent.summary ?? agent.state}</small></p>) : <p className="muted-copy">暂无 Agent 状态事件。</p>}</section>
      <section className="usage-card"><h3>Usage</h3>{props.usage ? <><p>{props.usage.totalTokens} tokens</p><p>${props.usage.cost}</p></> : <p>暂无用量记录。</p>}</section>
      <div className="control-placeholder" aria-label="运行控制"><button type="button" disabled={props.controlsDisabled || pending} onClick={() => void run(() => props.onCommand("pause"))} aria-label="暂停运行">暂停</button><button type="button" disabled={props.controlsDisabled || pending} onClick={() => void run(() => props.onCommand("resume"))} aria-label="继续运行">继续</button><button type="button" disabled={props.controlsDisabled || pending} onClick={() => void run(() => props.onCommand("abort"))} aria-label="终止运行">终止</button></div>
      {props.abortWaiting && <p className="message" role="status">正在等待 durable commit 完成，终止将在安全边界生效。</p>}
      {failure && <p className="message message-error" role="alert">{failure.message}<button type="button" onClick={() => void run(failure.retry)}>重试</button></p>}
      {props.pendingQuestion && <form className="sidebar-form" onSubmit={(event) => void answer(event)}><h3>需要你的回答</h3>{props.pendingQuestion.questions.map((question) => <label key={question.question}>{question.question}<select name={question.question} required defaultValue=""><option value="" disabled>请选择</option>{question.options.map((option) => <option key={option}>{option}</option>)}</select></label>)}<button type="submit" disabled={pending}>提交回答</button></form>}
      <form className="sidebar-form" onSubmit={(event) => void model(event)}><h3>模型切换</h3><label>角色<input name="role" required /></label><label>Provider<input name="provider" required /></label><label>模型<input name="model" required /></label><button type="submit" disabled={props.controlsDisabled || pending}>切换模型</button></form>
      <section className="diagnostics-card"><button type="button" disabled={props.controlsDisabled || pending} onClick={() => void run(props.onDiagnose)}>运行诊断</button>{props.diagnostics && <p role="status">{props.diagnostics}</p>}</section>
    </div>}
  </aside>;
}
