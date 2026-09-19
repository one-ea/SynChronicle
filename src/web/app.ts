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
        --btn-radius: 8px; --radius-sm: 8px; --radius: 14px; --radius-lg: 18px;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, .03); --shadow-lg: 0 6px 14px -10px rgba(0, 0, 0, .14); --shadow-xl: 0 14px 28px -20px rgba(0, 0, 0, .22);
        --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
        --dur-fast: .15s; --dur: .2s; --ease: ease;
        --font: "Inter", "Google Sans Text", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        --line-strong: #d9d9d9;
      }
      :root.dark {
        color-scheme: dark;
        --ink: #f5f5f5; --paper: #171717; --bg: #0a0a0a; --side-bg: #101010; --raised: #1f1f1f;
        --muted: rgba(255, 255, 255, .58); --faint: rgba(255, 255, 255, .4);
        --line: #333; --line-faint: #2a2a2a;
        --alpha-4: rgba(255, 255, 255, .05); --alpha-6: rgba(255, 255, 255, .08); --alpha-7: rgba(255, 255, 255, .1);
        --heat-8: rgba(250, 93, 25, .1);
        --line-strong: #454545;
      }
      * { box-sizing: border-box; }
      ::selection { background: var(--heat-12); color: var(--ink); }
      body { margin: 0; min-width: 320px; color: var(--ink); background: var(--bg); font: 400 14px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
      button, input, textarea { font: inherit; color: inherit; }
      button { cursor: pointer; }
      h1, h2, h3, h4 { letter-spacing: -.02em; font-weight: 700; line-height: 1.2; margin: 0; }
      button:focus-visible, input:focus-visible, textarea:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--heat-100); }
      .topbar { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 0 22px; background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
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
      .side { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4) var(--space-3); background: var(--side-bg); border-right: 1px solid var(--line); }
      .side-label { margin: 14px 12px 4px; padding-bottom: 7px; border-bottom: 1px solid var(--line-faint); color: var(--faint); font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
      .side-label:first-child { margin-top: 0; }
      .side-nav { display: grid; gap: 2px; }
      .side-nav button { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: var(--btn-radius); background: transparent; color: var(--ink); font-size: 13.5px; font-weight: 500; text-align: left; transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
      .side-nav button:hover { background: var(--alpha-4); }
      .side-nav button[aria-current="page"] { background: var(--heat-8); box-shadow: inset 0 0 0 1px var(--heat-20); font-weight: 600; }
      .side-nav svg { width: 16px; height: 16px; flex: none; color: var(--muted); }
      .side-nav button[aria-current="page"] svg { color: var(--heat-100); }
      .nav-count { margin-left: auto; padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--faint); font-family: var(--font-mono); font-size: 10px; line-height: 1.5; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .side-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line-faint); color: var(--faint); font-size: 11px; line-height: 1.6; }
      .tabbar { display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 90; grid-template-columns: repeat(5, 1fr); gap: 2px; min-height: 56px; padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); background: var(--paper); border-top: 1px solid var(--line); box-shadow: var(--shadow-lg); }
      .tabbar button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 44px; padding: 0 2px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); font-size: 10.5px; font-weight: 500; white-space: nowrap; }
      .tabbar svg { width: 20px; height: 20px; }
      .tabbar button[aria-current="page"] { color: var(--heat-100); background: var(--heat-8); box-shadow: inset 0 0 0 1px var(--heat-20); font-weight: 600; }
      .main { min-width: 0; max-width: 1160px; width: 100%; margin: 0 auto; padding: var(--space-5) var(--space-5) 64px; }
      .page[hidden] { display: none; }
      .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); flex-wrap: wrap; }
      .page-head h1 { font-size: clamp(20px, 2.2vw, 24px); }
      .page-head .meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
      .head-actions { display: flex; gap: var(--space-2); }
      .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); margin-bottom: 20px; }
      .stat-split { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--paper); }
      .stat-top { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--bg); border-bottom: 1px solid var(--line-faint); color: var(--muted); font-size: 11.5px; font-weight: 600; }
      .stat-top code { margin-left: auto; color: var(--faint); font-family: var(--font-mono); font-size: 9.5px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; }
      .stat-split b { display: block; padding: 12px 14px 14px; font-size: 24px; font-weight: 700; letter-spacing: -.02em; font-family: var(--font-mono); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stat-split b[data-state="running"] { color: var(--heat-100); }
      .stat-split b[data-state="error"] { color: var(--error); }
      .grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .9fr); gap: var(--space-5); align-items: start; }
      .card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); padding: clamp(20px, 3vw, 28px); box-shadow: var(--shadow-sm); transition: border-color var(--dur-fast) var(--ease); }
      .card:hover { border-color: var(--line-strong); }
      .stack { display: grid; gap: var(--space-5); }
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
      .event time { color: var(--faint); font-family: var(--font-mono); font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .empty { color: var(--muted); font-size: 12.5px; }
      .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .panel-head h3 { margin: 0; font-size: 15px; }
      .panel-head span { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
      .live-text { max-height: 220px; overflow: auto; font-size: 13px; line-height: 1.8; color: var(--muted); white-space: pre-wrap; word-break: break-word; }
      .reader { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
      .studio-rail { display: grid; grid-template-columns: 240px minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
      .studio-list { display: grid; gap: 2px; max-height: calc(100vh - 210px); overflow: auto; }
      .studio-list button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 4px 8px; border: 0; border-radius: var(--btn-radius); background: transparent; color: var(--ink); font-size: 12.5px; text-align: left; }
      .studio-list button:hover { background: var(--alpha-4); }
      .studio-list button.active { background: var(--heat-8); box-shadow: inset 0 0 0 1px var(--heat-20); }
      .studio-editor { width: 100%; min-height: 56vh; resize: vertical; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink); font-family: inherit; font-size: 14.5px; line-height: 1.9; padding: 16px; }
      .studio-editor:focus { outline: 2px solid var(--heat-40, rgba(250, 93, 25, 0.4)); outline-offset: -1px; }
      .studio-tools { display: grid; gap: 14px; }
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
      .trow small { margin-left: auto; color: var(--faint); font-family: var(--font-mono); font-size: 10.5px; font-variant-numeric: tabular-nums; }
      .mono-chip { padding: 1px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--muted); font-family: var(--font-mono); font-size: 10.5px; white-space: nowrap; }
      .chapter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
      .chapter-head h2 { font-size: 21px; }
      .meta { color: var(--muted); font-size: 12px; }
      .chapter-text { max-width: 72ch; margin-top: 18px; font-size: clamp(14.5px, 1.1vw, 15.5px); line-height: 1.9; }
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
      .auth-gate { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; padding: 24px; background: var(--bg); }
      .auth-gate[hidden] { display: none; }
      .auth-card { width: min(420px, 100%); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--paper); padding: 32px; box-shadow: var(--shadow-xl); }
      .auth-card h1 { margin-bottom: 8px; font-size: 24px; }
      .auth-card p { margin: 0 0 22px; color: var(--muted); }
      .auth-card form { display: grid; gap: 14px; }
      .auth-card input { width: 100%; min-height: 44px; padding: 0 13px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper); }
      :root.dark #notice { background: #1f1f1f; border: 1px solid #333; }
      @media (min-width: 768px) and (max-width: 1023px) {
        .admin { grid-template-columns: 72px minmax(0, 1fr); }
        .side { padding: var(--space-4) var(--space-2); align-items: center; }
        .side-label { margin: var(--space-3) 0 2px; padding: 0; border: 0; text-align: center; font-size: 10px; letter-spacing: .02em; text-overflow: ellipsis; overflow: hidden; }
        .side-nav { gap: var(--space-1); }
        .side-nav button { justify-content: center; gap: 0; min-height: 44px; padding: 0; border-radius: var(--radius-sm); }
        .side-nav .nv-t, .side-nav .nav-count { display: none; }
        .side-nav svg { width: 18px; height: 18px; }
        .side-foot { display: none; }
        .stat-row { grid-template-columns: repeat(2, 1fr); }
        .grid, .reader { grid-template-columns: 1fr; }
        .studio-rail { grid-template-columns: 190px minmax(0, 1fr); }
        .studio-tools { grid-column: 1 / -1; }
        .tree { max-height: 40vh; }
        .main { padding: var(--space-5) var(--space-4) 56px; }
      }
      @media (max-width: 767px) {
        .admin { grid-template-columns: 1fr; }
        .side { display: none; }
        .tabbar { display: grid; }
        .main { padding: var(--space-4) var(--space-4) calc(64px + env(safe-area-inset-bottom, 0px)); }
        .stat-row { grid-template-columns: repeat(2, 1fr); }
        .grid, .reader { grid-template-columns: 1fr; }
        .studio-rail { grid-template-columns: 1fr; }
        .studio-list { max-height: 32vh; }
        .tree { max-height: 32vh; }
        .page-head h1 { font-size: 22px; }
        .topbar { padding: 0 var(--space-4); }
        .brand small { display: none; }
        .view-site .vs-text { display: none; }
        .view-site { padding: 4px 9px; }
        .theme-btn { min-height: 44px; padding: 4px 10px; }
        .seg label { min-height: 44px; font-size: 11.5px; padding: 0 4px; }
        .trow { min-height: 44px; }
        .form-row { grid-template-columns: 1fr; }
        .actions { align-items: stretch; flex-direction: column; }
        .actions .btn, .steer-row .btn { width: 100%; }
        .steer-row { grid-template-columns: 1fr; }
        #notice { left: var(--space-4); right: var(--space-4); max-width: none; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
      }
      @media (prefers-reduced-motion: no-preference) { .card { animation: enter .3s ease both; } @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
    </style>
  </head>
  <body>
    <section class="auth-gate" id="auth-gate" aria-live="polite">
      <div class="auth-card">
        <h1 id="auth-title">登录 SynChronicle</h1>
        <p id="auth-copy">使用创作账号进入控制台。</p>
        <form id="auth-form">
          <input id="auth-name" autocomplete="username" minlength="2" maxlength="32" placeholder="用户名" required />
          <input id="auth-password" type="password" autocomplete="current-password" minlength="8" placeholder="密码" required />
          <button class="btn btn-filled" id="auth-submit" type="submit">登录</button>
        </form>
      </div>
    </section>
    <header class="topbar">
      <a class="brand" href="#" aria-label="SynChronicle 控制台">S<em>—</em><small>本地创作控制台</small></a>
      <div class="topbar-right">
        <a class="view-site" href="/read"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3l-1.42-1.42l9.3-9.29H14V3Z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5Z"/></svg><span class="vs-text">前台阅读</span></a>
        <span class="chip small" id="user-chip" hidden></span><button class="btn btn-text" id="logout" type="button" hidden>退出</button>
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
          <button type="button" data-view="overview" title="创作概览" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg><span class="nv-t">创作概览</span></button>
        </nav>
        <div class="side-label">内容</div>
        <nav class="side-nav">
          <button type="button" data-view="studio" title="写作台"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="5" height="15" rx="1.5"/><rect x="9.5" y="4.5" width="5" height="15" rx="1.5"/><path d="M16.5 6l3.2.9-2.9 10.9"/></svg><span class="nv-t">写作台</span></button>
          <button type="button" data-view="prep" title="创作准备"><span class="nv-t">创作准备</span></button>
          <button type="button" data-view="reader" title="章节与大纲"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.2C10.4 4.5 8 4 4 4v13.5c4 0 6.4.5 8 2.3 1.6-1.8 4-2.3 8-2.3V4c-4 0-6.4.5-8 2.2z"/><path d="M12 6.2v13.6"/></svg><span class="nv-t">章节与大纲</span><span class="nav-count" id="nav-count-chapters" hidden></span></button>
          <button type="button" data-view="entities" title="人物图谱"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="8.5" y1="7.5" x2="15.5" y2="7.5"/><line x1="7.5" y1="8.5" x2="10.5" y2="15.5"/><line x1="16.5" y1="8.5" x2="13.5" y2="15.5"/></svg><span class="nv-t">人物图谱</span><span class="nav-count" id="nav-count-entities" hidden></span></button>
          <button type="button" data-view="records" title="运行记录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/></svg><span class="nv-t">运行记录</span></button>
        </nav>
        <div class="side-label">管理</div>
        <nav class="side-nav">
          <button type="button" data-view="settings" title="配置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h9M17.5 8H20M4 16h3M11.5 16H20"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/></svg><span class="nv-t">配置</span></button>
        </nav>
        <div class="side-foot">Local runtime<br />作品、配置与运行记录均保存在本机。</div>
      </aside>
      <main class="main">
        <div id="advice-bar" aria-live="polite"></div>
        <section class="page" data-page="overview" aria-label="创作概览">
          <div class="page-head">
            <div><h1>创作概览</h1><p class="meta">从一个 brief 开始，持续推进你的故事。</p></div>
            <div class="head-actions" id="runtime-actions" hidden><button id="resume" class="btn btn-tonal" type="button">恢复上一轮</button><button id="new-run" class="btn btn-text" type="button">新建 brief</button></div>
          </div>
          <div class="stat-row">
            <div class="stat-split"><div class="stat-top">引擎<code>engine</code></div><b id="state">setup</b></div>
            <div class="stat-split"><div class="stat-top">模型<code>model</code></div><b id="model">—</b></div>
            <div class="stat-split"><div class="stat-top">输入 tokens<code>prompt</code></div><b id="input">0</b></div>
            <div class="stat-split"><div class="stat-top">输出 tokens<code>output</code></div><b id="output">0</b></div>
          </div>
          <div class="card" style="margin-bottom:20px"><div class="panel-head"><h3>进化引擎</h3><button class="btn btn-text" id="evolution-distill" type="button">蒸馏经验</button></div><div class="rowlines" id="evolution-list"><div class="empty">暂无跨章经验。</div></div></div>
          <div class="grid">
            <section class="stack">
              <div class="card hero">
                <div class="announce"><b>Local</b><span>作品、配置与运行记录均保存在本机</span><span class="mono-chip">草稿自动归档</span></div>
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
              <div class="card" id="autopilot-card">
                <div class="panel-head"><h3 class="section-title" style="margin:0">自动驾驶</h3><span id="ap-phase" class="pill muted">未启动</span></div>
                <div class="rowlines" id="ap-stats" hidden></div>
                <div id="ap-checkpoint" hidden>
                  <div class="tf" style="margin-top:10px"><textarea id="ap-proposal" style="min-height:110px;font-size:12.5px" readonly></textarea><label for="ap-proposal">AI 提案（可全选复制）</label></div>
                  <div class="tf" style="margin-top:8px"><textarea id="ap-tweak" style="min-height:56px" placeholder=" "></textarea><label for="ap-tweak">微调意见（留空直接放行；前提阶段微调将覆写前提）</label></div>
                  <div class="actions" style="margin-top:10px"><small id="ap-hint">检查点等待中。</small><div style="display:flex;gap:8px"><button id="ap-tweak-btn" class="btn btn-tonal" type="button" style="min-height:32px;font-size:12px">提交微调并继续</button><button id="ap-proceed" class="btn btn-filled" type="button" style="min-height:32px;font-size:12px">直接放行</button></div></div>
                </div>
                <div class="form-row" style="margin-top:10px" id="ap-launcher">
                  <div class="tf"><input id="ap-idea" placeholder=" " /><label for="ap-idea">一句话想法（AI 全程接管）</label></div>
                  <div class="tf"><input id="ap-params" placeholder=" " value="75分 / 重写2次 / 两站检查点" /><label for="ap-params">门禁参数（分数/重写/检查点）</label></div>
                </div>
                <div class="actions" style="margin-top:10px" id="ap-controls"><small>前提/大纲两站微调，其余全自动：写作→编辑打分→达标采纳。</small><div style="display:flex;gap:8px"><button id="ap-start" class="btn btn-filled" type="button" style="min-height:32px;font-size:12px">开启自动驾驶</button><button id="ap-pause" class="btn btn-tonal" type="button" style="min-height:32px;font-size:12px" hidden>暂停</button><button id="ap-resume" class="btn btn-text" type="button" style="min-height:32px;font-size:12px" hidden>继续</button></div></div>
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
                <div class="panel-head"><h3>项目宪法</h3><span id="constitution-count">0 条</span></div>
                <div class="rowlines" id="constitution-rows"><div class="empty">尚未设置锁定规则。</div></div>
                <div class="form-row" style="margin-top:10px">
                  <div class="tf"><input id="constitution-rule" placeholder=" " /><label for="constitution-rule">新增规则（世界/代价/禁写）</label></div>
                  <div class="tf"><input id="constitution-secret" placeholder=" " /><label for="constitution-secret">秘密|揭晓时点</label></div>
                </div>
                <div class="actions" style="margin-top:10px"><small>宪法自动注入每轮生成提示词。</small><button id="constitution-add" class="btn btn-tonal" type="button">添加</button></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>设定检索</h3><span id="recall-engine">RAG</span></div>
                <div class="steer-row"><div class="tf"><input id="recall-query" placeholder=" " /><label for="recall-query">检索设定 / 伏笔 / 摘要</label></div><button id="recall-run" class="btn btn-tonal" type="button">检索</button></div>
                <div class="rowlines" id="recall-results" style="margin-top:8px"><div class="empty">输入关键词检索实体图谱、章节摘要与伏笔线索。</div></div>
                <div class="actions" style="margin-top:10px"><small>把检索结果注入下一轮生成上下文。</small><button id="recall-inject" class="btn btn-text" type="button" hidden>注入上下文</button></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>成本预估</h3><span id="cost-model">—</span></div>
                <div class="rowlines" id="cost-rows"><div class="empty">尚未配置模型。</div></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>素材库</h3><span id="material-count">0 条</span></div>
                <div class="seg" role="radiogroup" aria-label="素材类型">
                  <label><input type="radio" name="material-type" value="line" checked /><span>桥段</span></label>
                  <label><input type="radio" name="material-type" value="setting" /><span>设定</span></label>
                  <label><input type="radio" name="material-type" value="trope" /><span>套路</span></label>
                  <label><input type="radio" name="material-type" value="other" /><span>其他</span></label>
                </div>
                <div class="tf" style="margin-top:10px"><input id="material-title" placeholder=" " /><label for="material-title">素材标题</label></div>
                <div class="tf" style="margin-top:8px"><textarea id="material-content" style="min-height:64px" placeholder=" "></textarea><label for="material-content">素材内容（桥段/设定/金句）</label></div>
                <div class="actions" style="margin-top:10px"><small>素材会进入设定检索语料。</small><button id="material-save" class="btn btn-tonal" type="button">保存素材</button></div>
                <div class="rowlines" id="material-list" style="margin-top:6px"><div class="empty">暂无素材。</div></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>书架（多书管理）</h3><span id="bookshelf-count">0 本</span></div>
                <div class="rowlines" id="bookshelf-rows"><div class="empty">尚未配置模型，先连接引擎。</div></div>
                <div class="steer-row" style="margin-top:10px"><div class="tf"><input id="new-book-title" placeholder=" " /><label for="new-book-title">新书名（独立工作区）</label></div><button id="book-create" class="btn btn-tonal" type="button">新建书</button></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>技能包市场</h3><span id="skillpack-count">0 启用</span></div>
                <div class="rowlines" id="skillpack-rows"><div class="empty">尚未配置模型，先连接引擎。</div></div>
                <div class="tf" style="margin-top:10px"><input id="skillpack-name" placeholder=" " /><label for="skillpack-name">自定义包名称</label></div>
                <div class="tf" style="margin-top:8px"><textarea id="skillpack-techniques" style="min-height:64px" placeholder=" "></textarea><label for="skillpack-techniques">写作技法（每行一条）</label></div>
                <div class="actions" style="margin-top:10px"><small>启用的技法随宪法注入每轮生成。</small><button id="skillpack-create" class="btn btn-tonal" type="button">创建自定义包</button></div>
              </div>
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
              <div class="card" id="user-admin" hidden>
                <div class="panel-head"><h3>用户管理</h3><span>admin</span></div>
                <form id="user-create" class="form-grid"><input id="user-name" placeholder="新用户名" minlength="2" maxlength="32" required /><input id="user-password" type="password" placeholder="初始密码（至少 8 位）" minlength="8" required /><button class="btn btn-tonal" type="submit">创建 writer</button></form>
                <div class="rowlines" id="user-list"></div>
              </div>
            </aside>
          </div>
        </section>
        <section class="page" data-page="reader" aria-label="章节与大纲" hidden>
          <div class="page-head"><div><h1>章节与大纲</h1><p class="meta">卷弧章三层结构与章节质量详情。</p></div><div class="head-actions"><button id="reader-review-btn" class="btn btn-tonal" type="button">读者评审</button><button id="golden-btn" class="btn btn-tonal" type="button">黄金三章</button><button id="platform-btn" class="btn btn-tonal" type="button">平台责编</button><button id="editor-btn" class="btn btn-tonal" type="button">编辑审稿</button><button id="brainstorm-btn" class="btn btn-tonal" type="button">脑暴</button><button id="deconstruct-btn" class="btn btn-tonal" type="button">拆书分析</button></div></div>
          <div id="reader-review-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">读者模拟评分与对抗评审</h4><span id="review-avg">—</span></div>
            <div id="review-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div id="deconstruct-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">拆书报告（结构骨架 / 节奏 / 爽点峰值）</h4><span id="deconstruct-meta">—</span></div>
            <div id="deconstruct-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div id="golden-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">黄金三章诊断（开局钩子 / 冲突 / 代入感 / 信息倾泻）</h4><span id="golden-verdict">—</span></div>
            <div id="golden-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div id="editor-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">编辑视角审稿（过稿风险清单）</h4><span id="editor-verdict">—</span></div>
            <div id="editor-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div id="brainstorm-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">节点脑暴（命名要素组合生成）</h4><span id="brainstorm-type-label">门派</span></div>
            <div class="seg" role="radiogroup" aria-label="脑暴类型">
              <label><input type="radio" name="brainstorm-type" value="sect" checked /><span>门派</span></label>
              <label><input type="radio" name="brainstorm-type" value="skill" /><span>功法</span></label>
              <label><input type="radio" name="brainstorm-type" value="place" /><span>地名</span></label>
              <label><input type="radio" name="brainstorm-type" value="name" /><span>人名</span></label>
              <label><input type="radio" name="brainstorm-type" value="faction" /><span>势力</span></label>
              <label><input type="radio" name="brainstorm-type" value="item" /><span>道具</span></label>
              <label><input type="radio" name="brainstorm-type" value="title" /><span>书名</span></label>
              <label><input type="radio" name="brainstorm-type" value="hook" /><span>钩子</span></label>
            </div>
            <div class="actions" style="margin-top:10px"><small>同 seed 可复现，产出可入库复用。</small><button id="brainstorm-run" class="btn btn-filled" type="button" style="min-height:32px;font-size:12px">生成 8 条</button></div>
            <div class="rowlines" id="brainstorm-rows" style="margin-top:8px"></div>
          </div>
          <div id="platform-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">平台责编（5 维签约打分）</h4>
              <div class="seg" role="radiogroup" aria-label="平台">
                <label><input type="radio" name="platform-type" value="fanqie" checked /><span>番茄</span></label>
                <label><input type="radio" name="platform-type" value="qidian" /><span>起点</span></label>
              </div>
            </div>
            <div id="platform-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div id="versions-panel" class="card" style="margin-bottom:18px;background:var(--alpha-4);border:1px dashed var(--line);" hidden>
            <div class="panel-head"><h4 style="margin:0">版本时光机（当前章节历史快照）</h4><span id="versions-meta">—</span></div>
            <div id="versions-rows" class="rowlines" style="margin-top:8px"></div>
          </div>
          <div class="reader">
            <aside class="card tree-card" aria-label="大纲树">
              <div class="panel-head"><h3 id="book-title">大纲</h3><span id="book-progress">—</span></div>
              <div id="outline-tree" class="tree" role="tree" aria-label="卷弧章大纲"><div class="empty">尚未开始创作。</div></div>
            </aside>
            <article class="card" aria-label="章节内容">
              <header class="chapter-head">
                <h2 id="ch-title">选择左侧章节开始阅读</h2>
                <div style="display:flex;gap:8px;align-items:center"><span id="ch-status" class="chip small" hidden></span><span id="ch-tone" class="chip small" hidden></span><span id="ch-words" class="meta"></span><button id="safety-btn" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>安全扫描</button><button id="fingerprint-btn" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>AI 痕迹</button><button id="versions-btn" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>版本时光机</button><button id="open-rewrite" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>文风重构 / 去AI味</button><button id="open-arena" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>A/B 双模型竞写</button><button id="open-branch" class="btn btn-tonal" type="button" style="min-height:30px;padding:4px 12px;font-size:12px;" hidden>剧情分支</button></div>
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
        <section class="page" data-page="studio" aria-label="写作台" hidden>
          <div class="page-head">
            <div><h1>三栏写作台</h1><p class="meta">目录 · 正文 · 工具同屏，编辑即归档版本。</p></div>
            <div class="head-actions"><span id="studio-book-name" class="meta">—</span></div>
          </div>
          <div class="studio-rail">
            <aside class="card tree-card" aria-label="章节目录">
              <div class="panel-head"><h3>目录</h3><span id="studio-progress">—</span></div>
              <div id="studio-list" class="studio-list"><div class="empty">尚未开始创作。</div></div>
            </aside>
            <article class="card" aria-label="正文编辑">
              <header class="chapter-head">
                <h2 id="studio-ch-title">选择左侧章节</h2>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span id="studio-ch-status" class="chip small" hidden></span><span id="studio-words" class="meta">0 字</span><button id="studio-save" class="btn btn-filled" type="button" style="min-height:30px;padding:4px 14px;font-size:12px;" disabled>保存并归档版本</button></div>
              </header>
              <textarea id="studio-editor" class="studio-editor" aria-label="章节正文编辑器" placeholder="选择章节后在这里直接修改正文，保存时自动写入版本时光机。" disabled></textarea>
            </article>
            <aside class="studio-tools" aria-label="写作工具">
              <div class="card">
                <div class="panel-head"><h3>设定检索</h3><span class="meta">RRF</span></div>
                <div class="steer-row"><div class="tf"><input id="studio-recall-query" placeholder=" " /><label for="studio-recall-query">检索设定 / 伏笔 / 技法</label></div><button id="studio-recall-run" class="btn btn-tonal" type="button">检索</button></div>
                <div class="rowlines" id="studio-recall-rows" style="margin-top:8px"><div class="empty">输入关键词检索。</div></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>版本时光机</h3><span id="studio-versions-meta">—</span></div>
                <div class="rowlines" id="studio-versions-rows"><div class="empty">选择章节后展示历史版本。</div></div>
              </div>
              <div class="card">
                <div class="panel-head"><h3>快捷质检</h3><span class="meta">本章</span></div>
                <div class="actions" style="margin-top:8px"><small>AI 痕迹四信号扫描。</small><button id="studio-fingerprint" class="btn btn-tonal" type="button" style="min-height:32px;font-size:12px" disabled>AI 痕迹扫描</button></div>
              </div>
            </aside>
          </div>
        </section>
        <section class="page" data-page="entities" aria-label="人物图谱" hidden>
          <div class="page-head">
            <div><h1>人物与势力图谱</h1><p class="meta">追踪出场角色性格羁绊、势力归属与心境动态弧度。</p></div>
            <div class="head-actions"><label class="btn btn-text" for="card-file-input" style="cursor:pointer">导入角色卡</label><input id="card-file-input" type="file" accept="image/png" hidden /><button id="add-entity-btn" class="btn btn-tonal" type="button">新建人物/势力</button></div>
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
              <div id="entity-chat-panel" class="card" style="background:var(--alpha-4);border:1px dashed var(--line);" hidden>
                <div class="panel-head"><h4 style="margin:0">角色对话推演</h4><span id="chat-target">—</span></div>
                <div id="chat-log" style="display:grid;gap:8px;max-height:220px;overflow:auto;margin:10px 0"></div>
                <div class="steer-row"><div class="tf"><input id="chat-input" placeholder=" " /><label for="chat-input">对角色说话…</label></div><button id="chat-send" class="btn btn-filled" type="button" style="min-height:36px;font-size:12px">发送</button></div>
                <div class="actions" style="margin-top:8px"><small>应答由实体卡驱动；提示词可复制给任意对话模型。</small><button id="chat-copy-prompt" class="btn btn-text" type="button">复制提示词</button></div>
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
        <section class="page" data-page="prep" aria-label="创作准备" hidden>
          <div class="page-head"><div><h1>创作准备</h1><p class="meta">轮数由你决定，全部对话会持续留痕。</p></div><button class="btn btn-tonal" id="prep-new" type="button">新建会话</button></div>
          <div class="grid"><div class="card"><div class="feed tall" id="prep-messages"><div class="empty">新建会话后开始对话。</div></div><div class="steer-row"><input id="prep-input" placeholder="说说你的想法" /><button class="btn btn-filled" id="prep-send" type="button">发送</button></div></div><aside class="stack"><div class="card"><div class="panel-head"><h3>阶段</h3><span id="prep-stage">—</span></div><button class="btn btn-tonal" id="prep-advance" type="button">进入下一阶段</button><button class="btn btn-filled" id="prep-confirm" type="button" hidden>确认结束并蒸馏</button><button class="btn btn-text" id="prep-autopilot" type="button" hidden>交给自动驾驶</button></div><div class="card"><div id="prep-list" class="rowlines"></div></div></aside></div>
        </section>
      </main>
    </div>
    <nav class="tabbar" aria-label="移动端主导航">
      <button type="button" data-view="overview" title="创作概览"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg><span>概览</span></button>
      <button type="button" data-view="studio" title="写作台"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="5" height="15" rx="1.5"/><rect x="9.5" y="4.5" width="5" height="15" rx="1.5"/><path d="M16.5 6l3.2.9-2.9 10.9"/></svg><span>写作台</span></button>
      <button type="button" data-view="reader" title="章节与大纲"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.2C10.4 4.5 8 4 4 4v13.5c4 0 6.4.5 8 2.3 1.6-1.8 4-2.3 8-2.3V4c-4 0-6.4.5-8 2.2z"/><path d="M12 6.2v13.6"/></svg><span>章节</span></button>
      <button type="button" data-view="entities" title="人物图谱"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="8.5" y1="7.5" x2="15.5" y2="7.5"/><line x1="7.5" y1="8.5" x2="10.5" y2="15.5"/><line x1="16.5" y1="8.5" x2="13.5" y2="15.5"/></svg><span>图谱</span></button>
      <button type="button" data-view="records" title="运行记录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/></svg><span>记录</span></button>
      <button type="button" data-view="settings" title="配置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h9M17.5 8H20M4 16h3M11.5 16H20"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/></svg><span>配置</span></button>
    </nav>
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
      const nativeFetch = window.fetch.bind(window);
      window.fetch = function(path, options) { const next = Object.assign({}, options || {}); const headers = new Headers(next.headers || {}); headers.set('x-requested-with', 'fetch'); next.headers = headers; return nativeFetch(path, next).then((response) => { if (response.status === 401 && String(path).indexOf('/api/auth/') !== 0) $('auth-gate').hidden = false; return response; }); };
      async function post(path, body) { const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败'); return data; }
      let authMode = 'login';
      async function detectAuth() { const response = await fetch('/api/auth/me'); if (response.ok) { const data = await response.json(); $('auth-gate').hidden = true; $('user-chip').hidden = false; $('logout').hidden = false; $('user-chip').textContent = data.user.name + ' (' + data.user.role + ')'; if (data.user.role === 'admin') { $('user-admin').hidden = false; void loadUsers(); } return; } $('auth-gate').hidden = false; }
      async function loadUsers() { const response = await fetch('/api/users'); if (!response.ok) return; const data = await response.json(); const list = $('user-list'); list.replaceChildren(); for (const user of data.users) { const row = document.createElement('div'); row.className = 'rowline'; const label = document.createElement('span'); label.textContent = user.name + ' · ' + user.role; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-text'; button.textContent = user.disabled ? '启用' : '停用'; button.disabled = user.role === 'admin'; button.addEventListener('click', async () => { await post('/api/users/' + encodeURIComponent(user.id) + '/disable'); await loadUsers(); }); row.append(label, button); list.append(row); } }
      $('user-create').addEventListener('submit', async (event) => { event.preventDefault(); try { await post('/api/users', { name: $('user-name').value.trim(), password: $('user-password').value }); $('user-name').value = ''; $('user-password').value = ''; await loadUsers(); showNotice('writer 账号已创建。', 'success'); } catch (error) { showNotice(error.message || '创建用户失败'); } });
      $('logout').addEventListener('click', async () => { await post('/api/auth/logout'); location.reload(); });
      $('auth-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const response = await fetch('/api/auth/' + authMode, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('auth-name').value.trim(), password: $('auth-password').value }) }); const data = await response.json(); if (!response.ok) { if (response.status === 401 && authMode === 'login') { const setup = await fetch('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('auth-name').value.trim(), password: $('auth-password').value }) }); if (setup.status === 201) { authMode = 'login'; $('auth-title').textContent = '管理员已初始化'; $('auth-copy').textContent = '再次提交即可登录控制台。'; return; } } throw new Error(data.error || '认证失败'); } location.reload(); } catch (error) { showNotice(error.message || '认证失败'); } });
      void detectAuth();
      function applyStatus(data) { currentState = data.snapshot?.runtimeState || (data.configured ? 'idle' : 'setup'); const ready = Boolean(data.configured); const active = currentState === 'running'; const status = $('runtime-status'); status.dataset.state = data.error ? 'error' : currentState; status.querySelector('span').textContent = data.error ? '服务异常' : (stateLabels[currentState] || currentState); $('progress').hidden = !active; $('state').textContent = currentState; $('state').dataset.state = currentState; $('model').textContent = data.snapshot?.model || '—'; $('input').textContent = formatNumber(data.snapshot?.usage?.inputTokens); $('output').textContent = formatNumber(data.snapshot?.usage?.outputTokens); $('prompt').disabled = !ready || active || currentState === 'closed'; $('run').disabled = !ready || active || currentState === 'closed'; $('run').textContent = active ? '创作进行中…' : currentState === 'paused' ? '继续创作' : '开始创作'; $('steering-panel').classList.toggle('show', ready); $('runtime-actions').hidden = !ready || !['paused', 'completed'].includes(currentState); $('resume').hidden = currentState !== 'paused'; if (!active) $('live-state').textContent = '本轮已完成'; if (data.events) { eventsBuf = data.events; renderEvents(eventsBuf); } }
      function renderAdvice(items) { const target = $('advice-bar'); if (!target) return; target.replaceChildren(); for (const item of items || []) { const row = document.createElement('div'); row.className = 'announce'; const text = document.createElement('span'); text.textContent = item.message; const dismiss = document.createElement('button'); dismiss.className = 'btn btn-text'; dismiss.type = 'button'; dismiss.textContent = '忽略'; dismiss.addEventListener('click', async () => { await post('/api/advice/dismiss', { id: item.id }); row.remove(); }); row.append(text, dismiss); target.append(row); } }
      async function refresh() { try { applyStatus(await (await fetch('/api/status')).json()); } catch { $('runtime-status').dataset.state = 'error'; $('runtime-status').querySelector('span').textContent = '本地服务未连接'; showNotice('无法连接本地服务，请确认 SynChronicle 仍在运行。'); } }
      function appendDelta(value) { if (value === RUN_END) { $('live-state').textContent = '本轮已完成'; return; } $('live-card').hidden = false; $('live-state').textContent = '生成中'; const el = $('live-text'); el.textContent = (el.textContent + value).slice(-4000); el.scrollTop = el.scrollHeight; }
      let sseErrored = false; let pollTimer = 0;
      function startPolling() { if (pollTimer) return; pollTimer = setInterval(() => void refresh(), 3000); }
      const es = new EventSource('/api/stream');
       es.addEventListener('snapshot', (e) => { const data = JSON.parse(e.data); applyStatus(data); renderAdvice(data.advice); });
      es.addEventListener('runtime', (e) => pushEvent(JSON.parse(e.data)));
      es.addEventListener('delta', (e) => appendDelta(JSON.parse(e.data).value));
      es.onerror = () => { if (sseErrored) { es.close(); startPolling(); } sseErrored = true; };
      function showView(view) { document.querySelectorAll('.page').forEach((page) => { page.hidden = page.dataset.page !== view; }); document.querySelectorAll('[data-view]').forEach((button) => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }); if (view === 'reader') void loadBook(); if (view === 'studio') void loadStudio(); if (view === 'prep') void loadPrepList(); }
      document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
      function flatten(book) { const rows = []; for (const volume of book.volumes) for (const arc of volume.arcs) for (const chapter of arc.chapters) rows.push(chapter); return rows; }
      function pickTargetChapter(rows) { return rows.find((row) => row.status === 'in-progress') || [...rows].reverse().find((row) => row.status === 'completed') || rows[0]; }
      function rowPill(label, count, tone) { const pill = document.createElement('span'); pill.className = 'pill ' + tone; pill.textContent = count + ' ' + label; return pill; }
      async function loadBookSummary() { const box = $('book-rows'); try { const data = await (await fetch('/api/book')).json(); if (!data.configured || !data.book) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; box.append(empty); $('book-phase').textContent = '—'; return; } const book = data.book; const rows = flatten(book); const done = rows.filter((row) => row.status === 'completed').length; const rewrite = rows.filter((row) => row.status === 'rewrite').length; const pending = rows.length - done - rewrite; box.replaceChildren(); const rowA = document.createElement('div'); rowA.className = 'rowline'; const labelA = document.createElement('span'); labelA.textContent = '章节进度'; const pills = document.createElement('div'); pills.className = 'pills'; pills.append(rowPill('已完成', done, 'ok'), rowPill('待写', pending, 'muted')); if (rewrite) pills.append(rowPill('待重写', rewrite, 'bad')); rowA.append(labelA, pills); const rowB = document.createElement('div'); rowB.className = 'rowline'; const labelB = document.createElement('span'); labelB.textContent = '全书字数'; const valueB = document.createElement('span'); valueB.style.fontWeight = '700'; valueB.style.fontSize = '15px'; valueB.textContent = formatNumber(book.totalWordCount); rowB.append(labelB, valueB); const rowC = document.createElement('div'); rowC.className = 'rowline'; const labelC = document.createElement('span'); labelC.textContent = '阅读前台'; const link = document.createElement('a'); link.href = '/read'; link.className = 'btn btn-text'; link.style.minHeight = '32px'; link.textContent = '打开 /read'; rowC.append(labelC, link); box.append(rowA, rowB, rowC); $('book-phase').textContent = phaseLabels[book.phase] || book.phase; const navChapters = $('nav-count-chapters'); if (navChapters) { navChapters.textContent = rows.length + '章'; navChapters.hidden = rows.length === 0; } } catch { /* 保持现有内容 */ } }
      function treeEmpty(message) { $('outline-tree').replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = message; $('outline-tree').append(empty); $('book-progress').textContent = '—'; }
      async function loadBook() { try { const data = await (await fetch('/api/book')).json(); if (!data.configured || !data.book) { $('book-title').textContent = '大纲'; treeEmpty('尚未配置模型，先在概览页连接引擎。'); return; } const book = data.book; $('book-title').textContent = book.novelName || '大纲'; $('book-progress').textContent = book.completedChapters.length + '/' + (book.totalChapters || flatten(book).length) + ' 章'; const tree = $('outline-tree'); tree.replaceChildren(); const rows = flatten(book); if (!rows.length) { treeEmpty('尚未开始创作，提交 brief 后这里会长出大纲。'); return; } for (const volume of book.volumes) { const vol = document.createElement('div'); vol.className = 'vol'; vol.textContent = '第 ' + volume.index + ' 卷 · ' + (volume.title || '未命名'); tree.append(vol); for (const arc of volume.arcs) { const arcLabel = document.createElement('div'); arcLabel.className = 'arc'; arcLabel.textContent = ' ' + (arc.title || '弧') + (arc.goal ? ' — ' + arc.goal : ''); tree.append(arcLabel); for (const chapter of arc.chapters) { const row = document.createElement('button'); row.type = 'button'; row.className = 'trow'; row.dataset.chapter = String(chapter.chapter); row.setAttribute('role', 'treeitem'); const dot = document.createElement('i'); dot.className = 'dot s-' + chapter.status; dot.setAttribute('aria-hidden', 'true'); const label = document.createElement('span'); label.textContent = chapter.chapter + '. ' + chapter.title; const words = document.createElement('small'); words.textContent = chapter.wordCount ? formatNumber(chapter.wordCount) + ' 字' : ''; row.append(dot, label, words); row.addEventListener('click', () => selectChapter(chapter.chapter)); tree.append(row); } } } const target = pickTargetChapter(rows); if (target) selectChapter(target.chapter); } catch { treeEmpty('加载大纲失败，请稍后重试。'); } }
      let currentChapter = 0;
      function selectChapter(chapter) { currentChapter = chapter; document.querySelectorAll('.trow').forEach((row) => { const active = Number(row.dataset.chapter) === chapter; row.classList.toggle('active', active); row.setAttribute('aria-selected', String(active)); }); void loadChapter(chapter); }
      async function fetchChapter(chapter) { return (await fetch('/api/chapters/' + chapter)).json(); }
      const apPhaseLabels = { idle: '未启动', premise: '生成前提', 'premise-review': '前提待微调', outline: '生成大纲', 'outline-review': '大纲待微调', 'chapter-review': '章节待确认', writing: '逐章写作', complete: '已完成', stopped: '已暂停', error: '出错' };
      async function apAction(action, extra) { return post('/api/autopilot', Object.assign({ action: action }, extra || {})); }
      async function refreshAutopilot() {
        try {
          const res = await (await fetch('/api/autopilot')).json();
          if (!res.configured || !res.state) { $('ap-phase').textContent = '未配置'; return; }
          renderAutopilot(res.state);
        } catch { /* 静默 */ }
      }
      function renderAutopilot(state) {
        const phase = $('ap-phase');
        if (!phase) return;
        phase.textContent = apPhaseLabels[state.phase] || state.phase;
        phase.className = 'pill ' + (state.phase === 'complete' ? 'ok' : state.phase === 'error' ? 'bad' : state.phase.includes('review') ? 'warn' : state.phase === 'idle' || state.phase === 'stopped' ? 'muted' : 'ok');
        const stats = $('ap-stats');
        const atCheckpoint = state.phase === 'premise-review' || state.phase === 'outline-review' || state.phase === 'chapter-review';
        stats.hidden = state.phase === 'idle';
        stats.replaceChildren();
        if (state.phase !== 'idle') {
          const items = [['已采纳', state.adoptedCount + ' 章'], ['当前章', state.currentChapter || '—'], ['重写', state.rewriteCount + '/' + state.settings.maxRewrites], ['上稿得分', state.lastScore || '—'], ['预算', state.budgetUsd > 0 ? '$' + state.costUsd.toFixed(2) + ' / $' + state.budgetUsd.toFixed(2) : '未设上限']];
          if (state.reviewQueue.length) items.push(['待复核', state.reviewQueue.join('、') + ' 章']);
          for (const [label, value] of items) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('span'); left.textContent = label;
            const right = document.createElement('small'); right.style.color = 'var(--muted)'; right.textContent = value;
            row.append(left, right);
            stats.append(row);
          }
          if (state.error) { const row = document.createElement('div'); row.className = 'rowline'; const note = document.createElement('small'); note.style.color = 'var(--danger, #e5484d)'; note.textContent = state.error; row.append(note); stats.append(row); }
        }
        const checkpoint = $('ap-checkpoint');
        checkpoint.hidden = !atCheckpoint;
        if (atCheckpoint) {
          $('ap-proposal').value = state.proposal || '（无提案内容）';
          $('ap-hint').textContent = state.phase === 'premise-review' ? '检查点 1/2：前提。微调将覆写前提后进入大纲。' : state.phase === 'outline-review' ? '检查点 2/2：大纲。微调将作为干预注入写作。' : '章节检查点：放行后继续写作。';
        }
        const running = ['premise', 'outline', 'writing'].includes(state.phase);
        $('ap-pause').hidden = !running && !atCheckpoint;
        $('ap-resume').hidden = state.phase !== 'stopped';
        $('ap-start').hidden = running;
        $('ap-launcher').hidden = running;
      }
      let apTimer = null;
      function apWatch() {
        clearInterval(apTimer);
        apTimer = setInterval(async () => {
          try {
            const res = await (await fetch('/api/autopilot')).json();
            if (!res.configured || !res.state) return;
            renderAutopilot(res.state);
            const active = ['premise', 'outline', 'writing', 'premise-review', 'outline-review', 'chapter-review'].includes(res.state.phase);
            if (!active) clearInterval(apTimer);
          } catch { /* 静默 */ }
        }, 4000);
      }
      $('ap-start')?.addEventListener('click', async () => {
        const idea = $('ap-idea')?.value.trim();
        if (!idea) { showNotice('先填一句话想法'); return; }
        try { await apAction('start', { idea: idea, checkpoint: 'premise-outline', scoreThreshold: 75, maxRewrites: 2 }); showNotice('自动驾驶已启动，先到前提检查点。', 'success'); apWatch(); await refreshAutopilot(); }
        catch (err) { showNotice(err.message || '启动失败'); }
      });
      $('ap-proceed')?.addEventListener('click', async () => {
        try { const res = await apAction('proceed'); renderAutopilot(res.state); apWatch(); showNotice('已放行，流水线继续。', 'success'); }
        catch (err) { showNotice(err.message || '操作失败'); }
      });
      $('ap-tweak-btn')?.addEventListener('click', async () => {
        const text = $('ap-tweak')?.value.trim();
        if (!text) { showNotice('填写微调意见，或点直接放行'); return; }
        try { const res = await apAction('tweak', { text: text }); if ($('ap-tweak')) $('ap-tweak').value = ''; renderAutopilot(res.state); apWatch(); showNotice('微调已提交，流水线继续。', 'success'); }
        catch (err) { showNotice(err.message || '微调失败'); }
      });
      $('ap-pause')?.addEventListener('click', async () => {
        try { const res = await apAction('pause'); renderAutopilot(res.state); showNotice('将在章节边界暂停。', 'success'); }
        catch (err) { showNotice(err.message || '操作失败'); }
      });
      $('ap-resume')?.addEventListener('click', async () => {
        try { const res = await apAction('resume'); renderAutopilot(res.state); apWatch(); }
        catch (err) { showNotice(err.message || '恢复失败'); }
      });
      refreshAutopilot();
      async function loadEvolution() { const data = await (await fetch('/api/evolution')).json(); const list = $('evolution-list'); list.replaceChildren(); for (const lesson of data.lessons || []) { if (lesson.status !== 'active') continue; const row = document.createElement('div'); row.className = 'rowline'; const text = document.createElement('span'); text.textContent = lesson.dimension + ' · ' + lesson.lesson; const meta = document.createElement('small'); meta.textContent = '使用 ' + lesson.useCount + ' 次'; row.append(text, meta); list.append(row); } if (!list.children.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无跨章经验。'; list.append(empty); } }
      $('evolution-distill').addEventListener('click', async () => { await post('/api/evolution/distill'); await loadEvolution(); });
      void loadEvolution();
      let prepCurrent = null; let prepBrief = '';
      async function loadPrepList() { const data = await (await fetch('/api/prep')).json(); const list = $('prep-list'); list.replaceChildren(); for (const session of data.sessions || []) { const button = document.createElement('button'); button.className = 'btn btn-text'; button.textContent = (session.title || '未命名准备') + ' · ' + session.stage + ' · ' + session.rounds + '轮'; button.addEventListener('click', () => loadPrep(session.id)); list.append(button); } }
      async function loadPrep(id) { const data = await (await fetch('/api/prep/' + encodeURIComponent(id))).json(); prepCurrent = data.session; renderPrep(); }
      function renderPrep() { const box = $('prep-messages'); box.replaceChildren(); for (const message of prepCurrent.messages) { const row = document.createElement('div'); row.className = 'event'; const who = document.createElement('time'); who.textContent = message.role === 'user' ? '你' : 'AI'; const text = document.createElement('span'); text.textContent = message.content; row.append(who, text); box.append(row); } $('prep-stage').textContent = prepCurrent.stage; $('prep-advance').hidden = prepCurrent.stage === 'ready' || prepCurrent.status !== 'active'; $('prep-confirm').hidden = prepCurrent.stage !== 'ready' || prepCurrent.status !== 'active'; }
      $('prep-new').addEventListener('click', async () => { const data = await post('/api/prep', { title: '新书准备' }); prepCurrent = data.session; renderPrep(); await loadPrepList(); });
      $('prep-send').addEventListener('click', async () => { if (!prepCurrent) return showNotice('先新建准备会话'); const text = $('prep-input').value.trim(); if (!text) return; const data = await post('/api/prep/' + encodeURIComponent(prepCurrent.id) + '/chat', { text: text }); prepCurrent = data.session; $('prep-input').value = ''; renderPrep(); });
      $('prep-advance').addEventListener('click', async () => { const data = await post('/api/prep/' + encodeURIComponent(prepCurrent.id) + '/advance'); prepCurrent = data.session; renderPrep(); });
      $('prep-confirm').addEventListener('click', async () => { const data = await post('/api/prep/' + encodeURIComponent(prepCurrent.id) + '/confirm'); prepBrief = data.brief; prepCurrent.status = 'confirmed'; $('prep-autopilot').hidden = false; renderPrep(); });
      $('prep-autopilot').addEventListener('click', async () => { await apAction('start', { idea: prepBrief, checkpoint: 'premise-outline', scoreThreshold: 75, maxRewrites: 2 }); showView('overview'); });
      async function loadChapter(chapter) { try { const data = await fetchChapter(chapter); if (!data.configured || !data.chapter) { $('ch-title').textContent = '尚未配置模型'; return; } const view = data.chapter; $('ch-title').textContent = view.title || ('第 ' + chapter + ' 章'); const chip = $('ch-status'); chip.hidden = false; chip.textContent = chapterLabels[view.status] || view.status; chip.dataset.state = view.status === 'rewrite' ? 'error' : view.status === 'completed' ? 'idle' : 'running';           $('ch-words').textContent = (view.source === 'draft' ? '草稿 · ' : '') + formatNumber(view.wordCount) + ' 字';
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
           const sfBtn = $('safety-btn');
           if (sfBtn) sfBtn.hidden = !view.text;
           const fpBtn = $('fingerprint-btn');
           if (fpBtn) fpBtn.hidden = !view.text;
           const verBtn = $('versions-btn');
           if (verBtn) verBtn.hidden = !view.text;
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
      let recallSnippetText = '';
      async function fetchRecall(query) { return (await fetch('/api/recall?q=' + encodeURIComponent(query))).json(); }
      $('recall-run')?.addEventListener('click', async () => {
        const query = $('recall-query')?.value.trim();
        const box = $('recall-results');
        if (!query || !box) return;
        try {
          const res = await fetchRecall(query);
          $('recall-engine').textContent = res.engine === 'embedding' ? '向量检索' : 'BM25';
          box.replaceChildren();
          recallSnippetText = '';
          if (!res.hits?.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '无命中，换个关键词试试。'; box.append(empty); $('recall-inject').hidden = true; return; }
          for (const hit of res.hits) {
            recallSnippetText += '[' + hit.kind + '] ' + hit.source + ' — ' + hit.snippet + '\n';
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const pill = document.createElement('span'); pill.className = 'pill ' + (hit.kind === 'entity' ? 'ok' : hit.kind === 'foreshadow' ? 'warn' : 'muted'); pill.textContent = hit.kind;
            const label = document.createElement('span'); label.style.marginLeft = '6px'; label.textContent = hit.source;
            left.append(pill, label);
            const score = document.createElement('small'); score.style.color = 'var(--faint)'; score.textContent = String(hit.score);
            row.append(left, score);
            box.append(row);
          }
          $('recall-inject').hidden = false;
        } catch (err) { showNotice(err.message || '检索失败'); }
      });
      $('recall-inject')?.addEventListener('click', async () => {
        if (!recallSnippetText) return;
        try {
          await post('/api/inject', { text: '[设定检索结果]\n' + recallSnippetText.trim() });
          showNotice('检索结果已注入，将在下一轮生成时生效。', 'success');
        } catch (err) { showNotice(err.message || '注入失败'); }
      });
      async function loadCostPreview() {
        const box = $('cost-rows');
        if (!box) return;
        try {
          const res = await (await fetch('/api/cost-preview')).json();
          $('cost-model').textContent = res.model || '—';
          box.replaceChildren();
          const rows = [
            ['计划规模', res.totalChars > 0 ? formatNumber(Math.round(res.totalChars / 1000)) + 'k 字' : '未设定'],
            ['预估 tokens', formatNumber(res.inputTokens + res.outputTokens)],
            ['预估成本', res.usd.high > 0 ? '$' + res.usd.low + ' ~ $' + res.usd.high : '按自定义价格计算'],
          ];
          for (const [label, value] of rows) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('span'); left.textContent = label;
            const right = document.createElement('b'); right.style.fontSize = '14px'; right.textContent = value;
            row.append(left, right);
            box.append(row);
          }
        } catch { box.replaceChildren(); }
      }
      $('safety-btn')?.addEventListener('click', async () => {
        if (!currentChapter) return;
        try {
          const res = await post('/api/safety/scan', { chapter: currentChapter });
          if (res.clean) { showNotice('第 ' + currentChapter + ' 章安全扫描通过，未命中敏感模式。', 'success'); return; }
          const detail = res.hits.map((hit) => hit.category + ' x' + hit.count).join('，');
          showNotice('安全扫描命中：' + detail, 'warn');
        } catch (err) { showNotice(err.message || '扫描失败'); }
      });
      $('reader-review-btn')?.addEventListener('click', async () => {
        const panel = $('reader-review-panel');
        const box = $('review-rows');
        if (!panel || !box) return;
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        try {
          const res = await (await fetch('/api/reader-review')).json();
          box.replaceChildren();
          if (!res.configured || !res.report || !res.report.chapters.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无可评审的已完成章节。'; box.append(empty); $('review-avg').textContent = '—'; return; }
          $('review-avg').textContent = '均分 ' + res.report.averageScore;
          for (const row of res.report.chapters) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '第 ' + row.chapter + ' 章 读者分';
            const right = document.createElement('div'); right.className = 'pills';
            const scorePill = document.createElement('span'); scorePill.className = 'pill ' + (row.score >= 70 ? 'ok' : row.score >= 55 ? 'muted' : 'bad'); scorePill.textContent = String(row.score);
            const dim = document.createElement('small'); dim.style.color = 'var(--faint)'; dim.textContent = '爽' + row.dimensions.thrill + ' 钩' + row.dimensions.hook + ' 律' + row.dimensions.rhythm + ' 话' + row.dimensions.dialogue;
            right.append(scorePill, dim);
            line.append(left, right);
            box.append(line);
          }
          for (const finding of res.report.findings) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '⚠ ' + finding.evidence;
            const pill = document.createElement('span'); pill.className = 'pill ' + (finding.severity === 'warning' ? 'bad' : 'muted'); pill.textContent = finding.attack;
            line.append(left, pill);
            box.append(line);
          }
        } catch { box.replaceChildren(); }
      });
      $('deconstruct-btn')?.addEventListener('click', async () => {
        const panel = $('deconstruct-panel');
        const box = $('deconstruct-rows');
        if (!panel || !box) return;
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        try {
          const book = await (await fetch('/api/book')).json();
          if (!book.configured || !book.book) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; box.append(empty); return; }
          const parts = [];
          for (const volume of book.book.volumes) for (const arc of volume.arcs) for (const chapter of arc.chapters) {
            if (chapter.status === 'pending' || !chapter.wordCount) continue;
            const detail = await (await fetch('/api/chapters/' + chapter.chapter)).json();
            if (detail.chapter?.text) parts.push('第 ' + chapter.chapter + ' 章 ' + (chapter.title || '') + '\n' + detail.chapter.text);
          }
          if (!parts.length) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无可分析的已写章节。'; box.append(empty); return; }
          const res = await post('/api/deconstruct', { text: parts.join('\n\n') });
          $('deconstruct-meta').textContent = res.totalChapters + ' 章 · ' + formatNumber(res.totalWords) + ' 字';
          box.replaceChildren();
          const acts = res.acts.map((act) => act.act + ' ' + Math.round(act.ratio * 100) + '%').join(' → ');
          const peaks = res.peaks.map((peak) => '第' + peak.chapter + '章(' + peak.composite + ')').join('、');
          const terms = res.topBigrams.map((item) => item.term + '×' + item.count).join('、') || '—';
          for (const [label, value] of [['三幕骨架', acts], ['爽点峰值', peaks || '—'], ['高频词', terms]]) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = label;
            const right = document.createElement('small'); right.style.color = 'var(--muted)'; right.textContent = value;
            line.append(left, right);
            box.append(line);
          }
        } catch (err) { showNotice(err.message || '拆书失败'); }
      });
      $('card-file-input')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const buffer = await file.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const res = await post('/api/entities/import-card', { pngBase64: btoa(binary) });
          showNotice('角色卡【' + res.name + '】已导入实体图谱。', 'success');
          await loadEntities();
        } catch (err) { showNotice(err.message || '角色卡导入失败'); }
        event.target.value = '';
      });
      async function loadMaterials() {
        const box = $('material-list');
        if (!box) return;
        try {
          const res = await (await fetch('/api/materials')).json();
          const items = res.materials || [];
          $('material-count').textContent = items.length + ' 条';
          box.replaceChildren();
          if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无素材。'; box.append(empty); return; }
          for (const material of items) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const title = document.createElement('b'); title.textContent = material.title;
            const pill = document.createElement('span'); pill.className = 'pill muted'; pill.style.marginLeft = '6px'; pill.textContent = material.type;
            left.append(title, pill);
            const del = document.createElement('button'); del.className = 'btn btn-text'; del.style.minHeight = '28px'; del.textContent = '删除';
            del.addEventListener('click', async () => {
              try {
                await fetch('/api/materials/' + material.id, { method: 'DELETE' });
                await loadMaterials();
              } catch (err) { showNotice(err.message || '删除失败'); }
            });
            row.append(left, del);
            box.append(row);
          }
        } catch { box.replaceChildren(); }
      }
      $('material-save')?.addEventListener('click', async () => {
        const title = $('material-title')?.value.trim();
        const content = $('material-content')?.value.trim();
        const type = document.querySelector('input[name="material-type"]:checked')?.value || 'other';
        if (!title || !content) { showNotice('标题与内容必填'); return; }
        try {
          await post('/api/materials', { type, title, content, source: 'manual' });
          $('material-title').value = '';
          $('material-content').value = '';
          showNotice('素材已入库。', 'success');
          await loadMaterials();
        } catch (err) { showNotice(err.message || '保存失败'); }
      });
      let lastBrainstormSeed = 0;
      $('brainstorm-btn')?.addEventListener('click', () => {
        const panel = $('brainstorm-panel');
        if (panel) panel.hidden = !panel.hidden;
      });
      $('brainstorm-run')?.addEventListener('click', async () => {
        const box = $('brainstorm-rows');
        if (!box) return;
        const type = document.querySelector('input[name="brainstorm-type"]:checked')?.value || 'sect';
        const labelMap = { sect: '门派', skill: '功法', place: '地名', name: '人名', faction: '势力', item: '道具', title: '书名', hook: '钩子' };
        try {
          lastBrainstormSeed = Date.now();
          const res = await (await fetch('/api/brainstorm?type=' + type + '&count=8&seed=' + lastBrainstormSeed)).json();
          $('brainstorm-type-label').textContent = labelMap[type] || type;
          box.replaceChildren();
          for (const item of res.items) {
            const row = document.createElement('div'); row.className = 'rowline';
            const label = document.createElement('span'); label.textContent = item;
            const save = document.createElement('button'); save.className = 'btn btn-text'; save.style.minHeight = '28px'; save.textContent = '入库';
            save.addEventListener('click', async () => {
              try {
                await post('/api/materials', { type: 'other', title: item, content: type + ':' + item, tags: ['脑暴'], source: 'brainstorm' });
                showNotice('【' + item + '】已入库素材。', 'success');
                await loadMaterials();
              } catch (err) { showNotice(err.message || '入库失败'); }
            });
            row.append(label, save);
            box.append(row);
          }
        } catch (err) { showNotice(err.message || '脑暴失败'); }
      });
      $('golden-btn')?.addEventListener('click', async () => {
        const panel = $('golden-panel');
        const box = $('golden-rows');
        if (!panel || !box) return;
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        try {
          const res = await (await fetch('/api/golden-review')).json();
          box.replaceChildren();
          if (!res.configured || !res.report || !res.report.reviewed) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = res.report?.verdict || '暂无可评审章节。'; box.append(empty); $('golden-verdict').textContent = '—'; return; }
          $('golden-verdict').textContent = res.report.verdict + '（均分 ' + res.report.averageScore + '）';
          const dimLabel = { openingHook: '开局钩子', conflict: '冲突密度', immersion: '代入感', infoDump: '信息倾泻' };
          for (const row of res.report.chapters) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '第 ' + row.chapter + ' 章';
            const right = document.createElement('div'); right.className = 'pills';
            const scorePill = document.createElement('span'); scorePill.className = 'pill ' + (row.score >= 70 ? 'ok' : row.score >= 50 ? 'muted' : 'bad'); scorePill.textContent = String(row.score);
            const dims = document.createElement('small'); dims.style.color = 'var(--faint)'; dims.textContent = Object.entries(row.dimensions).map(([key, value]) => dimLabel[key] + ' ' + value).join(' · ');
            right.append(scorePill, dims);
            line.append(left, right);
            box.append(line);
          }
          for (const finding of res.report.findings) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '⚠ ' + finding.evidence;
            line.append(left);
            box.append(line);
          }
        } catch { box.replaceChildren(); }
      });
      $('editor-btn')?.addEventListener('click', async () => {
        const panel = $('editor-panel');
        const box = $('editor-rows');
        if (!panel || !box) return;
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        try {
          const res = await (await fetch('/api/editor-review')).json();
          box.replaceChildren();
          if (!res.configured || !res.report) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无可评审内容。'; box.append(empty); return; }
          $('editor-verdict').textContent = res.report.verdict;
          if (!res.report.risks.length) { const ok = document.createElement('div'); ok.className = 'empty'; ok.textContent = '未发现过稿风险，可以考虑投稿。'; box.append(ok); return; }
          for (const risk of res.report.risks) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '⚠ ' + risk.check + '：' + risk.evidence;
            line.append(left);
            box.append(line);
          }
        } catch { box.replaceChildren(); }
      });
      let chatEntityId = '';
      let chatHistory: Array<{ role: 'user' | 'character'; text: string }> = [];
      function openEntityChat(entity) {
        chatEntityId = entity.id;
        chatHistory = [];
        const panel = $('entity-chat-panel');
        if (!panel) return;
        panel.hidden = false;
        $('chat-target').textContent = entity.name;
        $('chat-log').replaceChildren();
        const intro = document.createElement('div'); intro.className = 'empty'; intro.textContent = '与【' + entity.name + '】对话推演人设一致性。';
        $('chat-log').append(intro);
      }
      async function sendChatMessage() {
        const input = $('chat-input');
        const log = $('chat-log');
        if (!input || !log || !chatEntityId) return;
        const message = input.value.trim();
        if (!message) return;
        input.value = '';
        const userBubble = document.createElement('div'); userBubble.style.textAlign = 'right'; userBubble.replaceChildren();
        const userText = document.createElement('span'); userText.className = 'pill muted'; userText.style.whiteSpace = 'normal'; userText.textContent = '你：' + message;
        userBubble.append(userText);
        log.append(userBubble);
        try {
          const res = await post('/api/character-chat', { entityId: chatEntityId, message, history: chatHistory });
          chatHistory.push({ role: 'user', text: message });
          chatHistory.push({ role: 'character', text: res.reply });
          const charBubble = document.createElement('div'); charBubble.style.textAlign = 'left';
          const charText = document.createElement('span'); charText.className = 'pill ok'; charText.style.whiteSpace = 'normal'; charText.textContent = res.reply;
          charBubble.append(charText);
          log.append(charBubble);
          log.scrollTop = log.scrollHeight;
        } catch (err) { showNotice(err.message || '对话失败'); }
      }
      $('chat-send')?.addEventListener('click', () => void sendChatMessage());
      $('chat-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void sendChatMessage(); } });
      $('chat-copy-prompt')?.addEventListener('click', async () => {
        if (!chatEntityId) return;
        try {
          const res = await post('/api/character-chat', { entityId: chatEntityId, message: '（获取人设提示词）', history: [] });
          await navigator.clipboard?.writeText(res.prompt).catch(() => undefined);
          showNotice('角色提示词已复制到剪贴板（也可粘贴到任意对话模型使用）。', 'success');
        } catch (err) { showNotice(err.message || '复制失败'); }
      });
      async function loadConstitution() {
        const box = $('constitution-rows');
        if (!box) return;
        try {
          const res = await (await fetch('/api/constitution')).json();
          const constitution = res.constitution;
          box.replaceChildren();
          if (!constitution) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置小说工作区。'; box.append(empty); $('constitution-count').textContent = '0 条'; return; }
          const entries: Array<[string, string]> = [
            ...constitution.worldRules.map((rule) => ['世界规则', rule] as [string, string]),
            ...constitution.abilityCosts.map((rule) => ['能力代价', rule] as [string, string]),
            ...constitution.forbiddenInfo.map((rule) => ['禁写信息', rule] as [string, string]),
            ...constitution.characterBoundaries.map((rule) => ['行为边界', rule] as [string, string]),
            ...constitution.secretReveals.map((item) => ['秘密计划', item.secret + ' → ' + item.revealAt] as [string, string]),
          ];
          $('constitution-count').textContent = entries.length + ' 条';
          if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未设置锁定规则。'; box.append(empty); return; }
          for (const [label, rule] of entries) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const pill = document.createElement('span'); pill.className = 'pill warn'; pill.textContent = label;
            const text = document.createElement('small'); text.style.marginLeft = '6px'; text.style.color = 'var(--muted)'; text.textContent = rule;
            left.append(pill, text);
            box.append(row);
            row.append(left);
          }
        } catch { box.replaceChildren(); }
      }
      $('constitution-add')?.addEventListener('click', async () => {
        const rule = $('constitution-rule')?.value.trim();
        const secret = $('constitution-secret')?.value.trim();
        if (!rule && !secret) { showNotice('填写规则或秘密'); return; }
        try {
          const current = await (await fetch('/api/constitution')).json();
          const constitution = current.constitution || { worldRules: [], abilityCosts: [], forbiddenInfo: [], secretReveals: [], characterBoundaries: [] };
          const body = { ...constitution };
          if (rule) {
            if (rule.includes('禁') || rule.includes('不得')) body.forbiddenInfo = [...body.forbiddenInfo, rule];
            else if (rule.includes('代价') || rule.includes('消耗')) body.abilityCosts = [...body.abilityCosts, rule];
            else body.worldRules = [...body.worldRules, rule];
          }
          if (secret && secret.includes('|')) {
            const [secretText, revealAt] = secret.split('|');
            body.secretReveals = [...body.secretReveals, { secret: secretText.trim(), revealAt: (revealAt || '未定').trim() }];
          }
          await post('/api/constitution', body);
          if ($('constitution-rule')) $('constitution-rule').value = '';
          if ($('constitution-secret')) $('constitution-secret').value = '';
          showNotice('宪法规则已保存，将自动注入每轮生成。', 'success');
          await loadConstitution();
        } catch (err) { showNotice(err.message || '保存失败'); }
      });
      $('platform-btn')?.addEventListener('click', async () => {
        const panel = $('platform-panel');
        const box = $('platform-rows');
        if (!panel || !box) return;
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        await renderPlatformReview(box);
      });
      document.querySelectorAll('input[name="platform-type"]').forEach((input) => input.addEventListener('change', async () => {
        const box = $('platform-rows');
        if (box && $('platform-panel') && !$('platform-panel').hidden) await renderPlatformReview(box);
      }));
      async function renderPlatformReview(box) {
        const platform = document.querySelector('input[name="platform-type"]:checked')?.value || 'fanqie';
        try {
          const res = await (await fetch('/api/platform-review?platform=' + platform)).json();
          box.replaceChildren();
          if (!res.configured || !res.report) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置工作区。'; box.append(empty); return; }
          const report = res.report;
          const dimLabel = { openingHook: '开篇钩子', mainline: '主线清晰', thrill: '爽点密度', pacing: '节奏紧凑', endingSuspense: '结尾悬念' };
          const head = document.createElement('div'); head.className = 'rowline';
          const overall = document.createElement('span'); overall.replaceChildren();
          overall.textContent = '综合签约分 ' + report.overall + '（' + report.verdict + '）';
          overall.style.fontWeight = '700';
          head.append(overall);
          box.append(head);
          for (const [key, value] of Object.entries(report.dimensions)) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = dimLabel[key] || key;
            const right = document.createElement('div'); right.className = 'pills';
            const scorePill = document.createElement('span'); scorePill.className = 'pill ' + (value >= 70 ? 'ok' : value >= 40 ? 'muted' : 'bad'); scorePill.textContent = String(value);
            const weight = document.createElement('small'); weight.style.color = 'var(--faint)'; weight.textContent = '权重 ' + Math.round(report.weights[key] * 100) + '%';
            right.append(scorePill, weight);
            line.append(left, right);
            box.append(line);
          }
          for (const finding of report.findings) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('span'); left.textContent = '⚠ ' + finding.check + '：' + finding.evidence;
            line.append(left);
            box.append(line);
          }
          if (report.missing.length) {
            const line = document.createElement('div'); line.className = 'rowline';
            const left = document.createElement('small'); left.style.color = 'var(--faint)'; left.textContent = '缺失维度：' + report.missing.join('、');
            line.append(left);
            box.append(line);
          }
        } catch { box.replaceChildren(); }
      }
      async function scanFingerprint(chapter) {
        try {
          const res = await (await fetch('/api/ai-fingerprint?chapter=' + chapter)).json();
          if (!res.configured || !res.fingerprint) { showNotice(res.error || '扫描失败'); return; }
          const f = res.fingerprint;
          showNotice('第 ' + chapter + ' 章 AI 痕迹风险 ' + f.riskScore + '/100（排比 ' + f.signals.parallelism + ' · 工整 ' + f.signals.uniformity + ' · 模板 ' + f.signals.templated + ' · 陈词 ' + f.signals.summaryCliche + '）。' + res.advice, f.riskScore >= 60 ? 'warn' : 'success');
        } catch (err) { showNotice(err.message || '扫描失败'); }
      }
      $('fingerprint-btn')?.addEventListener('click', () => { if (currentChapter) void scanFingerprint(currentChapter); });
      async function loadBookshelf() {
        const box = $('bookshelf-rows');
        if (!box) return;
        try {
          const res = await (await fetch('/api/books')).json();
          if (!res.configured) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; box.append(empty); $('bookshelf-count').textContent = '0 本'; return; }
          $('bookshelf-count').textContent = res.books.length + ' 本';
          box.replaceChildren();
          if (!res.books.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '书架为空。'; box.append(empty); return; }
          for (const book of res.books) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const name = document.createElement('span'); name.style.fontWeight = '600'; name.textContent = book.title + (book.active ? ' ·当前' : '');
            const meta = document.createElement('small'); meta.style.color = 'var(--faint)'; meta.style.display = 'block'; meta.textContent = book.chapters + ' 章 · ' + formatNumber(book.words) + ' 字';
            left.append(name, meta);
            const right = document.createElement('button'); right.type = 'button'; right.className = 'btn btn-text'; right.style.minHeight = '30px'; right.style.fontSize = '12px'; right.textContent = book.active ? '编辑中' : '切换'; right.disabled = Boolean(book.active);
            right.addEventListener('click', async () => {
              try { await post('/api/books/switch', { id: book.id }); showNotice('已切换到《' + book.title + '》，刷新页面。', 'success'); setTimeout(() => location.reload(), 600); } catch (err) { showNotice(err.message || '切换失败'); }
            });
            row.append(left, right);
            box.append(row);
          }
        } catch { /* 保持现有内容 */ }
      }
      $('book-create')?.addEventListener('click', async () => {
        const title = $('new-book-title')?.value.trim();
        if (!title) { showNotice('请填写新书名'); return; }
        try {
          await post('/api/books', { title });
          if ($('new-book-title')) $('new-book-title').value = '';
          showNotice('新书已创建，可在书架中切换。', 'success');
          await loadBookshelf();
        } catch (err) { showNotice(err.message || '创建失败'); }
      });
      async function loadSkillPacks() {
        const box = $('skillpack-rows');
        if (!box) return;
        try {
          const res = await (await fetch('/api/skillpacks')).json();
          if (!res.configured) { box.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; box.append(empty); return; }
          $('skillpack-count').textContent = res.enabledCount + ' 启用';
          box.replaceChildren();
          const packs = [...(res.builtin || []), ...(res.custom || [])];
          for (const pack of packs) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const name = document.createElement('span'); name.style.fontWeight = '600'; name.textContent = pack.name;
            const pill = document.createElement('span'); pill.className = 'pill ' + (pack.enabled ? 'ok' : 'muted'); pill.style.marginLeft = '6px'; pill.textContent = pack.enabled ? '启用' : '停用';
            const desc = document.createElement('small'); desc.style.color = 'var(--faint)'; desc.style.display = 'block'; desc.textContent = pack.category + ' · ' + pack.techniqueCount + ' 条 · ' + (pack.description || pack.preview);
            left.append(name, pill, desc);
            const right = document.createElement('div'); right.style.display = 'flex'; right.style.gap = '6px';
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = pack.enabled ? 'btn btn-text' : 'btn btn-tonal'; toggle.style.minHeight = '30px'; toggle.style.fontSize = '12px'; toggle.textContent = pack.enabled ? '停用' : '启用';
            toggle.addEventListener('click', async () => {
              try { await post('/api/skillpacks/toggle', { id: pack.id, enabled: !pack.enabled }); await loadSkillPacks(); } catch (err) { showNotice(err.message || '操作失败'); }
            });
            right.append(toggle);
            if (String(pack.id).startsWith('custom-')) {
              const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-text'; del.style.minHeight = '30px'; del.style.fontSize = '12px'; del.textContent = '删除';
              del.addEventListener('click', async () => {
                try { const response = await fetch('/api/skillpacks/' + encodeURIComponent(pack.id), { method: 'DELETE' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '删除失败'); await loadSkillPacks(); showNotice('自定义包已删除。', 'success'); } catch (err) { showNotice(err.message || '删除失败'); }
              });
              right.append(del);
            }
            row.append(left, right);
            box.append(row);
          }
        } catch { /* 保持现有内容 */ }
      }
      $('skillpack-create')?.addEventListener('click', async () => {
        const name = $('skillpack-name')?.value.trim();
        const techniques = ($('skillpack-techniques')?.value || '').split('\n').map((line) => line.trim()).filter(Boolean);
        if (!name) { showNotice('请填写技能包名称'); return; }
        if (!techniques.length) { showNotice('至少填写一条写作技法（每行一条）'); return; }
        try {
          await post('/api/skillpacks', { name, techniques });
          if ($('skillpack-name')) $('skillpack-name').value = '';
          if ($('skillpack-techniques')) $('skillpack-techniques').value = '';
          showNotice('自定义技能包已创建。', 'success');
          await loadSkillPacks();
        } catch (err) { showNotice(err.message || '创建失败'); }
      });
      $('versions-btn')?.addEventListener('click', async () => {
        const panel = $('versions-panel');
        if (!panel) return;
        panel.hidden = !panel.hidden;
        if (!panel.hidden && currentChapter) await renderVersions(currentChapter, $('versions-rows'), $('versions-meta'));
      });
      async function renderVersions(chapter, rowsEl, metaEl) {
        if (!rowsEl) return;
        try {
          const res = await (await fetch('/api/chapters/' + chapter + '/versions')).json();
          if (!res.configured) { rowsEl.replaceChildren(); return; }
          if (metaEl) metaEl.textContent = res.versions.length + ' 份快照';
          rowsEl.replaceChildren();
          if (!res.versions.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '本章暂无历史版本，编辑保存后会自动归档。'; rowsEl.append(empty); return; }
          for (const version of res.versions) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const head = document.createElement('span'); head.style.fontWeight = '600'; head.textContent = '#' + version.id + ' ' + version.sourceLabel;
            const delta = document.createElement('span'); delta.className = 'pill ' + (version.delta === 0 ? 'muted' : version.delta > 0 ? 'ok' : 'bad'); delta.style.marginLeft = '6px'; delta.textContent = (version.delta > 0 ? '+' : '') + version.delta + ' 字';
            const metaLine = document.createElement('small'); metaLine.style.color = 'var(--faint)'; metaLine.style.display = 'block'; metaLine.textContent = new Date(version.ts).toLocaleString('zh-CN') + ' · ' + formatNumber(version.words) + ' 字 · ' + (version.preview || '');
            left.append(head, delta, metaLine);
            const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'btn btn-text'; restore.style.minHeight = '30px'; restore.style.fontSize = '12px'; restore.textContent = '恢复';
            restore.addEventListener('click', async () => {
              try {
                await post('/api/chapters/' + chapter + '/versions/restore', { id: version.id });
                showNotice('已恢复版本 #' + version.id + '，恢复前内容已自动备份。', 'success');
                await renderVersions(chapter, rowsEl, metaEl);
                if (currentChapter === chapter && !$('versions-panel').hidden) void loadChapter(chapter);
                if (studioChapter === chapter) void loadStudioChapter(chapter);
              } catch (err) { showNotice(err.message || '恢复失败'); }
            });
            row.append(left, restore);
            rowsEl.append(row);
          }
        } catch { rowsEl.replaceChildren(); }
      }
      let studioChapter = 0;
      async function loadStudio() {
        try {
          const data = await (await fetch('/api/book')).json();
          const list = $('studio-list');
          if (!data.configured || !data.book) { list.replaceChildren(); const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未配置模型，先连接引擎。'; list.append(empty); return; }
          const book = data.book;
          $('studio-book-name').textContent = book.novelName || '未命名作品';
          const rows = flatten(book);
          $('studio-progress').textContent = book.completedChapters.length + '/' + (book.totalChapters || rows.length) + ' 章';
          list.replaceChildren();
          if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未开始创作，先在概览页提交 brief。'; list.append(empty); return; }
          for (const chapter of rows) {
            const row = document.createElement('button'); row.type = 'button'; row.dataset.chapter = String(chapter.chapter); row.className = 'srow';
            const dot = document.createElement('i'); dot.className = 'dot s-' + chapter.status; dot.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span'); label.textContent = chapter.chapter + '. ' + chapter.title;
            const words = document.createElement('small'); words.textContent = chapter.wordCount ? formatNumber(chapter.wordCount) + '字' : '';
            row.append(dot, label, words);
            row.addEventListener('click', () => selectStudioChapter(chapter.chapter));
            list.append(row);
          }
          const target = studioChapter || (pickTargetChapter(rows) || {}).chapter;
          if (target) selectStudioChapter(target);
        } catch { /* 保持现有内容 */ }
      }
      function selectStudioChapter(chapter) {
        studioChapter = chapter;
        document.querySelectorAll('#studio-list button').forEach((row) => { row.classList.toggle('active', Number(row.dataset.chapter) === chapter); });
        void loadStudioChapter(chapter);
      }
      async function loadStudioChapter(chapter) {
        const editor = $('studio-editor');
        if (!editor) return;
        try {
          const res = await fetchChapter(chapter);
          if (!res.configured || !res.chapter) { editor.value = ''; editor.disabled = true; if ($('studio-save')) $('studio-save').disabled = true; return; }
          const view = res.chapter;
          $('studio-ch-title').textContent = view.title;
          const statusChip = $('studio-ch-status');
          if (statusChip) { statusChip.hidden = false; statusChip.textContent = chapterLabels[view.status] || view.status; }
          editor.value = view.text || '';
          editor.disabled = !view.text;
          if ($('studio-save')) $('studio-save').disabled = !view.text;
          if ($('studio-fingerprint')) $('studio-fingerprint').disabled = !view.text;
          updateStudioWords();
          await renderVersions(chapter, $('studio-versions-rows'), $('studio-versions-meta'));
        } catch (err) { showNotice(err.message || '加载章节失败'); }
      }
      function updateStudioWords() {
        const editor = $('studio-editor');
        if (!editor) return;
        const count = [...editor.value.replace(/\s/g, '')].length;
        if ($('studio-words')) $('studio-words').textContent = formatNumber(count) + ' 字';
      }
      $('studio-editor')?.addEventListener('input', updateStudioWords);
      $('studio-save')?.addEventListener('click', async () => {
        const editor = $('studio-editor');
        if (!editor || !studioChapter || !editor.value.trim()) return;
        try {
          await post('/api/chapters/' + studioChapter + '/text', { text: editor.value });
          showNotice('第 ' + studioChapter + ' 章已保存并归档版本。', 'success');
          await renderVersions(studioChapter, $('studio-versions-rows'), $('studio-versions-meta'));
        } catch (err) { showNotice(err.message || '保存失败'); }
      });
      $('studio-recall-run')?.addEventListener('click', async () => {
        const query = $('studio-recall-query')?.value.trim();
        const box = $('studio-recall-rows');
        if (!box) return;
        if (!query) { showNotice('输入检索关键词'); return; }
        try {
          const res = await fetchRecall(query);
          box.replaceChildren();
          if (!res.hits || !res.hits.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有命中的设定。'; box.append(empty); return; }
          for (const hit of res.hits.slice(0, 6)) {
            const row = document.createElement('div'); row.className = 'rowline';
            const left = document.createElement('div');
            const kind = document.createElement('span'); kind.className = 'pill muted'; kind.textContent = hit.kind;
            const text = document.createElement('small'); text.style.display = 'block'; text.style.color = 'var(--muted)'; text.textContent = hit.source + ' · ' + (hit.snippet || '').slice(0, 60);
            left.append(kind, text);
            row.append(left);
            box.append(row);
          }
        } catch { box.replaceChildren(); }
      });
      $('studio-fingerprint')?.addEventListener('click', () => { if (studioChapter) void scanFingerprint(studioChapter); });
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
          const navEntities = $('nav-count-entities');
          if (navEntities) { navEntities.textContent = items.length + '实体'; navEntities.hidden = items.length === 0; }
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
            const right = document.createElement('div'); right.style.display = 'flex'; right.style.gap = '6px'; right.style.alignItems = 'center';
            const badge = document.createElement('span'); badge.className = 'pill muted'; badge.textContent = ent.type;
            right.append(badge);
            if (ent.type === 'character') {
              const chatBtn = document.createElement('button'); chatBtn.className = 'btn btn-text'; chatBtn.style.minHeight = '26px'; chatBtn.style.fontSize = '11px'; chatBtn.textContent = '对话';
              chatBtn.addEventListener('click', () => openEntityChat(ent));
              right.append(chatBtn);
            }
            top.append(name, right);
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
      loadCostPreview();
      loadMaterials();
      loadConstitution();
      loadBookshelf();
      loadSkillPacks();
      loadBookSummary();
    </script>
  </body>
</html>`;
}
