export function renderWebApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SynChronicle · Story Studio</title>
    <style>
      :root { color-scheme: dark; --desk: #0b1016; --desk-soft: #131b25; --paper: #f3eee4; --ink: #19212a; --ink-soft: #51606c; --white: #f5f0e6; --muted: #9da8b2; --faint: #6d7884; --line: rgba(245,240,230,.15); --paper-line: rgba(25,33,42,.16); --lime: #d9ff67; --coral: #df8467; --blue: #a9bbff; }
      * { box-sizing: border-box; }
      ::selection { color: var(--ink); background: var(--lime); }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #3d4a58; border-radius: 999px; }
      body { margin: 0; min-width: 320px; min-height: 100vh; color: var(--white); background: var(--desk); font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, textarea, input, select { font: inherit; }
      button { cursor: pointer; }
      button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
      .app-shell { width: min(1440px, calc(100% - 56px)); margin: 0 auto; padding: 28px 0 42px; }
      .masthead { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
      .brand { display: flex; align-items: center; gap: 13px; }
      .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--lime); color: var(--lime); transform: rotate(-7deg); font: 700 20px/1 Georgia, serif; }
      .brand-name { display: block; color: var(--white); font: 600 19px/1.1 Georgia, serif; letter-spacing: -.025em; }
      .brand-meta { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; }
      .runtime-chip { display: inline-flex; align-items: center; gap: 9px; color: var(--muted); font-size: 12px; white-space: nowrap; }
      .runtime-chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 15px rgba(217,255,103,.8); }
      .runtime-chip[data-state="setup"] i { background: #d4b46d; box-shadow: 0 0 12px rgba(212,180,109,.7); }
      .runtime-chip[data-state="paused"] i { background: #e2ad70; box-shadow: 0 0 12px rgba(226,173,112,.7); }
      .runtime-chip[data-state="error"] i { background: var(--coral); box-shadow: 0 0 12px rgba(223,132,103,.7); }
      .layout { display: grid; grid-template-columns: 190px minmax(0, 1fr) 270px; gap: 24px; padding-top: 24px; }
      .rail { display: flex; min-height: 620px; flex-direction: column; }
      .rail-label { margin: 0 0 14px; color: var(--faint); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
      .rail-title { margin: 0 0 28px; color: var(--white); font: 400 22px/1.1 Georgia, serif; letter-spacing: -.03em; }
      .steps { display: grid; gap: 7px; }
      .step { display: grid; grid-template-columns: 28px 1fr; gap: 10px; width: 100%; padding: 10px 0; border: 0; border-bottom: 1px solid transparent; color: var(--muted); text-align: left; background: transparent; }
      .step-index { color: var(--faint); font-size: 11px; letter-spacing: .04em; }
      .step strong { display: block; color: inherit; font-size: 13px; font-weight: 600; }
      .step small { display: block; margin-top: 3px; color: var(--faint); font-size: 10px; }
      .step.is-active { color: var(--white); border-bottom-color: var(--lime); }
      .step.is-active .step-index { color: var(--lime); }
      .rail-note { margin-top: auto; padding-top: 18px; border-top: 1px solid var(--line); }
      .rail-note p { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--white); font-size: 12px; }
      .rail-note small { display: block; margin-top: 7px; color: var(--faint); font-size: 10px; line-height: 1.5; }
      .rail-note i { width: 6px; height: 6px; border-radius: 50%; background: var(--lime); }
      .workspace { min-width: 0; }
      .workspace-surface { min-height: 620px; padding: clamp(28px, 5vw, 58px); color: var(--ink); background: var(--paper); position: relative; overflow: hidden; }
      .workspace-surface::after { content: ""; position: absolute; right: -120px; bottom: -150px; width: 330px; height: 330px; border: 1px solid rgba(25,33,42,.15); border-radius: 50%; box-shadow: 0 0 0 30px rgba(25,33,42,.035), 0 0 0 62px rgba(25,33,42,.025); pointer-events: none; }
      .workspace-meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 28px; color: var(--ink-soft); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; }
      .workspace-meta strong { color: var(--coral); font-weight: 700; }
      h1 { max-width: 650px; margin: 0; color: var(--ink); font: 400 clamp(46px, 5.4vw, 78px)/.97 Georgia, "Times New Roman", serif; letter-spacing: -.06em; }
      h1 em { color: #465769; font-style: normal; }
      .lede { max-width: 560px; margin: 22px 0 0; color: var(--ink-soft); font-size: 16px; line-height: 1.65; }
      .setup-card { position: relative; z-index: 1; max-width: 660px; margin-top: 48px; padding-top: 22px; border-top: 1px solid var(--paper-line); }
      .setup-card[hidden] { display: none; }
      .setup-card h2 { margin: 0; color: var(--ink); font: 400 26px/1.1 Georgia, serif; letter-spacing: -.035em; }
      .setup-card p { max-width: 490px; margin: 9px 0 18px; color: var(--ink-soft); font-size: 13px; }
      .config-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .field { display: grid; gap: 5px; }
      .field-wide { grid-column: 1 / -1; }
      .field label { color: var(--ink-soft); font-size: 11px; }
      .field label span { color: #7f8b94; }
      .config-form input, .config-form select { width: 100%; min-height: 42px; padding: 10px 11px; border: 1px solid var(--paper-line); border-radius: 0; outline: none; color: var(--ink); background: rgba(255,255,255,.36); }
      .config-form input::placeholder { color: #82909b; }
      .config-form input:focus, .config-form select:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(25,33,42,.1); }
      .config-form small { grid-column: 1 / -1; color: #7d8790; font-size: 11px; }
      .config-form button { grid-column: 1 / -1; justify-self: start; min-height: 43px; padding: 0 22px; border: 1px solid var(--ink); border-radius: 0; color: var(--paper); background: var(--ink); font-weight: 700; }
      .config-form button:hover { color: var(--ink); background: var(--lime); }
      .composer-card { position: relative; z-index: 1; max-width: 760px; margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--paper-line); }
      .composer-card[data-ready="true"] { margin-top: 62px; }
      .composer-card header { display: flex; align-items: baseline; justify-content: space-between; gap: 15px; margin-bottom: 13px; }
      .composer-label { color: var(--ink); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .composer-state { color: var(--ink-soft); font-size: 11px; }
      .composer-card label { display: block; margin-bottom: 8px; color: var(--ink-soft); font-size: 12px; }
      textarea { width: 100%; min-height: 102px; resize: vertical; padding: 14px 15px; border: 1px solid var(--paper-line); border-radius: 0; outline: none; color: var(--ink); background: rgba(255,255,255,.48); }
      textarea::placeholder { color: #8a969d; }
      textarea:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(25,33,42,.1); }
      .composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 11px; }
      .composer-actions small { color: var(--ink-soft); font-size: 11px; }
      .steering { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--paper-line); }
      .steering[hidden], .runtime-actions[hidden] { display: none; }
      .steering label { display: block; margin-bottom: 8px; color: var(--ink-soft); font-size: 11px; }
      .steering-row { display: grid; grid-template-columns: 1fr auto; gap: 9px; }
      .steering input { min-width: 0; min-height: 42px; padding: 10px 11px; border: 1px solid var(--paper-line); border-radius: 0; outline: none; color: var(--ink); background: rgba(255,255,255,.48); }
      .steering input:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(25,33,42,.1); }
      .steering button, .runtime-actions button { min-height: 42px; padding: 0 14px; border: 1px solid var(--ink); border-radius: 0; color: var(--paper); background: var(--ink); font-size: 12px; font-weight: 700; }
      .steering button:hover, .runtime-actions button:hover { color: var(--ink); background: var(--lime); }
      button.primary { min-height: 44px; padding: 0 22px; border: 1px solid var(--ink); border-radius: 0; color: var(--paper); background: var(--ink); font-weight: 700; transition: transform .18s ease, color .18s ease, background .18s ease, opacity .18s ease; }
      button.primary:hover:not(:disabled) { color: var(--ink); background: var(--lime); }
      button.primary:active:not(:disabled) { transform: translateY(1px); }
      button:disabled { opacity: .58; cursor: not-allowed; }
      .notice { display: none; position: relative; z-index: 1; max-width: 760px; margin-top: 13px; padding: 10px 12px; border-left: 2px solid var(--coral); color: #8d493a; background: rgba(223,132,103,.12); font-size: 12px; }
      .notice.show { display: block; }
      .notice[data-tone="success"] { border-left-color: var(--lime); color: #496126; background: rgba(217,255,103,.2); }
      .workspace-foot { position: relative; z-index: 1; display: flex; gap: 17px; margin-top: 32px; color: #89949b; font-size: 10px; }
      .workspace-foot span + span { padding-left: 17px; border-left: 1px solid var(--paper-line); }
      .activity { min-width: 0; }
      .activity-panel { min-height: 620px; padding: 20px; border: 1px solid var(--line); background: var(--desk-soft); }
      .activity-header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
      .activity-header h2 { margin: 0; color: var(--white); font: 400 21px/1.1 Georgia, serif; }
      .activity-header span { color: var(--faint); font-size: 10px; letter-spacing: .1em; }
      .metrics { display: grid; gap: 0; margin-top: 4px; }
      .metric { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 15px 0; border-bottom: 1px solid var(--line); }
      .metric span { color: var(--muted); font-size: 11px; }
      .metric b { color: var(--white); font: 400 23px/1 Georgia, serif; }
      .activity-log { margin-top: 34px; }
      .runtime-actions { display: flex; gap: 8px; margin-top: 20px; }
      .runtime-actions button { flex: 1; }
      .activity-log h3 { margin: 0 0 14px; color: var(--faint); font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
      .feed { display: grid; gap: 14px; max-height: 270px; overflow: auto; }
      .event { position: relative; padding-left: 15px; color: #d3d8dc; font-size: 12px; }
      .event::before { content: ""; position: absolute; top: .56em; left: 0; width: 5px; height: 5px; border: 1px solid var(--blue); border-radius: 50%; }
      .event time { display: block; margin-bottom: 3px; color: var(--faint); font-size: 10px; letter-spacing: .04em; }
      .activity-foot { margin-top: auto; padding-top: 26px; color: var(--faint); font-size: 10px; }
      @media (max-width: 1100px) { .app-shell { width: min(100% - 40px, 900px); } .layout { grid-template-columns: 1fr 260px; } .rail { grid-column: 1 / -1; min-height: auto; flex-direction: row; align-items: center; gap: 22px; } .rail-title { margin: 0; } .rail-label, .rail-note { display: none; } .steps { display: flex; flex: 1; justify-content: flex-end; gap: 19px; } .step { width: auto; grid-template-columns: 22px auto; padding: 7px 0; } .step small { display: none; } }
      @media (max-width: 760px) { .app-shell { width: min(100% - 28px, 600px); padding-top: 18px; } .masthead { align-items: flex-start; } .runtime-chip { padding-top: 7px; } .layout { grid-template-columns: 1fr; gap: 16px; padding-top: 16px; } .rail { display: block; } .rail-title { display: none; } .steps { justify-content: stretch; gap: 0; } .step { flex: 1; grid-template-columns: 18px 1fr; gap: 7px; padding: 8px 7px; } .step strong { font-size: 11px; } .workspace-surface { min-height: auto; padding: 28px 22px 24px; } h1 { font-size: clamp(43px, 13vw, 64px); } .lede { font-size: 14px; } .setup-card, .composer-card, .composer-card[data-ready="true"] { margin-top: 36px; } .config-form { grid-template-columns: 1fr; } .field-wide, .config-form small, .config-form button { grid-column: auto; } .composer-actions { align-items: stretch; flex-direction: column; } .composer-actions button { width: 100%; } .steering-row { grid-template-columns: 1fr; } .steering button { width: 100%; } .workspace-foot { flex-wrap: wrap; gap: 10px; } .activity-panel { min-height: auto; } .activity-log { margin-top: 26px; } }
      @media (prefers-reduced-motion: no-preference) { .workspace-surface, .activity-panel { animation: settle .48s cubic-bezier(.22,1,.36,1) both; } .activity-panel { animation-delay: .08s; } @keyframes settle { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
    </style>
  </head>
  <body>
    <main class="app-shell">
      <header class="masthead"><div class="brand"><span class="brand-mark">S</span><div><strong class="brand-name">SynChronicle</strong><small class="brand-meta">story studio / local edition</small></div></div><div id="runtime-status" class="runtime-chip" data-testid="runtime-status" data-state="idle" role="status"><i></i><span aria-live="polite">正在连接本地引擎</span></div></header>
      <div class="layout">
         <aside class="rail" aria-label="创作流程"><div><p class="rail-label">Workspace</p><h2 class="rail-title">本地创作室</h2></div><nav class="steps"><button class="step is-active" type="button" aria-current="step" data-target="config-panel"><span class="step-index">01</span><span><strong>连接引擎</strong><small>模型与本地密钥</small></span></button><button class="step" type="button" data-target="composer-card"><span class="step-index">02</span><span><strong>提交 brief</strong><small>一句话定方向</small></span></button><button class="step" type="button" data-target="activity-panel"><span class="step-index">03</span><span><strong>观察创作</strong><small>状态与现场记录</small></span></button></nav><div class="rail-note"><p><i></i>作品文件保存在本机</p><small>你掌握每一份正文、配置与运行记录。</small></div></aside>
        <section class="workspace" aria-label="创作工作面"><div class="workspace-surface"><div class="workspace-meta"><span><strong>Story engine</strong> / first run</span><span>Local / 01</span></div><h1>让一个念头，<em>长成一部小说。</em></h1><p class="lede">把灵感交给 Architect、Writer 与 Editor。你负责方向，SynChronicle 负责让世界持续生长。</p>
          <section id="config-panel" class="setup-card" data-testid="config-form"><h2>先连接你的写作引擎</h2><p>保存一次模型配置，之后每次进入本地工作台都可以直接继续。密钥只留在这台机器上。</p><form id="settings" class="config-form"><div class="field"><label for="provider">模型服务商</label><select id="provider"><option value="ollama">Ollama（本机）</option><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></div><div class="field"><label for="model-input">模型名称</label><input id="model-input" placeholder="例如 qwen3:14b" /></div><div class="field field-wide"><label for="base-url">接口地址 <span>(可选)</span></label><input id="base-url" placeholder="例如 http://localhost:11434/v1" /></div><div class="field field-wide"><label for="api-key">API Key <span>(Ollama 可留空)</span></label><input id="api-key" type="password" placeholder="仅保存在本机配置" /></div><small>配置只写入本机，不会上传到 SynChronicle。</small><button type="submit">保存配置</button></form></section>
           <section id="composer-card" class="composer-card" data-ready="false"><header><span class="composer-label">创作 brief</span><span id="prompt-state" class="composer-state">等待连接</span></header><form id="composer"><label for="prompt">你想写什么？</label><textarea id="prompt" aria-label="创作需求" disabled placeholder="例如：写一本发生在海上空间站的悬疑长篇……"></textarea><div class="composer-actions"><small>一句话足够。后续可以在运行中继续干预。</small><button id="run" class="primary" type="submit" disabled>先保存配置后开始</button></div></form><div id="steering" class="steering" hidden><label for="steer-input">运行中干预</label><div class="steering-row"><input id="steer-input" placeholder="告诉 Writer 下一步怎么走" /><button id="steer-button" type="button">发送干预</button></div></div></section>
           <div id="notice" class="notice" role="alert" tabindex="-1"></div><footer class="workspace-foot"><span>Ctrl + Enter 提交</span><span>本地运行</span><span>可随时恢复</span></footer>
        </div></section>
         <aside class="activity" aria-label="运行状态"><div id="activity-panel" class="activity-panel"><header class="activity-header"><h2>运行状态</h2><span>NOW</span></header><div class="metrics"><div class="metric"><span>引擎状态</span><b id="state">setup</b></div><div class="metric"><span>当前模型</span><b id="model">—</b></div><div class="metric"><span>输入 tokens</span><b id="input">0</b></div><div class="metric"><span>输出 tokens</span><b id="output">0</b></div></div><p class="footer" id="config">请配置模型后开始</p><div id="runtime-actions" class="runtime-actions" hidden><button id="resume" type="button">恢复上一轮</button><button id="new-run" type="button">重新开始</button></div><section class="activity-log"><h3>现场记录</h3><div id="feed" class="feed" role="log" aria-live="polite"><div class="event"><time>NOW</time>本地工作室已就位，等你投递第一颗灵感。</div></div></section><div class="activity-foot">LOCAL RUNTIME · PRIVATE BY DEFAULT</div></div></aside>
      </div>
    </main>
    <script>
      const $ = (id) => document.getElementById(id);
      const status = $('runtime-status');
      const notice = $('notice');
      const run = $('run');
      const prompt = $('prompt');
      const composerCard = $('composer-card');
      const configPanel = $('config-panel');
      const steering = $('steering');
      const promptState = $('prompt-state');
      const runtimeActions = $('runtime-actions');
      const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(value || 0);
      const stateLabels = { running: '引擎运行中', completed: '本轮已完成', paused: '等待继续', idle: '本地引擎就绪', closed: '服务已关闭', setup: '等待本地配置' };
      function showNotice(message, tone = 'error') { notice.textContent = message; notice.dataset.tone = tone; notice.classList.add('show'); notice.focus({ preventScroll: true }); }
      function clearNotice() { notice.textContent = ''; notice.classList.remove('show'); }
      function renderEvents(events) {
        const feed = $('feed');
        feed.replaceChildren();
        if (!events.length) {
          const empty = document.createElement('div'); empty.className = 'event'; empty.textContent = '暂时没有新的现场记录。'; feed.append(empty); return;
        }
        events.slice(-12).reverse().forEach((event) => {
          const item = document.createElement('div'); item.className = 'event';
          const time = document.createElement('time'); time.textContent = new Date(event.time || Date.now()).toLocaleTimeString('zh-CN');
          const message = document.createElement('span'); message.textContent = String(event.message || event.summary || event.type || '');
          item.append(time, message); feed.append(item);
        });
      }
      async function refresh() {
        try {
          const response = await fetch('/api/status');
          const data = await response.json();
          const state = data.snapshot?.runtimeState || (data.configured ? 'idle' : 'setup');
          const ready = Boolean(data.configured);
          const active = state === 'running';
          configPanel.hidden = ready;
          composerCard.dataset.ready = String(ready);
          steering.hidden = !ready;
          runtimeActions.hidden = !ready || !['paused', 'completed'].includes(state);
          $('resume').hidden = state !== 'paused';
          $('new-run').hidden = !['paused', 'completed'].includes(state);
          prompt.disabled = !ready || active || state === 'closed';
          run.disabled = !ready || active || state === 'closed';
          promptState.textContent = ready ? (active ? '正在写作' : state === 'paused' ? '可恢复或补充指令' : '可以开始') : '等待连接';
          run.textContent = ready ? (active ? '创作进行中…' : state === 'completed' ? '开始下一轮' : state === 'paused' ? '继续创作' : '开始创作') : '先保存配置后开始';
          status.dataset.state = state === 'error' ? 'error' : state;
          const activeTarget = !ready ? 'config-panel' : active ? 'activity-panel' : 'composer-card';
          document.querySelectorAll('.step[data-target]').forEach((item) => item.removeAttribute('aria-current'));
          document.querySelector('.step[data-target="' + activeTarget + '"]')?.setAttribute('aria-current', 'step');
          status.querySelector('span').textContent = stateLabels[state] || '运行状态：' + state;
          $('state').textContent = state;
          $('input').textContent = formatNumber(data.snapshot?.usage?.inputTokens);
          $('output').textContent = formatNumber(data.snapshot?.usage?.outputTokens);
          $('model').textContent = data.snapshot?.model || '—';
          $('config').textContent = ready ? '配置已加载 · ' + (data.snapshot.provider || 'local') : (data.error || '请配置模型后开始');
          if (data.events) renderEvents(data.events);
        } catch (error) { status.dataset.state = 'error'; status.querySelector('span').textContent = '本地服务未连接'; showNotice('无法连接本地服务，请确认 SynChronicle 仍在运行。'); }
      }
      async function post(path, body) { const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败'); return data; }
      $('composer').addEventListener('submit', async (event) => { event.preventDefault(); clearNotice(); const value = prompt.value.trim(); if (!value) { showNotice('先写下一句创作需求。'); return; } run.disabled = true; run.textContent = '正在启动…'; try { const state = $('state').textContent; await post(document.querySelector('[data-ready="true"]') && ['completed', 'paused'].includes(state) ? '/api/continue' : '/api/run', { prompt: value }); prompt.value = ''; showNotice('创作已启动，右侧会持续显示现场状态。', 'success'); } catch (error) { showNotice(error.message || '启动失败'); } finally { await refresh(); } });
      prompt.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('composer').requestSubmit(); } });
      $('settings').addEventListener('submit', async (event) => { event.preventDefault(); clearNotice(); try { await post('/api/config', { provider: $('provider').value, model: $('model-input').value, baseUrl: $('base-url').value, apiKey: $('api-key').value }); $('api-key').value = ''; showNotice('模型配置已保存，可以开始创作。', 'success'); await refresh(); } catch (error) { showNotice(error.message || '配置保存失败'); } });
      $('steer-button').addEventListener('click', async () => { const value = $('steer-input').value.trim(); if (!value) { showNotice('先写下要调整的方向。'); return; } try { await post('/api/inject', { text: value }); $('steer-input').value = ''; showNotice('干预已加入下一次运行。', 'success'); await refresh(); } catch (error) { showNotice(error.message || '干预发送失败'); } });
       $('resume').addEventListener('click', async () => { try { const result = await post('/api/resume'); showNotice(result.started ? '正在恢复上一轮创作。' : '没有可恢复的运行记录。', result.started ? 'success' : 'error'); await refresh(); } catch (error) { showNotice(error.message || '恢复失败'); } });
      $('new-run').addEventListener('click', () => { prompt.focus(); showNotice('写下新的 brief，即可开始下一轮。', 'success'); });
       document.querySelectorAll('.step[data-target]').forEach((step) => step.addEventListener('click', () => { const target = $(step.dataset.target); const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; target?.scrollIntoView({ behavior, block: 'start' }); document.querySelectorAll('.step').forEach((item) => item.removeAttribute('aria-current')); step.setAttribute('aria-current', 'step'); }));
      refresh(); setInterval(refresh, 1400);
    </script>
  </body>
</html>`;
}
