export function renderReadApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>阅读 · SynChronicle</title>
    <script>(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'||t==='light'){d.classList.add(t);}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){d.classList.add('dark');}}catch(e){}})();</script>
    <style>
      :root {
        color-scheme: light;
        --heat-100: #fa5d19; --heat-90: rgba(250, 93, 25, .9); --heat-40: rgba(250, 93, 25, .4);
        --heat-20: rgba(250, 93, 25, .2); --heat-12: rgba(250, 93, 25, .12); --heat-8: rgba(250, 93, 25, .06);
        --ink: #262626; --paper: #ffffff; --bg: #f9f9f9;
        --muted: rgba(38, 38, 38, .58); --faint: rgba(38, 38, 38, .4);
        --line: #e8e8e8; --line-faint: #ededed;
        --alpha-4: rgba(38, 38, 38, .04); --alpha-6: rgba(38, 38, 38, .06);
        --success: #1f9d52; --success-dot: #42c366; --error: #dc2626;
        --btn-radius: 8px; --radius: 14px; --radius-lg: 18px;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, .03); --shadow-lg: 0 6px 14px -10px rgba(0, 0, 0, .14);
        --dur-fast: .15s; --ease: ease;
        --font: "Inter", "Google Sans Text", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      :root.dark {
        color-scheme: dark;
        --ink: #f5f5f5; --paper: #171717; --bg: #0a0a0a;
        --muted: rgba(255, 255, 255, .58); --faint: rgba(255, 255, 255, .4);
        --line: #333; --line-faint: #2a2a2a;
        --alpha-4: rgba(255, 255, 255, .05); --alpha-6: rgba(255, 255, 255, .08);
        --heat-8: rgba(250, 93, 25, .1);
      }
      * { box-sizing: border-box; }
      ::selection { background: var(--heat-12); color: var(--ink); }
      body { margin: 0; min-width: 320px; color: var(--ink); background: var(--bg); font: 400 14px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
      button { font: inherit; color: inherit; cursor: pointer; }
      a { color: currentColor; text-decoration: none; }
      h1, h2, h3 { letter-spacing: -.02em; font-weight: 700; line-height: 1.15; margin: 0; }
      button:focus-visible, a:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--heat-100); }
      .read-nav { position: sticky; top: 8px; z-index: 100; max-width: 920px; margin: 8px auto 0; border: 1px solid var(--line); border-radius: 18px; background: color-mix(in srgb, var(--paper) 82%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: var(--shadow-lg); }
      .read-nav-inner { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 18px; flex-wrap: wrap; }
      .brand { display: inline-flex; align-items: baseline; gap: 1px; color: var(--ink); font-weight: 800; font-size: 16px; letter-spacing: -.03em; }
      .brand em { color: var(--heat-100); font-style: normal; }
      .rb-meta { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
      .theme-switcher { display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: var(--alpha-4); }
      .theme-btn { min-height: 24px; padding: 2px 8px; border: 0; border-radius: var(--btn-radius); background: transparent; color: var(--muted); font-size: 11px; font-weight: 500; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
      .theme-btn:hover, .theme-btn.active { color: var(--ink); background: var(--paper); box-shadow: var(--shadow-sm); }
      .read-wrap { max-width: 760px; margin: 0 auto; padding: 44px 20px 80px; }
      .hero { text-align: center; padding: 26px 0 40px; }
      .announce { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 20px; padding: 5px 14px 5px 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font-size: 12.5px; box-shadow: var(--shadow-sm); }
      .announce b { padding: 2px 9px; border-radius: 999px; background: var(--heat-12); color: var(--heat-100); font-size: 11px; font-weight: 600; }
      .announce span { color: var(--muted); }
      .hero h1 { font-size: clamp(32px, 6vw, 48px); }
      .hero .meta { margin: 14px auto 0; max-width: 520px; color: var(--muted); font-size: 14.5px; }
      .hero-actions { display: flex; justify-content: center; gap: 10px; margin-top: 26px; flex-wrap: wrap; }
      .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 9px 20px; border: 0; border-radius: var(--btn-radius); font-size: 13.5px; font-weight: 500; transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease); }
      .btn:active { transform: scale(.995); }
      .btn-filled { background: var(--heat-100); color: #fffbf5; }
      .btn-filled:hover { background: var(--heat-90); }
      .btn-tonal { background: var(--alpha-4); color: var(--ink); }
      .btn-tonal:hover { background: var(--alpha-6); }
      .btn:disabled { pointer-events: none; background: var(--alpha-4); color: var(--faint); }
      .card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); padding: 18px 6px; box-shadow: var(--shadow-sm); }
      .toc-card summary { cursor: pointer; list-style: none; }
      .toc-card summary::-webkit-details-marker { display: none; }
      .toc-card .chev { flex: none; width: 14px; height: 14px; color: var(--faint); transition: transform var(--dur-fast) var(--ease); }
      .toc-card[open] .chev { transform: rotate(180deg); }
      .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 16px 8px; }
      .panel-head h3 { font-size: 16px; }
      .panel-head span { color: var(--faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
      .rrow { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; border: 0; border-radius: var(--radius); background: transparent; text-align: left; transition: background var(--dur-fast) var(--ease); }
      .rrow:hover { background: var(--alpha-4); }
      .rrow .num { width: 30px; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; flex: none; }
      .rrow .ttl { color: var(--ink); font-size: 14px; font-weight: 500; }
      .rrow.disabled .ttl { color: var(--faint); font-weight: 400; }
      .rrow small { margin-left: auto; color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
      .rrow .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success-dot); flex: none; }
      .rrow.disabled .dot { background: var(--line); }
      .rrow.rewrite .dot { background: var(--error); }
      .empty { padding: 18px 16px; color: var(--muted); font-size: 13px; }
      #r-article { padding: clamp(22px, 4vw, 40px); margin-top: 20px; }
      .chapter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
      .chapter-head h2 { font-size: 22px; }
      .meta { color: var(--muted); font-size: 12.5px; }
      .chapter-text { max-width: 72ch; font-size: clamp(15px, 2.5vw, 17px); line-height: 1.9; }
      .chapter-text p { margin: 0 0 1.1em; }
      .pager { display: flex; justify-content: space-between; gap: 10px; margin-top: 30px; padding-top: 18px; border-top: 1px solid var(--line-faint); }
      .read-foot { padding: 26px 16px 34px; text-align: center; color: var(--faint); font-size: 11.5px; }
      @media (max-width: 767px) {
        .read-nav { top: 0; margin: 0 10px; }
        .read-nav-inner { padding: 8px 12px; gap: 8px; }
        .rb-meta { display: none; }
        .theme-btn { min-height: 44px; padding: 4px 10px; }
        .read-wrap { padding: clamp(24px, 5vw, 44px) 16px 96px; }
        .rrow { min-height: 44px; }
        .pager { flex-direction: column; }
        .pager .btn { width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; } }
    </style>
  </head>
  <body>
    <header class="read-nav">
      <div class="read-nav-inner">
        <a class="brand" href="/" aria-label="返回控制台">S<em>—</em></a>
        <span class="rb-meta" id="rb-progress">阅读前台</span>
        <div class="theme-switcher" role="group" aria-label="主题选择">
          <button type="button" class="theme-btn" data-theme="light" aria-pressed="false">Light</button>
          <button type="button" class="theme-btn" data-theme="dark" aria-pressed="false">Dark</button>
          <button type="button" class="theme-btn" data-theme="system" aria-pressed="true">System</button>
        </div>
      </div>
    </header>
    <main class="read-wrap">
      <section class="hero">
        <div class="announce"><b>连载中</b><span id="r-phase">尚未开始创作</span></div>
        <h1 id="r-title">你的故事</h1>
        <p class="meta" id="r-meta">完成章节后，这里会成为你的阅读前台。回到控制台提交第一个 brief，让 Architect、Writer 与 Editor 开始工作。</p>
        <div class="hero-actions"><button id="r-start" class="btn btn-filled" type="button" disabled>开始阅读</button><a class="btn btn-tonal" href="/">返回控制台</a></div>
      </section>
      <details class="card toc-card" id="r-toc" open aria-label="章节目录">
        <summary class="panel-head"><h3>章节目录</h3><span id="r-count">0 章</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
        <div id="r-list" role="list"><div class="empty">暂无可读章节。</div></div>
      </details>
      <article class="card" id="r-article" hidden aria-label="章节正文">
        <header class="chapter-head"><h2 id="rc-title"></h2><span class="meta" id="rc-meta"></span></header>
        <div id="rc-text" class="chapter-text"></div>
        <div class="pager"><button id="rc-prev" class="btn btn-tonal" type="button">上一章</button><button id="rc-next" class="btn btn-tonal" type="button">下一章</button></div>
      </article>
    </main>
    <footer class="read-foot">SynChronicle · 本地阅读前台 · 作品保存在本机</footer>
    <script>
      const $ = (id) => document.getElementById(id);
      const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(value || 0);
      const phaseLabels = { init: '准备中', premise: '设定构思', outline: '大纲规划', writing: '正文创作', complete: '已完结' };
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
      if (matchMedia('(max-width: 767px)').matches) $('r-toc').removeAttribute('open');
      let chapters = [];
      let current = 0;
      function flatten(book) { const rows = []; for (const volume of book.volumes) for (const arc of volume.arcs) for (const chapter of arc.chapters) rows.push(chapter); return rows; }
      function renderList(rows) {
        const list = $('r-list');
        list.replaceChildren();
        if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无可读章节。'; list.append(empty); return; }
        for (const chapter of rows) {
          const row = document.createElement(chapter.status === 'pending' ? 'div' : 'button');
          row.className = 'rrow' + (chapter.status === 'pending' ? ' disabled' : '') + (chapter.status === 'rewrite' ? ' rewrite' : '');
          row.setAttribute('role', 'listitem');
          if (chapter.status !== 'pending') { row.type = 'button'; row.addEventListener('click', () => selectChapter(chapter.chapter)); }
          const num = document.createElement('span'); num.className = 'num'; num.textContent = String(chapter.chapter).padStart(2, '0');
          const dot = document.createElement('i'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
          const ttl = document.createElement('span'); ttl.className = 'ttl'; ttl.textContent = chapter.title;
          const wc = document.createElement('small'); wc.textContent = chapter.wordCount ? formatNumber(chapter.wordCount) + ' 字' : '';
          row.append(num, dot, ttl, wc);
          list.append(row);
        }
      }
      async function loadBook() {
        try {
          const data = await (await fetch('/api/book')).json();
          if (!data.configured || !data.book) return;
          const book = data.book;
          const rows = flatten(book);
          chapters = rows.map((row) => row.chapter);
          if (book.novelName) $('r-title').textContent = book.novelName;
          $('r-phase').textContent = (phaseLabels[book.phase] || book.phase) + ' · ' + book.completedChapters.length + '/' + (book.totalChapters || rows.length) + ' 章';
          $('r-meta').textContent = '全书 ' + formatNumber(book.totalWordCount) + ' 字 · ' + rows.length + ' 个章节条目';
          $('rb-progress').textContent = book.completedChapters.length + '/' + (book.totalChapters || rows.length) + ' 章';
          $('r-count').textContent = rows.length + ' 章';
          renderList(rows);
          const first = rows.find((row) => row.status === 'completed');
          if (first) { $('r-start').disabled = false; $('r-start').dataset.chapter = String(first.chapter); }
        } catch { /* 未连接时保持空态 */ }
      }
      async function selectChapter(chapter) {
        try {
          const data = await (await fetch('/api/chapters/' + chapter)).json();
          if (!data.configured || !data.chapter) return;
          const view = data.chapter;
          current = chapter;
          $('r-article').hidden = false;
          $('rc-title').textContent = view.title || ('第 ' + chapter + ' 章');
          $('rc-meta').textContent = formatNumber(view.wordCount) + ' 字' + (view.aitone && view.aitone.score < 100 ? ' · AI 味 ' + view.aitone.score : '');
          const text = $('rc-text');
          text.replaceChildren();
          if (view.text) { for (const block of view.text.split(/\\n{2,}/)) { const p = document.createElement('p'); p.textContent = block; text.append(p); } }
          else { const empty = document.createElement('p'); empty.style.color = 'var(--muted)'; empty.textContent = '这一章还未完成。'; text.append(empty); }
          const index = chapters.indexOf(chapter);
          $('rc-prev').disabled = index <= 0;
          $('rc-next').disabled = index === -1 || index >= chapters.length - 1;
          $('r-article').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        } catch { /* 网络错误保持当前内容 */ }
      }
      $('r-start').addEventListener('click', () => { const target = Number($('r-start').dataset.chapter || 0); if (target) selectChapter(target); });
      $('rc-prev').addEventListener('click', () => { const index = chapters.indexOf(current); if (index > 0) selectChapter(chapters[index - 1]); });
      $('rc-next').addEventListener('click', () => { const index = chapters.indexOf(current); if (index >= 0 && index < chapters.length - 1) selectChapter(chapters[index + 1]); });
      loadBook();
    </script>
  </body>
</html>`;
}
