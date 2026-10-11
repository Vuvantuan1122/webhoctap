/* Dùng chung cho "bai tap.html" và "baitapvn.html": xem bài + nhận xét lỗi sai */
const HW = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isPdf = u => /\.pdf($|\?)/i.test(u || '');
  const thumb = u => isPdf(u) ? '' : `background-image:url('${esc(u)}')`;
  const fmt = t => { const d = new Date(t); return d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}) + ' · ' + d.toLocaleDateString('vi-VN'); };
  let toastT;
  function toast(msg){ let t=document.getElementById('toast'); if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t);} t.textContent=msg;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),2800); }
  function tag(fb){ if(!fb) return '<span class="tag none"><i class="fas fa-hourglass-half"></i> Chưa nhận xét</span>';
    return fb.by==='teacher' ? '<span class="tag teacher"><i class="fas fa-user-check"></i> Giáo viên đã nhận xét</span>' : '<span class="tag ai"><i class="fas fa-robot"></i> AI đã nhận xét</span>'; }

  function feedbackView(fb){
    const mis = fb.mistakes || [], good = fb.strengths || [];
    return `${fb.score!=null?`<div class="score">${fb.score}<small>/ 10 điểm</small></div>`:''}
      ${fb.summary?`<div class="fsum">${esc(fb.summary)}</div>`:''}
      ${good.length?`<div class="fh" style="color:var(--ok)"><i class="fas fa-circle-check"></i> Làm tốt</div><ul class="good">${good.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`:''}
      <div class="fh" style="color:var(--bad)"><i class="fas fa-triangle-exclamation"></i> Lỗi sai &amp; cách sửa (${mis.length})</div>
      ${mis.length?mis.map((m,i)=>`<div class="mis"><div class="is">${i+1}. ${esc(m.issue)}</div>${m.fix?`<div class="fx"><i class="fas fa-wrench"></i> <b>Cần sửa:</b> ${esc(m.fix)}</div>`:''}</div>`).join(''):'<div class="fsum">🎉 Không phát hiện lỗi sai nào.</div>'}
      ${fb.tips?`<div class="fh" style="color:var(--warn)"><i class="fas fa-lightbulb"></i> Lời khuyên</div><div class="tips">${esc(fb.tips)}</div>`:''}
      <div class="note">${fb.by==='ai'?'🤖 Nhận xét do AI tạo — hãy đối chiếu với lời giải của thầy cô.':'👩‍🏫 Nhận xét bởi '+esc(fb.reviewer||'giáo viên')} · ${fb.at?fmt(fb.at):''}</div>`;
  }

  function editorView(fb){
    fb = fb || {mistakes:[],strengths:[]};
    const rows = (fb.mistakes&&fb.mistakes.length?fb.mistakes:[{}]).map(m=>mRow(m)).join('');
    return `<div class="ed">
      <label>Điểm (0–10)</label><input id="edScore" type="number" min="0" max="10" step="0.25" value="${fb.score??''}">
      <label>Nhận xét chung</label><textarea id="edSum" rows="3">${esc(fb.summary||'')}</textarea>
      <label>Điểm làm tốt (mỗi dòng một ý)</label><textarea id="edGood" rows="2">${esc((fb.strengths||[]).join('\n'))}</textarea>
      <label>Lỗi sai &amp; cách sửa</label><div id="edMis">${rows}</div>
      <button type="button" class="btn btn-g" onclick="HW.addRow()"><i class="fas fa-plus"></i> Thêm lỗi</button>
      <label>Lời khuyên ôn tập</label><textarea id="edTips" rows="2">${esc(fb.tips||'')}</textarea></div>`;
  }
  const mRow = m => `<div class="mrow"><input placeholder="Lỗi sai ở đâu?" value="${esc(m.issue||'')}"><input placeholder="Cách sửa" value="${esc(m.fix||'')}"><button type="button" class="close" onclick="this.parentNode.remove()">×</button></div>`;
  function addRow(){ document.getElementById('edMis').insertAdjacentHTML('beforeend', mRow({})); }

  /* Mở khung xem bài. opts: {role:'teacher'|'student', onChange(sub)} */
  function open(sub, opts){
    opts = opts || {};
    if(!sub){ toast('❌ Không tìm thấy bài nộp này, hãy tải lại trang.'); return; }
    let m = document.getElementById('hwModal');
    if(!m){ m=document.createElement('div'); m.id='hwModal'; m.className='hwm'; m.onclick=e=>{if(e.target===m)m.classList.remove('on')}; document.body.appendChild(m); }
    const teacher = opts.role==='teacher';
    let editing = false;
    const draw = () => {
      const fb = sub.feedback, locked = !teacher && fb && fb.by==='teacher';
      m.innerHTML = `<div class="mbox"><div class="mimg">${isPdf(sub.url)?`<iframe src="${esc(sub.url)}"></iframe>`:`<img src="${esc(sub.url)}" alt="Bài nộp">`}</div>
        <div class="mfb"><div class="mhead"><div><h3>${esc(sub.userId||'Bài của bạn')}</h3><small>${fmt(sub.timestamp)}</small><div style="margin-top:6px">${tag(fb)}</div></div><button class="close" onclick="document.getElementById('hwModal').classList.remove('on')">✕</button></div>
        ${editing?editorView(fb):(fb?feedbackView(fb):'<div class="empty">Bài này chưa có nhận xét.</div>')}
        <div class="acts">
          ${editing?`<button class="btn btn-p" id="bSave"><i class="fas fa-floppy-disk"></i> Lưu nhận xét</button><button class="btn btn-g" id="bCancel">Hủy</button>`:`
          ${locked?'':`<button class="btn ${fb?'btn-g':'btn-p'}" id="bAi"><i class="fas fa-wand-magic-sparkles"></i> ${fb&&fb.by==='ai'?'Nhờ AI chấm lại':'Nhờ AI nhận xét'}</button>`}
          ${teacher?`<button class="btn btn-g" id="bEdit"><i class="fas fa-pen"></i> ${fb?'Sửa nhận xét':'Tự viết nhận xét'}</button>`:''}
          <a class="btn btn-g" href="${esc(sub.url)}" target="_blank" rel="noopener" style="text-decoration:none"><i class="fas fa-up-right-from-square"></i> Mở file gốc</a>`}
        </div></div></div>`;
      const $ = id => document.getElementById(id);
      if($('bAi')) $('bAi').onclick = async () => { const b=$('bAi'); b.disabled=true; b.innerHTML='<span class="spin"></span> AI đang đọc bài…';
        try{ const r=await fetch(`/api/submissions/${sub.id}/ai-feedback`,{method:'POST'}); const d=await r.json(); if(!r.ok) throw new Error(d.message);
          sub.feedback=d.feedback; opts.onChange&&opts.onChange(sub); draw(); toast('✅ AI đã nhận xét xong'); }
        catch(e){ toast('❌ '+e.message); draw(); } };
      if($('bEdit')) $('bEdit').onclick = () => { editing=true; draw(); };
      if($('bCancel')) $('bCancel').onclick = () => { editing=false; draw(); };
      if($('bSave')) $('bSave').onclick = async () => {
        const rows=[...document.querySelectorAll('#edMis .mrow')].map(r=>({issue:r.children[0].value.trim(),fix:r.children[1].value.trim()})).filter(x=>x.issue||x.fix);
        const body={score:$('edScore').value,summary:$('edSum').value,strengths:$('edGood').value.split('\n').map(s=>s.trim()).filter(Boolean),mistakes:rows,tips:$('edTips').value};
        try{ const r=await fetch(`/api/submissions/${sub.id}/feedback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d=await r.json(); if(!r.ok) throw new Error(d.message);
          sub.feedback=d.feedback; editing=false; opts.onChange&&opts.onChange(sub); draw(); toast('✅ Đã lưu nhận xét'); }
        catch(e){ toast('❌ '+e.message); } };
    };
    draw(); m.classList.add('on');
  }
  return { esc, isPdf, thumb, fmt, tag, toast, open, addRow };
})();
document.addEventListener('keydown', e => { if(e.key==='Escape') document.getElementById('hwModal')?.classList.remove('on'); });
