/* =====================================================
   AI HỌC TẬP – widget chat nổi (dùng chung index + giaovien)
   - Render Markdown + công thức toán (KaTeX) AN TOÀN: mọi nội dung đều
     được escape HTML trước, nên gõ < > & hay "x < 5" không làm vỡ giao diện.
   - Ký tự toán ($..$, \(..\), \[..\], $$..$$) được bảo vệ khỏi Markdown
     (dấu _ * ^ \ trong công thức không bị biến thành in nghiêng/đậm).
   ===================================================== */
(function () {
  'use strict';
  if (window.__aiChatLoaded) return;
  window.__aiChatLoaded = true;

  /* ---------- Tiện ích ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const PH = (i) => '\uE000' + i + '\uE001';           // ký tự private-use làm chỗ giữ
  const PH_RE = /\uE000(\d+)\uE001/g;

  /* ---------- Chuẩn hoá ký tự Unicode toán học thường gặp ---------- */
  function normalizeLatexDelims(t) {
    // \[ ... \]  ->  $$ ... $$   |   \( ... \)  ->  $ ... $
    return t
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => '$$' + m + '$$')
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => '$' + m + '$');
  }

  /* ---------- Markdown + Math -> HTML ---------- */
  function renderRich(src) {
    const stash = [];
    const keep = (html) => { stash.push(html); return PH(stash.length - 1); };
    let t = String(src == null ? '' : src).replace(/\r\n?/g, '\n');

    // 1) Khối code ``` ```
    t = t.replace(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g, (_, lang, code) =>
      keep('<pre><div class="ai-codehead"><span>' + esc(lang || 'code') +
        '</span><button class="ai-copy" data-copycode type="button"><i class="bx bx-copy"></i> Chép</button></div><code>' +
        esc(code.replace(/\n$/, '')) + '</code></pre>'));
    // code dở dang (chưa đóng ```)
    t = t.replace(/```([\w+-]*)[^\n]*\n([\s\S]*)$/, (_, lang, code) =>
      keep('<pre><code>' + esc(code) + '</code></pre>'));

    // 2) Code inline
    t = t.replace(/`([^`\n]+?)`/g, (_, c) => keep('<code>' + esc(c) + '</code>'));

    // 3) Công thức toán – bảo vệ trước khi xử lý Markdown
    t = normalizeLatexDelims(t);
    const mathSpan = (tex, display) =>
      keep('<span class="ai-math' + (display ? ' ai-math-block' : '') + '" data-display="' + (display ? 1 : 0) +
        '" data-tex="' + esc(tex.trim()) + '"><span class="ai-math-pending">' + esc((display ? '$$' : '$') + tex.trim() + (display ? '$$' : '$')) + '</span></span>');
    t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => '\n\n' + mathSpan(m, true) + '\n\n');
    // inline $...$: không bắt nhầm tiền ("$5 và $6"): ký tự sau $ mở không phải khoảng trắng,
    // trước $ đóng không phải khoảng trắng, và sau $ đóng không phải chữ số.
    t = t.replace(/(^|[^\\$\w])\$(?!\s)((?:\\.|[^$\n\\])+?)(?<!\s)\$(?!\d)/g, (m, pre, tex) => pre + mathSpan(tex, false));

    // 4) Escape HTML phần còn lại
    t = esc(t);

    // 5) Inline markdown
    const inline = (s) => s
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

    // 6) Block markdown
    const lines = t.split('\n');
    const out = [];
    let i = 0, para = [];
    const flush = () => {
      if (!para.length) return;
      const joined = para.join('<br>');
      const only = joined.match(/^\uE000(\d+)\uE001$/);
      // khối <pre> và công thức dạng khối đứng riêng thì không bọc <p>
      if (only && /^<pre|ai-math-block/.test(stash[+only[1]] || '')) out.push(joined);
      else out.push('<p>' + inline(joined) + '</p>');
      para = [];
    };
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l || '');
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { flush(); i++; continue; }

      let m;
      if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { flush(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^&gt;\s?/.test(l)) {
        flush(); const q = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^&gt;\s?/, '')); i++; }
        out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>'); continue;
      }
      if (l.includes('|') && isTableSep(lines[i + 1])) {
        flush(); const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
        out.push('<div class="ai-tablewrap"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*+])\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
        flush(); const ordered = /^\s*\d+[.)]\s+/.test(l); const items = [];
        const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
        while (i < lines.length && re.test(lines[i])) { items.push(lines[i].match(re)[1]); i++; }
        const tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + tag + '>'); continue;
      }
      para.push(l); i++;
    }
    flush();

    let html = out.join('');
    // 7) Khôi phục (có thể lồng nhau nên lặp vài lần)
    for (let k = 0; k < 3 && PH_RE.test(html); k++) html = html.replace(PH_RE, (_, n) => stash[+n] || '');
    PH_RE.lastIndex = 0;
    return html;
  }

  /* ---------- Render KaTeX (chờ thư viện tải xong vì dùng defer) ---------- */
  function hydrateMath(root, tries) {
    tries = tries || 0;
    const nodes = root.querySelectorAll('.ai-math:not([data-done])');
    if (!nodes.length) return;
    if (!window.katex) {
      if (tries < 40) setTimeout(() => hydrateMath(root, tries + 1), 250);
      return;
    }
    nodes.forEach((n) => {
      try {
        n.innerHTML = window.katex.renderToString(n.getAttribute('data-tex'), {
          displayMode: n.getAttribute('data-display') === '1',
          throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml'
        });
        n.setAttribute('data-done', '1');
      } catch (e) {
        n.innerHTML = '<span class="ai-math-error">' + esc(n.getAttribute('data-tex')) + '</span>';
        n.setAttribute('data-done', '1');
      }
    });
  }

  /* ---------- Dựng widget ---------- */
  const GREETING = 'Chào bạn! 👋 Mình là **AI Học Tập**. Mình có thể giải bài tập, giải thích kiến thức, tóm tắt bài giảng và viết công thức toán như $x^2 + y^2 = z^2$.\n\nBạn muốn hỏi gì hôm nay?';
  const CHIPS = [
    ['📐 Giải phương trình', 'Giải phương trình $x^2 - 5x + 6 = 0$ từng bước'],
    ['📘 Giải thích', 'Giải thích đạo hàm là gì, cho ví dụ dễ hiểu'],
    ['📝 Tóm tắt', 'Cách ôn thi hiệu quả trong 1 tuần?'],
  ];

  const root = document.createElement('div');
  root.id = 'ai-widget';
  root.innerHTML =
    '<button id="ai-fab" type="button" aria-label="Mở AI Học Tập"><i class="bx bx-bot"></i></button>' +
    '<section id="ai-box" role="dialog" aria-label="AI Học Tập">' +
      '<header id="ai-head">' +
        '<div class="ai-avatar"><i class="bx bx-bot"></i></div>' +
        '<div class="ai-title"><b>AI Học Tập</b><small><span class="ai-dot"></span><span id="ai-status">Sẵn sàng hỗ trợ</span></small></div>' +
        '<button class="ai-hbtn" id="ai-clear" type="button" title="Cuộc trò chuyện mới"><i class="bx bx-refresh"></i></button>' +
        '<button class="ai-hbtn" id="ai-expand" type="button" title="Phóng to / thu nhỏ"><i class="bx bx-expand-alt"></i></button>' +
        '<button class="ai-hbtn" id="ai-close" type="button" title="Đóng"><i class="bx bx-x"></i></button>' +
      '</header>' +
      '<div id="ai-messages" aria-live="polite"></div>' +
      '<div id="ai-chips"></div>' +
      '<footer id="ai-foot">' +
        '<div id="ai-form">' +
          '<textarea id="ai-input" rows="1" placeholder="Nhập câu hỏi, bài tập… (Shift+Enter để xuống dòng)" maxlength="4000"></textarea>' +
          '<button id="ai-send" type="button" aria-label="Gửi"><i class="bx bx-send"></i></button>' +
        '</div>' +
        '<div id="ai-hint">Hỗ trợ công thức: $x^2$, $$\\frac{a}{b}$$ · AI có thể sai, hãy kiểm tra lại</div>' +
      '</footer>' +
    '</section>';

  function mount() {
    document.body.appendChild(root);
    init();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function init() {
    const $ = (id) => root.querySelector('#' + id);
    const box = $('ai-box'), msgs = $('ai-messages'), input = $('ai-input'), send = $('ai-send'),
      chips = $('ai-chips'), status = $('ai-status');
    const history = [];       // {role:'user'|'bot', text}
    let busy = false, typingRow = null;

    const scrollDown = (smooth) => msgs.scrollTo({ top: msgs.scrollHeight, behavior: smooth === false ? 'auto' : 'smooth' });
    const timeStr = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    function addMessage(text, who, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'ai-row ' + (who === 'user' ? 'user' : 'bot') + (opts.error ? ' error' : '');
      const bubble = document.createElement('div');
      bubble.className = 'ai-bubble' + (who === 'user' ? '' : ' ai-md');
      if (who === 'user') {
        bubble.innerHTML = renderRich(text);              // user cũng hiển thị được công thức, đã escape
        bubble.classList.add('ai-md');
      } else {
        bubble.innerHTML = renderRich(text);
      }
      const wrap = document.createElement('div');
      wrap.className = 'ai-bubble-wrap';
      wrap.appendChild(bubble);
      const meta = document.createElement('div');
      meta.className = 'ai-meta';
      meta.innerHTML = '<span>' + timeStr() + '</span>' +
        '<button class="ai-copy" data-copymsg type="button"><i class="bx bx-copy"></i> Sao chép</button>';
      meta.querySelector('[data-copymsg]').__raw = text;
      wrap.appendChild(meta);
      if (who !== 'user') {
        const mini = document.createElement('div');
        mini.className = 'ai-mini'; mini.innerHTML = '<i class="bx bx-bot"></i>';
        row.appendChild(mini);
      }
      row.appendChild(wrap);
      msgs.appendChild(row);
      hydrateMath(bubble);
      scrollDown();
      // cuộn lại sau khi KaTeX đổi chiều cao
      setTimeout(() => scrollDown(false), 350);
      return row;
    }

    function showTyping() {
      typingRow = document.createElement('div');
      typingRow.className = 'ai-row bot';
      typingRow.innerHTML = '<div class="ai-mini"><i class="bx bx-bot"></i></div><div class="ai-bubble-wrap"><div class="ai-bubble"><div class="ai-typing"><i></i><i></i><i></i></div></div></div>';
      msgs.appendChild(typingRow);
      status.textContent = 'Đang suy nghĩ…';
      scrollDown();
    }
    function hideTyping() {
      if (typingRow) { typingRow.remove(); typingRow = null; }
      status.textContent = 'Sẵn sàng hỗ trợ';
    }

    function setBusy(v) { busy = v; send.disabled = v; }

    async function sendMessage(preset) {
      const text = (typeof preset === 'string' ? preset : input.value).trim();
      if (!text || busy) return;
      chips.style.display = 'none';
      addMessage(text, 'user');
      history.push({ role: 'user', text });
      input.value = ''; autoGrow();
      setBusy(true); showTyping();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ message: text, history: history.slice(0, -1).slice(-10) }),
          signal: ctrl.signal
        });
        const data = await res.json().catch(() => ({}));
        hideTyping();
        if (!res.ok) throw new Error(data.reply || 'HTTP ' + res.status);
        const reply = data.reply || '⚠️ Không có phản hồi từ AI.';
        history.push({ role: 'bot', text: reply });
        addMessage(reply, 'bot');
      } catch (err) {
        hideTyping();
        history.pop();                                    // bỏ câu hỏi lỗi khỏi lịch sử
        addMessage(err.name === 'AbortError'
          ? '⏱️ AI phản hồi quá lâu, bạn thử gửi lại nhé.'
          : '⚠️ ' + (err.message && err.message.length < 200 ? err.message : 'Không kết nối được tới AI server.'), 'bot', { error: true });
      } finally {
        clearTimeout(timer);
        setBusy(false);
        input.focus();
      }
    }

    /* ----- Ô nhập ----- */
    function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
    input.addEventListener('input', autoGrow);
    let composing = false;                                // bộ gõ Telex/VNI/IME: Enter để chốt chữ, KHÔNG gửi
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { setTimeout(() => { composing = false; }, 0); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); sendMessage();
      }
    });
    send.addEventListener('click', () => sendMessage());

    /* ----- Mở / đóng / phóng to / làm mới ----- */
    const open = () => { root.classList.add('open'); setTimeout(() => input.focus(), 250); scrollDown(false); };
    const close = () => root.classList.remove('open');
    $('ai-fab').addEventListener('click', open);
    $('ai-close').addEventListener('click', close);
    $('ai-expand').addEventListener('click', () => {
      root.classList.toggle('expanded');
      $('ai-expand').innerHTML = '<i class="bx ' + (root.classList.contains('expanded') ? 'bx-collapse-alt' : 'bx-expand-alt') + '"></i>';
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
    $('ai-clear').addEventListener('click', reset);

    /* ----- Sao chép ----- */
    msgs.addEventListener('click', async (e) => {
      const b = e.target.closest('.ai-copy'); if (!b) return;
      let txt = '';
      if (b.hasAttribute('data-copycode')) txt = b.closest('pre').querySelector('code').textContent;
      else txt = b.__raw || '';
      try { await navigator.clipboard.writeText(txt); } catch (_) {
        const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      const old = b.innerHTML; b.innerHTML = '<i class="bx bx-check"></i> Đã chép'; setTimeout(() => { b.innerHTML = old; }, 1400);
    });

    /* ----- Khởi tạo hội thoại ----- */
    function reset() {
      msgs.innerHTML = ''; history.length = 0; hideTyping(); setBusy(false);
      addMessage(GREETING, 'bot');
      chips.innerHTML = '';
      CHIPS.forEach(([label, q]) => {
        const c = document.createElement('button');
        c.className = 'ai-chip'; c.type = 'button'; c.textContent = label;
        c.addEventListener('click', () => { open(); sendMessage(q); });
        chips.appendChild(c);
      });
      chips.style.display = 'flex';
    }
    reset();

    window.AIChat = { open, close, ask: (q) => { open(); sendMessage(q); }, renderRich };
  }
})();
