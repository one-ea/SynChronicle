import type { ConnectionState, RunViewState } from "../realtime/useRunEvents.js";

const connectionCopy: Record<ConnectionState, string> = {
  idle: "等待运行",
  connecting: "正在连接",
  connected: "实时连接正常",
  reconnecting: "正在重新连接",
  backpressure: "创作流过快，正在从游标恢复",
  error: "实时事件解析失败",
};

export function RunSidebar({ state, connection, status, collapsed, onToggle }: { state: RunViewState; connection: ConnectionState; status?: string; collapsed: boolean; onToggle(): void }) {
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
      <section className="agent-list"><h3>Agents</h3><p><span>Architect</span><small>结构待命</small></p><p><span>Writer</span><small>{status === "running" ? "正在创作" : "待命"}</small></p><p><span>Reviewer</span><small>{state.reflection ? "已回传评审" : "待命"}</small></p></section>
      <section className="usage-card"><h3>Usage</h3><p>本次运行的 token 与费用将在服务端 usage 汇总后显示。</p></section>
      <div className="control-placeholder" aria-label="运行控制占位"><button type="button" disabled title="将在后续任务接入">暂停</button><button type="button" disabled title="将在后续任务接入">继续</button><button type="button" disabled title="将在后续任务接入">终止</button></div>
    </div>}
  </aside>;
}
