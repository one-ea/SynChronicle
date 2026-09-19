export function renderWebApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SynChronicle 控制台</title>
    <script>(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'||t==='light'){d.classList.add(t);}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){d.classList.add('dark');}}catch(e){}})();</script>
    <style>
      :root {
        color-scheme: light;
        --heat-100: #fa5d19; --heat-90: rgba(250, 93, 25, .9); --heat-40: rgba(250, 93, 25, .4);
        --heat-20: rgba(250, 93, 25, .2); --heat-12: rgba(250, 93, 25, .12); --heat-8: rgba(250, 93, 25, .06);
        --ink: #262626; --paper: #ffffff; --bg: #f9f9f9; --side-bg: #f7f7f8; --raised: #ffffff;
        --muted: rgba(38, 38, 38, .58); --faint: rgba(38, 38, 38, .4);
        --line: #e8e8e8; --line-faint: #ededed;
        --alpha-4: rgba(38, 38, 38, .04); --alpha-6: rgba(38, 38, 38, .06); --alpha-7: rgba(38, 38, 38, .08);
        --success: #1f9d52; --success-dot: #42c366; --warning: #ecb730; --error: #dc2626;
        --btn-radius: 10px; --radius-sm: 8px; --radius: 10px; --radius-lg: 16px;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, .04); --shadow-lg: 0 8px 16px -12px rgba(0, 0, 0, .19); --shadow-xl: 0 18px 32px -24px rgba(0, 0, 0, .28);
        --dur-fast: .15s; --dur: .2s; --ease: ease;
        --font: "Inter", "Google Sans Text", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      :root.dark {
        color-scheme: dark;
        --ink: #f5f5f5; --paper: #171717; --bg: #0a0a0a; --side-bg: #101010; --raised: #1f1f1f;
        --muted: rgba(255, 255, 255, .58); --faint: rgba(255, 255, 255, .4);
        --line: #333; --line-faint: #2a2a2a;
        --alpha-4: rgba(255, 255, 255, .05); --alpha-6: rgba(255, 255, 255, .08); --alpha-7: rgba(255, 255, 255, .1);
        --heat-8: rgba(250, 93, 25, .1);
      }
      * { box-sizing: border-box; }
      ::selection { background: var(--heat-12); color: var(--ink); }
      body { margin: 0; min-width: 320px; color: var(--ink); background: var(--bg); font: 400 14px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
      button, input, textarea { font: inherit; color: inherit; }
      button { cursor: pointer; }
      h1, h2, h3, h4 { letter-spacing: -.02em; font-weight: 700; line-height: 1.2; margin: 0; }
      button:focus-visible, input:focus-visible, textarea:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--heat-100); }
      .topbar { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 0 22px; background: var(--paper); border-bottom: 1px solid var(--line); }
      .brand { display: inline-flex; align-items: baseline; gap: 1px; color: var(--ink); font-weight: 800; font-size: 16px; letter-spacing: -.03em; white-space: nowrap; }
      .brand em { color: var(--heat-100); font-style: normal; }
      .brand small { margin-left: 9px; color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: 0; }
      .topbar-right { display: flex; align-items: center; gap: 12px; }
      .view-site { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 11px; border: 1px solid var(--line); border-radius: var(--btn-radius); background: var(--paper); color: var(--muted); font-size: 12px; font-weight: 500; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
      .view-site:hover { color: var(--ink); background: var(--alpha-4); }
      .view-site svg { width: 13px; height: 13px; }
      .chip { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: var(--btn-radius); background: var(--alpha-4); color: var(--ink); font-size: 12px; font-weight: 500; white-space: nowrap; }
      .chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--success-dot); }
      .chip[data-state="running"] i { background: var(--heat-100); animation: blink 1.6s infinite; }
      .chip[data-state="error"] i, .chip[data-state="closed"] i { background: var(--error); }
      .chip.small { height: 24px; padding: 0 9px; font-size: 11px; }
      .chip.ok { background: rgba(66, 195, 102, .14); color: var(--success); }
      .chip.warn { background: rgba(220, 38, 38, .1); color: var(--error); }
      .theme-switcher { display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: var(--alpha-4); }
      .theme-btn { min-height: 26px; padding: 3px 9px; border: 0; border-radius: var(--btn-radius); background: transparent; color: var(--muted); font-size: 11.5px; font-weight: 500; line-height: 1.3; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
      .theme-btn:hover, .theme-btn.active { color: var(--ink); background: var(--paper); box-shadow: var(--shadow-sm); }
      .progress { position: relative; height: 3px; overflow: hidden; background: var(--heat-12); }
      .progress[hidden] { display: none; }
      .progress span { position: absolute; inset: 0; background: var(--heat-100); animation: indeterminate 1.9s ease infinite; }
      @keyframes indeterminate { 0% { transform: translateX(-45%) scaleX(.3); } 55% { transform: translateX(50%) scaleX(.5); } 100% { transform: translateX(110%) scaleX(.3); } }
      @keyframes blink { 50% { opacity: .35; } }
      .admin { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: calc(100vh - 56px); }
      .side { display: flex; flex-direction: column; gap: 2px; padding: 18px 14px; background: var(--side-bg); border-right: 1px solid var(--line); }
      .side-label { margin: 14px 12px 4px; padding-bottom: 7px; border-bottom: 1px solid var(--line-faint); color: var(--faint); font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
      .side-label:first-child { margin-top: 0; }
      .side-nav { display: grid; gap: 2px; }
      .side-nav button { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: var(--btn-radius); background: transparent; color: var(--ink); font-size: 13.5px; font-weight: 500; text-align: left; transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
      .side-nav button:hover { background: var(--alpha-4); }
      .side-nav button[aria-current="page"] { background: var(--alpha-6); font-weight: 600; }
      .side-nav svg { width: 16px; height: 16px; flex: none; color: var(--muted); }
      .side-nav button[aria-current="page"] svg { color: var(--heat-100); }
      .side-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line-faint); color: var(--faint); font-size: 11px; line-height: 1.6; }
      .main { min-width: 0; max-width: 1160px; width: 100%; margin: 0 auto; padding: 28px 30px 64px; }
      .page[hidden] { display: none; }
      .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
      .page-head h1 { font-size: 26px; }
      .page-head .meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
      .head-actions { display: flex; gap: 8px; }
      .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
      .stat-split { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--paper); }
      .stat-top { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--bg); border-bottom: 1px solid var(--line-faint); color: var(--muted); font-size: 11.5px; font-weight: 600; }
      .stat-split b { display: block; padding: 12px 14px 14px; font-size: 24px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stat-split b[data-state="running"] { color: var(--heat-100); }
      .stat-split b[data-state="error"] { color: var(--error); }
      .grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .9fr); gap: 20px; align-items: start; }
      .card { border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--paper); padding: clamp(20px, 3vw, 28px); box-shadow: var(--shadow-sm); }
      .stack { display: grid; gap: 20px; }
      .announce { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 5px 13px 5px 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font-size: 12px; box-shadow: var(--shadow-sm); }
      .announce b { padding: 2px 9px; border-radius: 999px; background: var(--heat-12); color: var(--heat-100); font-size: 11px; font-weight: 600; letter-spacing: .02em; }
      .announce span { color: var(--muted); }
      .hero h2 { max-width: 560px; font-size: clamp(26px, 3.4vw, 34px); line-height: 1.15; }
      .hero .intro { max-width: 540px; margin: 12px 0 24px; color: var(--muted); font-size: 14.5px; }
      .tf { position: relative; }
      .tf input, .tf textarea { width: 100%; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink); transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
      .tf textarea { min-height: 124px; padding: 15px 14px; resize: vertical; }
      .tf input:hover, .tf textarea:hover { border-color: var(--faint); }
      .tf input:focus, .tf textarea:focus { border-color: var(--heat-100); box-shadow: 0 0 0 3px var(--heat-20); outline: none; }
      .tf label { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); padding: 0 4px; background: var(--paper); color: var(--muted); font-size: 13.5px; pointer-events: none; transition: all var(--dur-fast) var(--ease); }
      .tf textarea + label { top: 16px; transform: none; }
      .tf input:focus + label, .tf input:not(:placeholder-shown) + label, .tf textarea:focus + label, .tf textarea:not(:placeholder-shown) + label { top: 0; transform: translateY(-50%); font-size: 11.5px; font-weight: 600; }
      .tf input:focus + label, .tf textarea:focus + label { color: var(--heat-100); }
      .helper { display: block; margin: 6px 4px 0; color: var(--faint); font-size: 11.5px; }
      .form-grid { display: grid; gap: 18px; }
      .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .seg { display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: var(--alpha-4); }
      .seg label { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 34px; padding: 0 8px; border-radius: var(--btn-radius); color: var(--muted); font-size: 12.5px; font-weight: 500; text-align: center; cursor: pointer; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
      .seg input { position: absolute; opacity: 0; pointer-events: none; }
      .seg label:has(input:checked) { color: var(--ink); background: var(--paper); box-shadow: var(--shadow-sm); font-weight: 600; }
      .seg label:has(input:focus-visible) { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--heat-100); }
      .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 8px 16px; border: 0; border-radius: var(--btn-radius); font-size: 13.5px; font-weight: 500; line-height: 1.35; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease); }
      .btn:active { transform: scale(.995); }
      .btn-filled { background: var(--heat-100); color: #fffbf5; }
      .btn-filled:hover { background: var(--heat-90); }
      .btn-tonal { background: var(--alpha-4); color: var(--ink); }
      .btn-tonal:hover { background: var(--alpha-6); }
      .btn-tonal:active { background: var(--alpha-7); }
      .btn-text { background: transparent; color: var(--heat-100); padding: 8px 12px; font-weight: 600; }
      .btn-text:hover { background: var(--heat-8); }
      .btn:disabled { pointer-events: none; background: var(--alpha-4); color: var(--faint); }
      .actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .actions small { color: var(--muted); font-size: 11.5px; }
      .section-title { margin: 0 0 16px; font-size: 17px; }
      .steering { display: none; }
      .steering.show { display: block; }
      .steer-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
      .rowlines { display: grid; }
      .rowline { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 2px; border-bottom: 1px solid var(--line-faint); font-size: 13.5px; }
      .rowline:last-child { border-bottom: 0; }
      .rowline > span { color: var(--ink); font-weight: 500; }
      .rowline .pills { display: flex; gap: 6px; align-items: center; }
      .pill { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .pill.ok { background: rgba(66, 195, 102, .14); color: var(--success); }
      .pill.muted { background: var(--alpha-6); color: var(--muted); }
      .pill.warn { background: var(--heat-12); color: var(--heat-100); }
      .pill.bad { background: rgba(220, 38, 38, .1); color: var(--error); }
      .pill svg { width: 11px; height: 11px; }
      .feed { display: grid; max-height: 300px; overflow: auto; }
      .feed.tall { max-height: 62vh; }
      .event { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--line-faint); font-size: 12.5px; }
      .event:last-child { border-bottom: 0; }
      .event::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--heat-100); opacity: .75; align-self: center; }
      .event span { color: var(--ink); line-height: 1.5; overflow: hidden; text-overflow: ellipsis; }
      .event time { color: var(--faint); font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .empty { color: var(--muted); font-size: 12.5px; }
      .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .panel-head h3 { margin: 0; font-size: 15px; }
      .panel-head span { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
      .live-text { max-height: 220px; overflow: auto; font-size: 13px; line-height: 1.8; color: var(--muted); white-space: pre-wrap; word-break: break-word; }
      .reader { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
      .tree-card { padding: 16px; }
      .tree { display: grid; gap: 1px; max-height: 70vh; overflow: auto; align-content: start; }
      .vol { margin: 12px 4px 4px; color: var(--faint); font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .arc { margin: 8px 4px 3px; color: var(--muted); font-size: 11.5px; }
      .trow { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--ink); font-size: 13px; text-align: left; transition: background var(--dur-fast) var(--ease); }
      .trow:hover { background: var(--alpha-4); }
      .trow.active { background: var(--alpha-6); font-weight: 600; }
      .trow .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .s-completed { background: var(--heat-100); }
      .s-in-progress { background: var(--heat-100); animation: blink 1.6s infinite; }
      .s-pending { background: var(--line); }
      .s-rewrite { background: var(--error); }
      .trow small { margin-left: auto; color: var(--faint); font-size: 10.5px; font-variant-numeric: tabular-nums; }
      .chapter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
      .chapter-head h2 { font-size: 21px; }
      .meta { color: var(--muted); font-size: 12px; }
      .chapter-text { max-width: 68ch; margin-top: 18px; font-size: 15px; line-height: 1.9; }
      .chapter-text p { margin: 0 0 1em; }
      .summary-block { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--line-faint); border-radius: var(--radius); background: var(--bg); font-size: 13px; }
      .summary-block h4 { margin: 0 0 6px; font-size: 13px; }
      .summary-block ul { margin: 6px 0 0; padding-left: 18px; }
      .review-block { margin-top: 12px; padding: 14px 16px; border: 1px solid var(--line-faint); border-radius: var(--radius); background: var(--bg); }
      .review-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .dim { display: grid; grid-template-columns: 110px 1fr 44px; gap: 10px; align-items: center; margin-top: 10px; font-size: 12.5px; }
      .dim .bar { position: relative; height: 7px; border-radius: 999px; background: var(--alpha-6); overflow: hidden; }
      .dim .bar i { position: absolute; top: 0; bottom: 0; left: 0; width: var(--w, 0%); border-radius: inherit; background: var(--heat-100); }
      .dim.low .bar i { background: var(--error); }
      #notice { position: fixed; left: 16px; bottom: 16px; z-index: 60; display: flex; align-items: center; gap: 12px; max-width: min(420px, calc(100vw - 32px)); min-height: 46px; padding: 10px 16px; border-radius: 12px; background: #262626; color: #fff; font-size: 13px; box-shadow: var(--shadow-xl); opacity: 0; transform: translateY(12px); pointer-events: none; transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
      #notice.show { opacity: 1; transform: none; }
      #notice::before { content: ""; flex: none; width: 9px; height: 9px; border-radius: 50%; background: #ff8b5e; }
      #notice[data-tone="success"]::before { background: #42c366; }
      :root.dark #notice { background: #1f1f1f; border: 1px solid #333; }
      @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } .reader { grid-template-columns: 1fr; } .tree { max-height: 34vh; } .stat-row { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 860px) { .admin { grid-template-columns: 1fr; } .side { flex-direction: row; align-items: center; gap: 6px; padding: 10px 14px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; } .side-label, .side-foot { display: none; } .side-nav { display: flex; gap: 4px; } .side-nav button { width: auto; min-height: 36px; white-space: nowrap; } .main { padding: 20px 16px 52px; } }
      @media (max-width: 560px) { .topbar { padding: 0 14px; } .brand small { display: none; } .theme-switcher { display: none; } .form-row { grid-template-columns: 1fr; } .actions { align-items: stretch; flex-direction: column; } .actions .btn { width: 100%; } .steer-row { grid-template-columns: 1fr; } .steer-row .btn { width: 100%; } .seg label { font-size: 11px; padding: 0 4px; } .stat-row { grid-template-columns: 1fr 1fr; } }
      @media (prefers-reduced-motion: no-preference) { .card { animation: enter .3s ease both; } @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="#" aria-label="SynChronicle 控制台">S<em>—</em><small>本地创作控制台</small></a>
      <div class="topbar-right">
        <a class="view-site" href="/read"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3l-1.42-1.42l9.3-9.29H14V3Z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5Z"/></svg>前台阅读</a>
        <div id="runtime-status" class="chip" data-testid="runtime-status" data-state="idle" role="status"><i aria-hidden="true"></i><span aria-live="polite">正在检查引擎</span></div>
        <div class="theme-switcher" role="group" aria-label="主题选择">
          <button type="button" class="theme-btn" data-theme="light" aria-pressed="false">Light</button>
          <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false">Dark</button>
          <button type="button" class="theme-btn" data-theme="system" aria-pressed="true">System</button>
        </div>
      </div>
    </header>
    <div id="progress" class="progress" role="progressbar" aria-label="引擎运行中" hidden><span></span></div>
    <div class="admin">
      <aside class="side" aria-label="主导航">
        <div class="side-label">工作区</div>
        <nav class="side-nav">
          <button type="button" data-view="overview" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>创作概览</button>
        </nav>
        <div class="side-label">内容</div>
        <nav class="side-nav">
          <button type="button" data-view="reader"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.2C10.4 4.5 8 4 4 4v13.5c4 0 6.4.5 8 2.3 1.6-1.8 4-2.3 8-2.3V4c-4 0-6.4.5-8 2.2z"/><path d="M12 6.2v13.6"/></svg>章节与大纲</button>
          <button type="button" data-view="entities"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="8.5" y1="7.5" x2="15.5" y2="7.5"/><line x1="7.5" y1="8.5" x2="10.5" y2="15.5"/><line x1="16.5" y1="8.5" x2="13.5" y2="15.5"/></svg>人物图谱</button>
          <button type="button" data-view="records"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/></svg>运行记录</button>
        </nav>
        <div class="side-label">管理</div>
        <nav class="side-nav">
          <button type="button" data-view="settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h9M17.5 8H20M4 16h3M11.5 16H20"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/></svg>配置</button>
        </nav>
        <div class="side-foot">Local runtime<br />作品、配置与运行记录均保存在本机。</div>
      </aside>
      <main class="main">
        <section class="page" data-page="overview" aria-label="创作概览">
          <div class="page-head">
            <div><h1>创作概览</h1><p class="meta">从一个 brief 开始，持续推进你的故事。</p></div>
            <div class="head-actions" id="runtime-actions" hidden><button id="resume" class="btn btn-tonal" type="button">恢复上一轮</button><button id="new-run" class="btn btn-text" type="button">新建 brief</button></div>
          </div>
          <div class="stat-row">
            <div class="stat-split"><div class="stat-top">引擎</div><b id="state">setup</b></div>
            <div class="stat-split"><div class="stat-top">模型</div><b id="model">—</b></div>
            <div class="stat-split"><div class="stat-top">输入 tokens</div><b id="input">0</b></div>
            <div class="stat-split"><div class="stat-top">输出 tokens</div><b id="output">0</b></div>
          </div>
          <div class="grid">
            <section class="stack">
              <div class="card hero">
                <div class="announce"><b>Local</b><span>作品、配置与运行记录均保存在本机</span></div>
                <h2>把想法变成一条可继续的故事线。</h2>
                <p class="intro">Architect 负责结构，Writer 负责正文，Editor 负责校准。你只需要提供方向。</p>
                <section id="composer" aria-label="创作 brief">
                  <div class="tf"><textarea id="prompt" aria-label="创作需求" placeholder=" " disabled></textarea><label for="prompt">你想写什么？</label></div>
                  <div class="actions" style="margin-top:14px"><small>支持 Ctrl / Cmd + Enter 提交。</small><button id="run" class="btn btn-filled" type="button" disabled>开始创作</button></div>
                  <div id="steering-panel" class="steering" style="margin-top:18px">
                    <div class="steer-row"><div class="tf"><input id="steer-input" placeholder=" " /><label for="steer-input">注入干预（下轮生效）</label></div><button id="steer-button" class="btn btn-tonal" type="button">发送干预</button></div>
                    <div class="steer-row" style="margin-top:10px"><div class="tf"><input id="steer-realtime-input" placeholder=" " /><label for="steer-realtime-input">偏航即时重定向 (Steer: 打断当前章并重写)</label></div><button id="steer-realtime-button" class="btn btn-filled" type="button" style="background:var(--heat-100,#fa5d19);color:#fff">打断重写</button></div>
                  </div>
                </section>
              </div>
              <div class="card">
                <h3 class="section-title">连接引擎</h3>
                <form id="settings" class="form-grid" data-testid="config-form">
                  <div>
                    <label class="helper" style="margin:0 0 6px 2px;font-size:12px;color:var(--muted)">接口协议类型</label>
                    <div class="seg" role="radiogroup" aria-label="协议类型">
                      <label><input type="radio" name="protocol-type" value="openai" checked /><span>OpenAI 兼容</span></label>
                      <label><input type="radio" name="protocol-type" value="anthropic" /><span>Anthropic</span></label>
                      <label><input type="radio" name="protocol-type" value="google" /><span>Gemini</span></label>
                    </div>
                  </div>
                  <div class="form-row">
                    <div>
                      <div class="tf"><input id="base-url" placeholder=" " required /><label for="base-url">接口地址 (Base URL)</label></div>
                      <small class="helper">如 https://api.openai.com/v1 或中转端点</small>
                    </div>
                    <div>
                      <div class="tf"><input id="api-key" type="password" placeholder=" " /><label for="api-key">API Key</label></div>
                      <small class="helper">密钥仅保存在本机</small>
                    </div>
                  </div>
                  <div>
                    <div class="tf"><input id="model-input" placeholder=" " required /><label for="model-input">模型名称 (Model)</label></div>
                    <small class="helper">如 gpt-4o, claude-3-7-sonnet, deepseek-chat, gemini-2.5-flash</small>
                  </div>
                  <div class="actions"><small>保存后即可开始创作。</small><button class="btn btn-tonal" type="submit">保存连接配置</button></div>
                </form>
              </div>
              <div class="card">
                <h3 class="section-title">导入与导出</h3>
                <div class="form-grid">
                  <div class="seg" role="radiogroup" aria-label="导出格式">
                    <label><input type="radio" name="export-format" value="txt" checked /><span>TXT</span></label>
                    <label><input type="radio" name="export-format" value="epub" /><span>EPUB</span></label>
                  </div>
                  <div class="actions"><small>导出全部已完成章节到作品目录。</small><button id="export-run" class="btn btn-tonal" type="button">导出全书</button></div>
                  <div class="tf"><input id="import-path" placeholder=" " /><label for="import-path">导入文件路径（本机绝对路径）</label></div>
                  <div class="actions"><small>按「第 N 章」标记切分并反推入库。</small><button id="import-run" class="btn btn-tonal" type="button">从文件导入</button></div>
                </div>
              </div>
            </section>
            <aside class="stack">
              <div class="card">
                <div class="panel-head"><h3>本书内容</h3><span id="book-phase">—</span></div>
                <div class="rowlines" id="book-rows"><div class="empty">尚未配置模型，先连接引擎。</div></div>
              </div>
              <div class="card" id="live-card" hidden>
                <div class="panel-head"><h3>正在书写</h3><span id="live-state">生成中</span></div>
                <div id="live-text" class="live-text" aria-live="polite"></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>最近活动</h3><span id="event-count">0 条</span></div>
                <div id="feed" class="feed" role="log" aria-live="polite"><div class="empty">暂无运行记录。</div></div>
              </div>
            </aside>
          </div>
        </section>
        <section class="page" data-page="reader" aria-label="章节与大纲" hidden>
          <div class="page-head"><div><h1>章节与大纲</h1><p class="meta">卷弧章三层结构与章节质量详情。</p></div></div>
          <div class="reader">
            <aside class="card tree-card" aria-label="大纲树">
              <div class="panel-head"><h3 id="book-title">大纲</h3><span id="book-progress">—</span></div>
              <div id="outline-tree" class="tree" role="tree" aria-label="卷弧章大纲"><div class="empty">尚未开始创作。</div></div>
            </aside>
            <article class="card" aria-label="章节内容">
              <header class="chapter-head">
                <h2 id="ch-title">选择左侧章节开始阅读</h2>
                <div style="display:flex;gap:8px;align-items:center"><span id="ch-status" class="chip small" hidden></span><span id="ch-tone" class="chip small" hidden></span><span id="ch-words" class="meta"></span><button id="open-rewrite" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>文风重构 / 去AI味</button><button id="open-arena" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>A/B 双模型竞写</button><button id="open-branch" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>剧情分支</button></div>
              </header>
              <div id="arena-panel" class="card" style="margin:14px 0;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
                <div class="panel-head"><h4 style="margin:0">多模型同章 A/B 竞写 & 盲审对比</h4><span id="arena-status">就绪</span></div>
                <div class="form-grid" style="gap:12px;margin-top:8px">
                  <div class="form-row">
                    <div class="tf"><input id="arena-model-a" placeholder=" " value="Writer-Alpha (沉稳详实)" /><label for="arena-model-a">竞写模型 A</label></div>
                    <div class="tf"><input id="arena-model-b" placeholder=" " value="Writer-Beta (张力紧凑)" /><label for="arena-model-b">竞写模型 B</label></div>
                  </div>
                  <div class="actions">
                    <small>双模型独立起草，由 Reviewer 盲审输出维度对比与胜出建议</small>
                    <div style="display:flex;gap:8px">
                      <button id="arena-start" class="btn btn-filled" type="button" style="min-height:32px;font-size:12px">发起竞写</button>
                      <button id="arena-cancel" class="btn btn-text" type="button" style="min-height:32px;font-size:12px">收起</button>
                    </div>
                  </div>
                </div>
                <div id="arena-cards" class="grid" style="margin-top:14px;gap:14px" hidden>
                  <div class="card" style="background:var(--paper)">
                    <div class="panel-head"><b id="cand-a-title">候选 A</b><span id="cand-a-score"></span></div>
                    <div id="cand-a-text" style="max-height:220px;overflow:auto;font-size:12.5px;line-height:1.7;color:var(--muted)"></div>
                    <div style="margin-top:10px"><button id="adopt-a-btn" class="btn btn-tonal" type="button" style="width:100%;min-height:32px">采纳候选 A</button></div>
                  </div>
                  <div class="card" style="background:var(--paper)">
                    <div class="panel-head"><b id="cand-b-title">候选 B</b><span id="cand-b-score"></span></div>
                    <div id="cand-b-text" style="max-height:220px;overflow:auto;font-size:12.5px;line-height:1.7;color:var(--muted)"></div>
                    <div style="margin-top:10px"><button id="adopt-b-btn" class="btn btn-tonal" type="button" style="width:100%;min-height:32px">采纳候选 B</button></div>
                  </div>
                </div>
                <div id="arena-rec" class="card" style="margin-top:10px;background:var(--alpha-6);font-size:12.5px;line-height:1.6" hidden></div>
              </div>
              <div id="branch-panel" class="card" style="margin:14px 0;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
                <div class="panel-head"><h4 style="margin:0">剧情分支管理 (Story Forking)</h4><span id="branch-status">0 条分支</span></div>
                <div class="rowlines" id="branch-items" style="margin:8px 0"><div class="empty">当前章节暂无分支。</div></div>
                <div class="form-row" style="margin-top:10px">
                  <div class="tf"><input id="new-branch-name" placeholder=" " /><label for="new-branch-name">新分支名称 (如: 决战留守if线)</label></div>
                  <button id="create-branch-btn" class="btn btn-tonal" type="button" style="min-height:44px">创建新分支</button>
                </div>
              </div>
              </header>
              <div id="rewrite-panel" class="card" style="margin:14px 0;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
                <div class="panel-head"><h4 style="margin:0">AI 文风重构与去AI味</h4><span id="rewrite-status">就绪</span></div>
                <div class="form-grid" style="gap:12px;margin-top:8px">
                  <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
                    <label class="helper" style="margin:0;font-size:12px;font-weight:600">目标题材风格：</label>
                    <div class="seg" role="radiogroup" aria-label="文风类型" style="max-width:380px">
                      <label><input type="radio" name="rw-style" value="default" checked /><span>通用</span></label>
                      <label><input type="radio" name="rw-style" value="suspense" /><span>悬疑推理</span></label>
                      <label><input type="radio" name="rw-style" value="fantasy" /><span>奇幻史诗</span></label>
                      <label><input type="radio" name="rw-style" value="romance" /><span>细腻言情</span></label>
                    </div>
                  </div>
                  <div class="tf"><input id="rw-instructions" placeholder=" " /><label for="rw-instructions">额外润色或去AI味指令（可选）</label></div>
                  <div class="actions" style="margin-top:4px">
                    <small id="rw-hint">根据当前章节命中的 AI 套话特征词自动追加负向约束</small>
                    <div style="display:flex;gap:8px">
                      <button id="rw-start" class="btn btn-filled" type="button" style="min-height:32px;font-size:12px">开始重构</button>
                      <button id="rw-adopt" class="btn btn-tonal" type="button" style="min-height:32px;font-size:12px" hidden>采纳重构正文</button>
                      <button id="rw-cancel" class="btn btn-text" type="button" style="min-height:32px;font-size:12px">收起</button>
                    </div>
                  </div>
                </div>
                <div id="rw-diff" style="margin-top:12px;font-size:12px;line-height:1.6;color:var(--muted)" hidden></div>
              </div>
              <div id="ch-summary" class="summary-block" hidden></div>
              <div id="ch-review" class="review-block" hidden></div>
              <div id="ch-text" class="chapter-text"><div class="empty">章节正文将在这里展示。</div></div>
            </article>
          </div>
        </section>
        <section class="page" data-page="entities" aria-label="人物图谱" hidden>
          <div class="page-head">
            <div><h1>人物与势力图谱</h1><p class="meta">追踪出场角色性格羁绊、势力归属与心境动态弧度。</p></div>
            <div class="head-actions"><button id="add-entity-btn" class="btn btn-tonal" type="button">新建人物/势力</button></div>
          </div>
          <div id="add-entity-modal" class="card" style="margin-bottom:16px;border:1px dashed var(--line)" hidden>
            <h4 style="margin:0 0 12px">添加小说实体</h4>
            <div class="form-grid" style="gap:12px">
              <div class="form-row">
                <div class="tf"><input id="ent-id" placeholder=" " required /><label for="ent-id">实体标识 (英文ID，如 hero)</label></div>
                <div class="tf"><input id="ent-name" placeholder=" " required /><label for="ent-name">实体名称 (如 李林)</label></div>
              </div>
              <div class="form-row">
                <div class="tf"><input id="ent-type" placeholder=" " value="character" /><label for="ent-type">类型 (character/faction/item)</label></div>
                <div class="tf"><input id="ent-aliases" placeholder=" " /><label for="ent-aliases">别名/称号 (逗号分隔)</label></div>
              </div>
              <div class="tf"><input id="ent-desc" placeholder=" " /><label for="ent-desc">生平简介与核心动机</label></div>
              <div class="actions">
                <small>保存后沉淀至全书记忆知识库</small>
                <div style="display:flex;gap:8px">
                  <button id="save-entity-btn" class="btn btn-filled" type="button">保存入库</button>
                  <button id="cancel-entity-btn" class="btn btn-text" type="button">取消</button>
                </div>
              </div>
            </div>
          </div>
          <div class="grid">
            <section class="stack">
              <div class="card">
                <div class="panel-head"><h3>实体档案卡片</h3><span id="entities-count">0 位</span></div>
                <div class="rowlines" id="entities-list"><div class="empty">暂无实体记录。创作进行中或可手动添加。</div></div>
              </div>
            </section>
            <aside class="stack">
              <div class="card">
                <div class="panel-head"><h3>关系网络 & 羁绊</h3><span id="relations-count">0 条</span></div>
                <div class="rowlines" id="relations-list"><div class="empty">暂无关系连线。</div></div>
              </div>
            </aside>
          </div>
        </section>
        <section class="page" data-page="records" aria-label="运行记录" hidden>
          <div class="page-head"><div><h1>运行记录</h1><p class="meta">事件时间线与运行诊断。</p></div></div>
          <div class="stack">
            <div class="card">
              <div class="panel-head"><h3>事件时间线</h3><span id="tl-count">0 条</span></div>
              <div id="timeline" class="feed tall" role="log" aria-live="polite"><div class="empty">暂无事件。</div></div>
            </div>
            <div class="card">
              <div class="panel-head"><h3>运行诊断</h3><span id="diag-count"></span></div>
              <div style="display:flex;gap:8px;margin-bottom:6px"><button id="diag-run" class="btn btn-tonal" type="button" style="min-height:34px">运行诊断</button></div>
              <div class="rowlines" id="diag-findings"><div class="empty">点击「运行诊断」检查工件完整性与节奏红线。</div></div>
            </div>
            <div class="card">
              <div class="panel-head"><h3>反思候选</h3><span id="reflection-count"></span></div>
              <div class="rowlines" id="reflection-list"><div class="empty">暂无反思暂存会话——创作运行后会在这里展示各轮候选。</div></div>
            </div>
          </div>
        </section>
        <section class="page" data-page="settings" aria-label="配置" hidden>
          <div class="page-head"><div><h1>配置</h1><p class="meta">模型与运行参数管理（密钥仅显示是否已设置）。</p></div></div>
          <div class="grid">
            <div class="card">
              <h3 class="section-title">核心配置</h3>
              <form id="settings-form" class="form-grid">
                <div class="form-row">
                  <div><div class="tf"><input id="set-provider" placeholder=" " /><label for="set-provider">默认服务商</label></div><small class="helper">如 openrouter / openai / anthropic / deepseek</small></div>
                  <div><div class="tf"><input id="set-model" placeholder=" " /><label for="set-model">默认模型</label></div><small class="helper">如 google/gemini-2.5-flash</small></div>
                </div>
                <h4 style="margin:6px 0 0;font-size:13px">角色模型（留空保持现状）</h4>
                <div id="roles-rows" class="form-grid"></div>
                <div class="actions"><small>保存前会做完整校验，失败保持原值。</small><button class="btn btn-tonal" type="submit">保存配置</button></div>
              </form>
            </div>
            <aside class="stack">
              <div class="card">
                <div class="panel-head"><h3>当前生效</h3><span id="settings-state">未加载</span></div>
                <div class="rowlines" id="settings-view"><div class="empty">加载中…</div></div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
    <div id="notice" role="alert"></div>
    <script>
      const $ = (id) => document.getElementById(id);
      const stateLabels = { running: '引擎运行中', completed: '本轮已完成', paused: '等待继续', idle: '引擎就绪', closed: '服务已关闭', setup: '等待配置', error: '运行异常' };
      const phaseLabels = { init: '准备中', premise: '设定构思', outline: '大纲规划', writing: '正文创作', complete: '已完结' };
      const chapterLabels = { completed: '已完成', 'in-progress': '写作中', pending: '待写', rewrite: '待重写' };
      const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(value || 0);
      const provider = () => (document.querySelector('input[name="provider"]:checked') || {}).value || 'custom';
      const RUN_END = "\\u0000run_end";
      const rootElement = document.documentElement;
      const themeButtons = document.querySelectorAll('.theme-btn');
      function applyTheme(theme) {
        rootElement.classList.remove('light', 'dark');
        if (theme === 'system') { localStorage.removeItem('theme'); if (matchMedia('(prefers-color-scheme: dark)').matches) rootElement.classList.add('dark'); }
        else { localStorage.setItem('theme', theme); rootElement.classList.add(theme); }
        themeButtons.forEach((button) => { const active = button.dataset.theme === theme; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      }
      applyTheme(localStorage.getItem('theme') || 'system');
      themeButtons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.theme)));
      let currentState = 'setup';
      let noticeTimer = 0;
      function showNotice(message, tone = 'error') { const notice = $('notice'); notice.textContent = message; notice.dataset.tone = tone; notice.classList.add('show'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.classList.remove('show'), 4200); }
      function renderEvents(events) { const feed = $('feed'); feed.replaceChildren(); $('event-count').textContent = events.length + ' 条'; const timeline = $('timeline'); timeline.replaceChildren(); $('tl-count').textContent = events.length + ' 条'; if (!events.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无运行记录。'; feed.append(empty); const empty2 = document.createElement('div'); empty2.className = 'empty'; empty2.textContent = '暂无事件。'; timeline.append(empty2); return; } const recent = events.slice(-50).reverse(); for (const target of [feed, timeline]) recent.forEach((event) => { const item = document.createElement('div'); item.className = 'event'; const time = document.createElement('time'); time.textContent = new Date(event.time || Date.now()).toLocaleTimeString('zh-CN'); const message = document.createElement('span'); message.textContent = String(event.message || event.summary || event.type || ''); item.append(time, message); target.append(item); }); }
      let eventsBuf = [];
      function pushEvent(event) { eventsBuf = [...eventsBuf.slice(-49), event]; renderEvents(eventsBuf); }
      async function post(path, body) { const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败'); return data; }
      function applyStatus(data) { currentState = data.snapshot?.runtimeState || (data.configured ? 'idle' : 'setup'); const ready = Boolean(data.configured); const active = currentState === 'running'; const status = $('runtime-status'); status.dataset.state = data.error ? 'error' : currentState; status.querySelector('span').textContent = data.error ? '服务异常' : (stateLabels[currentState] || currentState); $('progress').hidden = !active; $('state').textContent = currentState; $('state').dataset.state = currentState; $('model').textContent = data.snapshot?.model || '—'; $('input').textContent = formatNumber(data.snapshot?.usage?.inputTokens); $('output').textContent = formatNumber(data.snapshot?.usage?.outputTokens); $('prompt').disabled = !ready || active || currentState === 'closed'; $('run').disabled = !ready || active || currentState === 'closed'; $('run').textContent = active ? '创作进行中…' : currentState === 'paused' ? '继续创作' : '开始创作'; $('steering-panel').classList.toggle('show', ready); $('runtime-actions').hidden = !ready || !['paused', 'completed'].includes(currentState); $('resume').hidden = currentState !== 'paused'; if (!active) $('live-state').textContent = '本轮已完成'; if (data.events) { eventsBuf = data.events; renderEvents(eventsBuf); } }
      async function refresh() { try { applyStatus(await (await fetch('/api/status')).json()); } catch { $('runtime-status').dataset.state = 'error'; $('runtime-status').querySelector('span').textContent = '本地服务未连接'; showNotice('无法连接本地服务，请确认 SynChronicle 仍在运行。'); } }
      function appendDelta(value) { if (value === RUN_END) { $('live-state').textContent = '本轮已完成'; return; } $('live-card').hidden = false; $('live-state').textContent = '生成中'; const el = $('live-text'); el.textContent = (el.textContent + value).slice(-4000); el.scrollTop = el.scrollHeight; }
      let sseErrored = false; let pollTimer = 0;
      function startPolling() { if (pollTimer) return; pollTimer = setInterval(() => void refresh(), 3000); }
      const es = new EventSource('/api/stream');
      es.addEventListener('snapshot', (e) => applyStatus(JSON.parse(e.data)));
      es.addEventListener('runtime', (e) => pushEvent(JSON.parse(e.data)));
      es.addEventListener('delta', (e) => appendDelta(JSON.parse(e.data).value));
      es.onerror = () => { if (sseErrored) { es.close(); startPolling(); } sseErrored = true; };
      function showView(view) { document.querySelectorAll('.page').forEach((page) => { page.hidden = page.dataset.page !== view; }); document.querySelectorAll('[data-view]').forEach((button) => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }); if (view === 'reader') void loadBook(); }
      document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
      function flatten(book) { const rows = []; for (const volume of book.volumes) for (const arc of volume.arcs) for (const chapter of arc.chapters) rows.push(chapter); return rows; }
      function rowPill(label, count, tone) { const pill = document.createElement('span'); pill.className = 'pill ' + tone; pill.textContent = count + ' ' + label; return pill; }
      async function loadBookSummary() { const box = $('book-rows'); try { const data = await (await fetch('/api/book')).json(); if (!data.configured || !data.book) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; box.append(empty); $('book-phase').textContent = '—'; return; } const book = data.book; const rows = flatten(book); const done = rows.filter((row) => row.status === 'completed').length; const rewrite = rows.filter((row) => row.status === 'rewrite').length; const pending = rows.length - done - rewrite; box.replaceChildren(); const rowA = document.createElement('div'); rowA.className = 'rowline'; const labelA = document.createElement('span'); labelA.textContent = '章节进度'; const pills = document.createElement('div'); pills.className = 'pills'; pills.append(rowPill('已完成', done, 'ok'), rowPill('待写', pending, 'muted')); if (rewrite) pills.append(rowPill('待重写', rewrite, 'bad')); rowA.append(labelA, pills); const rowB = document.createElement('div'); rowB.className = 'rowline'; const labelB = document.createElement('span'); labelB.textContent = '全书字数'; const valueB = document.createElement('span'); valueB.style.fontWeight = '700'; valueB.style.fontSize = '15px'; valueB.textContent = formatNumber(book.totalWordCount); rowB.append(labelB, valueB); const rowC = document.createElement('div'); rowC.className = 'rowline'; const labelC = document.createElement('span'); labelC.textContent = '阅读前台'; const link = document.createElement('a'); link.href = '/read'; link.className = 'btn btn-text'; link.style.minHeight = '32px'; link.textContent = '打开 /read'; rowC.append(labelC, link); box.append(rowA, rowB, rowC); $('book-phase').textContent = phaseLabels[book.phase] || book.phase; } catch { /* 保持现有内容 */ } }
      function treeEmpty(message) { $('outline-tree').replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = message; $('outline-tree').append(empty); $('book-progress').textContent = '—'; }
      async function loadBook() { try { const data = await (await fetch('/api/book')).json(); if (!data.configured || !data.book) { $('book-title').textContent = '大纲'; treeEmpty('尚未配置模型，先在概览页连接引擎。'); return; } const book = data.book; $('book-title').textContent = book.novelName || '大纲'; $('book-progress').textContent = book.completedChapters.length + '/' + (book.totalChapters || flatten(book).length) + ' 章'; const tree = $('outline-tree'); tree.replaceChildren(); const rows = flatten(book); if (!rows.length) { treeEmpty('尚未开始创作，提交 brief 后这里会长出大纲。'); return; } for (const volume of book.volumes) { const vol = document.createElement('div'); vol.className = 'vol'; vol.textContent = '第 ' + volume.index + ' 卷 · ' + (volume.title || '未命名'); tree.append(vol); for (const arc of volume.arcs) { const arcLabel = document.createElement('div'); arcLabel.className = 'arc'; arcLabel.textContent = ' ' + (arc.title || '弧') + (arc.goal ? ' — ' + arc.goal : ''); tree.append(arcLabel); for (const chapter of arc.chapters) { const row = document.createElement('button'); row.type = 'button'; row.className = 'trow'; row.dataset.chapter = String(chapter.chapter); row.setAttribute('role', 'treeitem'); const dot = document.createElement('i'); dot.className = 'dot s-' + chapter.status; dot.setAttribute('aria-hidden', 'true'); const label = document.createElement('span'); label.textContent = chapter.chapter + '. ' + chapter.title; const words = document.createElement('small'); words.textContent = chapter.wordCount ? formatNumber(chapter.wordCount) + ' 字' : ''; row.append(dot, label, words); row.addEventListener('click', () => selectChapter(chapter.chapter)); tree.append(row); } } } const target = rows.find((row) => row.status === 'in-progress') || [...rows].reverse().find((row) => row.status === 'completed') || rows[0]; if (target) selectChapter(target.chapter); } catch { treeEmpty('加载大纲失败，请稍后重试。'); } }
      let currentChapter = 0;
      function selectChapter(chapter) { currentChapter = chapter; document.querySelectorAll('.trow').forEach((row) => { const active = Number(row.dataset.chapter) === chapter; row.classList.toggle('active', active); row.setAttribute('aria-selected', String(active)); }); void loadChapter(chapter); }
      async function loadChapter(chapter) { try { const data = await (await fetch('/api/chapters/' + chapter)).json(); if (!data.configured || !data.chapter) { $('ch-title').textContent = '尚未配置模型'; return; } const view = data.chapter; $('ch-title').textContent = view.title || ('第 ' + chapter + ' 章'); const chip = $('ch-status'); chip.hidden = false; chip.textContent = chapterLabels[view.status] || view.status; chip.dataset.state = view.status === 'rewrite' ? 'error' : view.status === 'completed' ? 'idle' : 'running';           $('ch-words').textContent = (view.source === 'draft' ? '草稿 · ' : '') + formatNumber(view.wordCount) + ' 字';
          const tone = $('ch-tone');
          if (view.aitone && view.aitone.score < 100) {
            tone.hidden = false;
            tone.textContent = 'AI 味 ' + view.aitone.score;
            tone.className = 'chip small ' + (view.aitone.score < 70 ? 'warn' : '');
            tone.title = view.aitone.hits.slice(0, 3).map((hit) => hit.name + ' x' + hit.count).join('；') || '无命中';
          } else tone.hidden = true;
          const openRw = $('open-rewrite');
          if (openRw) openRw.hidden = !view.text;
          const openAr = $('open-arena');
          if (openAr) openAr.hidden = !view.text;
          const openBr = $('open-branch');
          if (openBr) openBr.hidden = !view.text;
          const rwPanel = $('rewrite-panel');
          if (rwPanel) rwPanel.hidden = true;
          const arPanel = $('arena-panel');
          if (arPanel) arPanel.hidden = true;
          const brPanel = $('branch-panel');
          if (brPanel) brPanel.hidden = true; const summary = $('ch-summary'); if (view.summary) { summary.hidden = false; summary.replaceChildren(); const head = document.createElement('h4'); head.textContent = '本章摘要'; const body = document.createElement('div'); body.textContent = view.summary.summary; summary.append(head, body); if (view.summary.keyEvents.length) { const list = document.createElement('ul'); for (const item of view.summary.keyEvents) { const li = document.createElement('li'); li.textContent = item; list.append(li); } summary.append(list); } } else summary.hidden = true; const review = $('ch-review'); if (view.review && (view.review.dimensions.length || view.review.summary)) { review.hidden = false; review.replaceChildren(); const head = document.createElement('div'); head.className = 'review-head'; const title = document.createElement('h4'); title.style.margin = '0'; title.textContent = 'Editor 评审'; const verdict = document.createElement('span'); verdict.className = 'chip small ' + (view.review.verdict === 'pass' ? 'ok' : 'warn'); verdict.textContent = view.review.verdict; head.append(title, verdict); review.append(head); if (view.review.summary) { const note = document.createElement('div'); note.className = 'meta'; note.style.marginTop = '6px'; note.textContent = view.review.summary; review.append(note); } for (const dimension of view.review.dimensions) { const row = document.createElement('div'); row.className = 'dim' + (dimension.score < 70 ? ' low' : ''); const name = document.createElement('span'); name.textContent = dimension.dimension; const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('i'); fill.style.setProperty('--w', Math.max(0, Math.min(100, dimension.score)) + '%'); bar.append(fill); const score = document.createElement('b'); score.style.fontWeight = '600'; score.textContent = String(dimension.score); row.append(name, bar, score); review.append(row); } } else review.hidden = true; const text = $('ch-text'); text.replaceChildren(); if (view.text) { for (const block of view.text.split(/\\n{2,}/)) { const paragraph = document.createElement('p'); paragraph.textContent = block; text.append(paragraph); } } else { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = view.status === 'pending' ? '这一章还未书写。' : '暂无正文。'; text.append(empty); } } catch { showNotice('加载章节失败。'); } }
      $('settings').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const type = (document.querySelector('input[name="protocol-type"]:checked') || {}).value || 'openai';
          await post('/api/config', {
            provider: 'custom',
            model: $('model-input').value.trim(),
            baseUrl: $('base-url').value.trim(),
            apiKey: $('api-key').value.trim(),
            type,
          });
          $('api-key').value = '';
          showNotice('自定义连接配置已保存，可以开始创作。', 'success');
          await refresh();
          void loadBookSummary();
        } catch (error) {
          showNotice(error.message || '配置保存失败');
        }
      });
      $('run').addEventListener('click', async () => { const value = $('prompt').value.trim(); if (!value) { showNotice('先写下一句创作 brief。'); return; } try { await post(['completed', 'paused'].includes(currentState) ? '/api/continue' : '/api/run', { prompt: value }); $('prompt').value = ''; $('live-text').textContent = ''; showNotice('创作已启动。', 'success'); await refresh(); } catch (error) { showNotice(error.message || '启动失败'); } });
      $('prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('run').click(); } });
      $('steer-button').addEventListener('click', async () => { const value = $('steer-input').value.trim(); if (!value) { showNotice('先写下要调整的方向。'); return; } try { await post('/api/inject', { text: value }); $('steer-input').value = ''; showNotice('干预已加入下一次运行。', 'success'); await refresh(); } catch (error) { showNotice(error.message || '干预发送失败'); } });
      $('steer-realtime-button').addEventListener('click', async () => {
        const value = $('steer-realtime-input').value.trim();
        if (!value) { showNotice('请写下偏航纠正指令。'); return; }
        if (!confirm('确定打断当前生成并根据该指令重新生成吗？')) return;
        try {
          const res = await post('/api/steer', { prompt: value });
          $('steer-realtime-input').value = '';
          showNotice('已发起重定向：目标第 ' + res.targetChapter + ' 章已重新续写。', 'success');
          await refresh();
        } catch (error) {
          showNotice(error.message || '重定向失败');
        }
      });
      $('resume').addEventListener('click', async () => { try { await post('/api/resume'); showNotice('正在恢复上一轮创作。', 'success'); await refresh(); } catch (error) { showNotice(error.message || '恢复失败'); } });
      $('new-run').addEventListener('click', () => { $('prompt').focus(); $('prompt').value = ''; showNotice('写下新的 brief，即可开始下一轮。', 'success'); });
      const severityLabels = { critical: '严重', warning: '警告', info: '提示' };
      async function loadReflection() {
        const box = $('reflection-list');
        try {
          const data = await (await fetch('/api/reflection')).json();
          box.replaceChildren();
          const sessions = data.sessions ?? [];
          $('reflection-count').textContent = sessions.length ? sessions.length + ' 个会话' : '';
          if (!data.configured || !sessions.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = data.configured ? '暂无反思暂存会话——创作运行后会在这里展示各轮候选。' : '尚未配置模型。'; box.append(empty); return; }
          for (const session of sessions.slice(0, 5)) {
            const row = document.createElement('div'); row.className = 'rowline'; row.style.alignItems = 'flex-start'; row.style.flexDirection = 'column'; row.style.gap = '8px';
            const head = document.createElement('div'); head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.width = '100%'; head.style.gap = '10px';
            const name = document.createElement('span'); name.textContent = '会话 ' + session.sessionId.slice(0, 8);
            const rounds = document.createElement('div'); rounds.style.display = 'flex'; rounds.style.gap = '8px'; rounds.style.flexWrap = 'wrap';
            for (const round of session.rounds) {
              const staged = round.artifacts.filter((artifact) => artifact.status === 'staged');
              const tag = document.createElement('span'); tag.className = 'pill ' + (staged.length ? 'warn' : 'muted'); tag.textContent = '第 ' + round.round + ' 轮 · ' + round.artifacts[0].target;
              tag.title = round.artifacts[0].preview;
              if (staged.length) { const adopt = document.createElement('button'); adopt.type = 'button'; adopt.className = 'btn btn-text'; adopt.style.minHeight = '26px'; adopt.style.padding = '2px 10px'; adopt.style.fontSize = '11.5px'; adopt.textContent = '采纳此轮'; adopt.addEventListener('click', async () => { try { const result = await post('/api/reflection/commit', { sessionId: session.sessionId, round: round.round }); showNotice('已采纳第 ' + round.round + ' 轮（' + result.committed + ' 个工件）。', 'success'); await loadReflection(); } catch (error) { showNotice(error.message || '采纳失败'); } }); tag.append(adopt); }
              rounds.append(tag);
            }
            head.append(name);
            row.append(head, rounds);
            box.append(row);
          }
        } catch { /* 保持现有内容 */ }
      }
      loadReflection();
      const ROLE_NAMES = { coordinator: '调度', architect: '规划师', writer: '写手', editor: '编辑', reviewer: '评审' };
      async function loadSettings() {
        const view = $('settings-view');
        try {
          const data = await (await fetch('/api/settings')).json();
          view.replaceChildren();
          if (!data.configured || !data.settings) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = data.error || '尚未配置模型。'; view.append(empty); $('settings-state').textContent = '未配置'; return; }
          const settings = data.settings;
          $('set-provider').value = settings.provider || '';
          $('set-model').value = settings.model || '';
          const rows = $('roles-rows');
          rows.replaceChildren();
          for (const [role, label] of Object.entries(ROLE_NAMES)) {
            const current = (settings.roles || {})[role] || {};
            const row = document.createElement('div'); row.className = 'form-row';
            const providerField = document.createElement('div'); providerField.className = 'tf';
            const providerInput = document.createElement('input'); providerInput.id = 'role-' + role + '-provider'; providerInput.placeholder = ' ';
            if (current.provider) providerInput.value = current.provider;
            const providerLabel = document.createElement('label'); providerLabel.htmlFor = providerInput.id; providerLabel.textContent = label + ' 服务商';
            providerField.append(providerInput, providerLabel);
            const modelField = document.createElement('div'); modelField.className = 'tf';
            const modelInput = document.createElement('input'); modelInput.id = 'role-' + role + '-model'; modelInput.placeholder = ' ';
            if (current.model) modelInput.value = current.model;
            const modelLabel = document.createElement('label'); modelLabel.htmlFor = modelInput.id; modelLabel.textContent = label + ' 模型';
            modelField.append(modelInput, modelLabel);
            row.append(providerField, modelField);
            rows.append(row);
          }
          const line = (label, value, tone) => { const row = document.createElement('div'); row.className = 'rowline'; const name = document.createElement('span'); name.textContent = label; const right = document.createElement(tone === 'pill' ? 'span' : 'b'); if (tone === 'pill') right.className = 'pill muted'; else right.style.fontWeight = '600'; right.textContent = value; row.append(name, right); return row; };
          view.append(line('默认模型', (settings.provider || '—') + ' / ' + (settings.model || '—')));
          view.append(line('创作风格', settings.style || 'default'));
          view.append(line('输出目录', settings.outputDir || 'output/novel'));
          for (const [name, info] of Object.entries(settings.providers || {})) view.append(line('接口 ' + name, (info.hasApiKey ? '已设密钥' : '免密钥') + (info.baseUrl ? ' · ' + info.baseUrl : ''), 'pill'));
          $('settings-state').textContent = '已加载';
        } catch { view.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '加载失败。'; view.append(empty); }
      }
      document.querySelectorAll('[data-view="settings"]').forEach((button) => button.addEventListener('click', () => void loadSettings()));
      $('settings-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const roles = {};
        for (const role of Object.keys(ROLE_NAMES)) {
          const provider = $('role-' + role + '-provider')?.value.trim();
          const model = $('role-' + role + '-model')?.value.trim();
          if (provider && model) roles[role] = { provider, model };
        }
        try {
          await post('/api/settings', { provider: $('set-provider').value.trim(), model: $('set-model').value.trim(), roles });
          showNotice('配置已保存。', 'success');
          await loadSettings();
          await refresh();
        } catch (error) { showNotice(error.message || '保存失败'); }
      });
      $('export-run').addEventListener('click', async () => {
        const format = ((document.querySelector('input[name="export-format"]:checked') || {}).value) || 'txt';
        try {
          const result = await post('/api/export', { format });
          showNotice('已导出 ' + result.chapters + ' 章到 ' + result.path, 'success');
        } catch (error) { showNotice(error.message || '导出失败'); }
      });
      $('import-run').addEventListener('click', async () => {
        const path = $('import-path').value.trim();
        if (!path) { showNotice('先填写导入文件的绝对路径。'); return; }
        try {
          const result = await post('/api/import', { path });
          showNotice('已导入 ' + result.chapters + ' 章，阅读器与大纲要重新加载。', 'success');
          void loadBookSummary();
        } catch (error) { showNotice(error.message || '导入失败'); }
      });
      $('diag-run').addEventListener('click', async () => {
        const box = $('diag-findings');
        box.replaceChildren();
        const loading = document.createElement('div'); loading.className = 'empty'; loading.textContent = '诊断中…'; box.append(loading);
        try {
          const data = await (await fetch('/api/diag')).json();
          box.replaceChildren();
          if (!data.configured || !data.report) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，无法诊断。'; box.append(empty); return; }
          const findings = data.report.findings ?? [];
          $('diag-count').textContent = findings.length + ' 条';
          if (!findings.length) { const ok = document.createElement('div'); ok.className = 'empty'; ok.textContent = '未发现结构问题，节奏红线全部达标。'; box.append(ok); return; }
          for (const finding of findings) {
            const row = document.createElement('div'); row.className = 'rowline'; row.style.alignItems = 'flex-start';
            const left = document.createElement('div'); left.style.display = 'grid'; left.style.gap = '2px';
            const head = document.createElement('span'); head.textContent = finding.title;
            const note = document.createElement('small'); note.style.color = 'var(--muted)'; note.style.fontSize = '11.5px'; note.textContent = finding.evidence;
            left.append(head, note);
            const pill = document.createElement('span'); pill.className = 'pill ' + (finding.severity === 'critical' ? 'bad' : finding.severity === 'warning' ? 'warn' : 'muted'); pill.textContent = severityLabels[finding.severity] || finding.severity;
            row.append(left, pill); box.append(row);
          }
        } catch { box.replaceChildren(); const error = document.createElement('div'); error.className = 'empty'; error.textContent = '诊断失败，请稍后重试。'; box.append(error); }
      });
      let stagedRewriteText = '';
      $('open-rewrite')?.addEventListener('click', () => {
        const panel = $('rewrite-panel');
        if (panel) {
          panel.hidden = !panel.hidden;
          $('rw-adopt').hidden = true;
          $('rw-diff').hidden = true;
          $('rw-status').textContent = '就绪';
        }
      });
      $('rw-cancel')?.addEventListener('click', () => {
        const panel = $('rewrite-panel');
        if (panel) panel.hidden = true;
      });
      $('rw-start')?.addEventListener('click', async () => {
        if (!currentChapter) return;
        const style = ((document.querySelector('input[name="rw-style"]:checked') || {}).value) || 'default';
        const instructions = $('rw-instructions')?.value.trim() || '';
        $('rw-status').textContent = '重构处理中…';
        try {
          const res = await post('/api/chapters/' + currentChapter + '/rewrite', {
            style,
            instructions,
            reduceAitone: true,
          });
          stagedRewriteText = res.rewrittenText;
          $('rw-status').textContent = '重构完成 (AI味: ' + res.previousScore + ' → ' + res.newScore + ')';
          const diff = $('rw-diff');
          diff.hidden = false;
          diff.replaceChildren();
          const title = document.createElement('b');
          title.textContent = '重构预览：';
          const body = document.createElement('p');
          body.style.margin = '4px 0 0';
          body.textContent = res.rewrittenText.slice(0, 300) + '…';
          diff.append(title, body);
          $('rw-adopt').hidden = false;
          showNotice('第 ' + currentChapter + ' 章已生成文风重写候选，可预览后采纳。', 'success');
        } catch (err) {
          $('rw-status').textContent = '重构失败';
          showNotice(err.message || '重构失败');
        }
      });
      $('rw-adopt')?.addEventListener('click', async () => {
        if (!currentChapter || !stagedRewriteText) return;
        try {
          await post('/api/chapters/' + currentChapter + '/adopt', { text: stagedRewriteText });
          showNotice('已采纳重写正文并更新第 ' + currentChapter + ' 章。', 'success');
          $('rewrite-panel').hidden = true;
          await loadChapter(currentChapter);
          void loadBookSummary();
        } catch (err) {
          showNotice(err.message || '采纳失败');
        }
      });
      $('open-arena')?.addEventListener('click', () => {
        const p = $('arena-panel');
        if (p) p.hidden = !p.hidden;
      });
      $('arena-cancel')?.addEventListener('click', () => {
        const p = $('arena-panel');
        if (p) p.hidden = true;
      });
      let candAText = '';
      let candBText = '';
      $('arena-start')?.addEventListener('click', async () => {
        if (!currentChapter) return;
        $('arena-status').textContent = '双模型并行创作与盲审对比中…';
        try {
          const res = await post('/api/chapters/' + currentChapter + '/arena', {
            modelA: $('arena-model-a')?.value.trim(),
            modelB: $('arena-model-b')?.value.trim(),
          });
          candAText = res.candidateA.text;
          candBText = res.candidateB.text;
          $('cand-a-title').textContent = '候选 A (' + res.candidateA.modelName + ')';
          $('cand-a-score').textContent = res.candidateA.wordCount + '字 · AI味 ' + (res.candidateA.aitone ? res.candidateA.aitone.score : 100);
          $('cand-a-text').textContent = res.candidateA.text;
          $('cand-b-title').textContent = '候选 B (' + res.candidateB.modelName + ')';
          $('cand-b-score').textContent = res.candidateB.wordCount + '字 · AI味 ' + (res.candidateB.aitone ? res.candidateB.aitone.score : 100);
          $('cand-b-text').textContent = res.candidateB.text;
          $('arena-cards').hidden = false;
          const rec = $('arena-rec');
          rec.hidden = false;
          rec.textContent = '【评审盲审建议】' + res.recommendation;
          $('arena-status').textContent = '竞写对比就绪 (胜出: 候选 ' + res.overallWinner + ')';
        } catch (err) {
          $('arena-status').textContent = '竞写失败';
          showNotice(err.message || '竞写请求失败');
        }
      });
      $('adopt-a-btn')?.addEventListener('click', async () => {
        if (!currentChapter || !candAText) return;
        try {
          await post('/api/chapters/' + currentChapter + '/adopt', { text: candAText });
          showNotice('已采纳候选 A 为第 ' + currentChapter + ' 章终稿。', 'success');
          $('arena-panel').hidden = true;
          await loadChapter(currentChapter);
          void loadBookSummary();
        } catch (err) { showNotice(err.message || '采纳失败'); }
      });
      $('adopt-b-btn')?.addEventListener('click', async () => {
        if (!currentChapter || !candBText) return;
        try {
          await post('/api/chapters/' + currentChapter + '/adopt', { text: candBText });
          showNotice('已采纳候选 B 为第 ' + currentChapter + ' 章终稿。', 'success');
          $('arena-panel').hidden = true;
          await loadChapter(currentChapter);
          void loadBookSummary();
        } catch (err) { showNotice(err.message || '采纳失败'); }
      });
      async function loadBranches(ch) {
        try {
          const res = await (await fetch('/api/chapters/' + ch + '/branches')).json();
          const items = $('branch-items');
          if (!items) return;
          items.replaceChildren();
          const branches = res.branches || [];
          $('branch-status').textContent = branches.length + ' 条分支';
          if (!branches.length) {
            const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '当前章节暂无分支。可以在下方输入名称新建分支推演。';
            items.append(empty);
            return;
          }
          for (const b of branches) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const name = document.createElement('b'); name.textContent = b.name;
            const time = document.createElement('small'); time.style.color = 'var(--muted)'; time.style.marginLeft = '8px'; time.textContent = new Date(b.createdAt).toLocaleTimeString('zh-CN');
            left.append(name, time);
            const btn = document.createElement('button'); btn.className = 'btn btn-text'; btn.style.minHeight = '28px'; btn.textContent = '切换/合并为主干';
            btn.addEventListener('click', async () => {
              try {
                await post('/api/chapters/' + ch + '/branches/checkout', { branchId: b.id });
                showNotice('已将分支【' + b.name + '】内容合并至主干。', 'success');
                await loadChapter(ch);
                void loadBookSummary();
              } catch (err) { showNotice(err.message || '合并失败'); }
            });
            row.append(left, btn);
            items.append(row);
          }
        } catch { /* 忽略 */ }
      }
      $('open-branch')?.addEventListener('click', () => {
        const p = $('branch-panel');
        if (p) {
          p.hidden = !p.hidden;
          if (!p.hidden && currentChapter) void loadBranches(currentChapter);
        }
      });
      $('create-branch-btn')?.addEventListener('click', async () => {
        if (!currentChapter) return;
        const name = $('new-branch-name')?.value.trim();
        if (!name) { showNotice('请输入新分支名称'); return; }
        const id = 'br-' + Date.now().toString(36);
        try {
          await post('/api/chapters/' + currentChapter + '/branches', { id, name });
          $('new-branch-name').value = '';
          showNotice('剧情分支【' + name + '】创建成功。', 'success');
          await loadBranches(currentChapter);
        } catch (err) { showNotice(err.message || '创建分支失败'); }
      });
      async function loadEntities() {
        try {
          const res = await (await fetch('/api/entities')).json();
          const list = $('entities-list');
          const relList = $('relations-list');
          if (!list || !relList) return;
          list.replaceChildren();
          relList.replaceChildren();
          const items = res.entities || [];
          $('entities-count').textContent = items.length + ' 位';
          if (!items.length) {
            const empty1 = document.createElement('div'); empty1.className = 'empty'; empty1.textContent = '暂无实体记录。可点击上方按钮添加。'; list.append(empty1);
            const empty2 = document.createElement('div'); empty2.className = 'empty'; empty2.textContent = '暂无关系连线。'; relList.append(empty2);
            $('relations-count').textContent = '0 条';
            return;
          }
          let allRelCount = 0;
          for (const ent of items) {
            const card = document.createElement('div'); card.className = 'rowline'; card.style.flexDirection = 'column'; card.style.alignItems = 'flex-start'; card.style.gap = '4px';
            const top = document.createElement('div'); top.style.display = 'flex'; top.style.justifyContent = 'space-between'; top.style.width = '100%';
            const name = document.createElement('b'); name.textContent = ent.name + (ent.aliases?.length ? ' (' + ent.aliases.join('/') + ')' : '');
            const badge = document.createElement('span'); badge.className = 'pill muted'; badge.textContent = ent.type;
            top.append(name, badge);
            const desc = document.createElement('small'); desc.style.color = 'var(--muted)'; desc.textContent = ent.description || '暂无描述';
            card.append(top, desc);
            list.append(card);

            for (const r of ent.relations || []) {
              allRelCount++;
              const rRow = document.createElement('div'); rRow.className = 'rowline';
              const label = document.createElement('span'); label.textContent = ent.name + ' → ' + r.targetId;
              const typePill = document.createElement('span'); typePill.className = 'pill ' + (r.strength > 0 ? 'ok' : r.strength < 0 ? 'bad' : 'muted');
              typePill.textContent = r.type + (r.strength ? ' (' + r.strength + ')' : '');
              rRow.append(label, typePill);
              relList.append(rRow);
            }
          }
          $('relations-count').textContent = allRelCount + ' 条';
        } catch { /* 忽略加载错误 */ }
      }
      $('add-entity-btn')?.addEventListener('click', () => {
        const m = $('add-entity-modal');
        if (m) m.hidden = !m.hidden;
      });
      $('cancel-entity-btn')?.addEventListener('click', () => {
        const m = $('add-entity-modal');
        if (m) m.hidden = true;
      });
      $('save-entity-btn')?.addEventListener('click', async () => {
        const id = $('ent-id')?.value.trim();
        const name = $('ent-name')?.value.trim();
        const type = $('ent-type')?.value.trim() || 'character';
        const aliases = ($('ent-aliases')?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        const description = $('ent-desc')?.value.trim() || '';
        if (!id || !name) { showNotice('ID 与名称必填'); return; }
        try {
          await post('/api/entities', { id, name, type, aliases, description });
          showNotice('实体已添加至图谱。', 'success');
          $('add-entity-modal').hidden = true;
          await loadEntities();
        } catch (err) {
          showNotice(err.message || '保存失败');
        }
      });
      document.querySelectorAll('[data-view="entities"]').forEach((button) => button.addEventListener('click', () => void loadEntities()));
      refresh();
      loadBookSummary();
    </script>
  </body>
</html>`;
}
