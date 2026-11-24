/* =====================================================================
   見出しの泣き別れを防ぐ（描画の直前にブラウザの中で動く）
   - 並んだ箱（data-box）とロードマップの列（.x-tl-item）の見出し h3 を調べる
   - 2行以上に折り返して最終行が2文字ほどしかない見出しは、少しずつ小さくして1行減らす（最小で元の80%）
   - 同じ並びの見出しは同じ大きさにそろえる（1つだけ小さいと目立つため、一番小さく要る倍率に合わせる）
   - その前に、文字の多いスライドで本文が枠・箱からあふれていたら、まず詰めた組み方（x-body に is-dense）に切り替え、
     それでも足りなければ本文の文字を少しずつ縮める（最小で元の72%）。
     型の文字は「短い文で箱が埋まる大きさ」にしてあるので、長い文のデッキではここで自動的に一回り小さくなる
   - 終わったら <html data-fit="done"> を立てる。build.mjs と PPTX 書き出しはこれを待ってから撮る
   ===================================================================== */
(async () => {
  // <head> で読まれるので、本文と画像が揃う load まで待ってから書体を待つ（先に書体を待つと本文が空のまま終わる）
  if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
  try { await document.fonts.ready; } catch (_) { /* 書体の失敗は検品の FONT_MISSING が拾う */ }
  const MIN = 0.8, STEP = 0.04, ORPHAN_EM = 2.6;

  const lines = el => {
    const r = document.createRange(); r.selectNodeContents(el); const out = [];
    for (const rc of r.getClientRects()) {
      if (rc.width < 1) continue;
      const same = out.find(l => Math.abs((l.top + l.h / 2) - (rc.top + rc.height / 2)) < Math.min(l.h, rc.height) * 0.5);
      if (same) same.w += rc.width; else out.push({ top: rc.top, w: rc.width, h: rc.height });
    }
    return out.sort((a, b) => a.top - b.top);
  };
  const orphaned = (el, fs) => { const ls = lines(el); return ls.length >= 2 && ls[ls.length - 1].w < fs * ORPHAN_EM ? ls.length : 0; };

  // 見出し1つについて、泣き別れが消える一番大きい倍率を探す（消えなければ 1 ＝ 触らない）
  const need = h => {
    const base = parseFloat(getComputedStyle(h).fontSize);
    const n0 = orphaned(h, base); if (!n0) return 1;
    let found = 1;
    for (let s = 1 - STEP; s >= MIN - 1e-6; s -= STEP) {
      h.style.fontSize = `${base * s}px`;
      if (lines(h).length < n0) { found = s; break; }
    }
    h.style.fontSize = '';
    return found;
  };

  /* ---- 0. 画像を並べる型: 枠と画像の縦横比が1.3倍以上違えば、切らずに全体を見せる（画面の画像の見出しが切れないように） ---- */
  for (const im of document.querySelectorAll('.x-gal-img img')) {
    if (!im.naturalWidth) continue;
    const box = im.parentElement.getBoundingClientRect();
    const r = (im.naturalWidth / im.naturalHeight) / (box.width / box.height);
    if (r > 1.3 || r < 1 / 1.3) im.parentElement.classList.add('is-contain');
  }

  /* ---- 1. あふれたら本文を縮める（検品の ZONE_OVERFLOW / BOX_OVERFLOW / BOX_OVERLAP と同じ見方を簡単にしたもの） ---- */
  const DENSE_MIN = 0.72, DENSE_STEP = 0.04;
  // 飾り（.deco）は数えない。ただしロードマップの大きな番号のように、普通に並んで場所を取る飾り（position: static）は数える。
  // 手順フローの番号のように箱の下へわざとはみ出させて切り取る飾りを数えると、あふれていないのに縮めてしまう
  const inDeco = e => { const d = e.closest('.deco'); return !!d && getComputedStyle(d).position !== 'static'; };
  const overflowing = body => {
    const zb = body.getBoundingClientRect();
    for (const e of body.querySelectorAll('*')) {
      if (inDeco(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.height > 0 && r.bottom > zb.bottom + 2) return true;
    }
    for (const box of body.querySelectorAll('[data-box], .x-tl-item')) {
      const bb = box.getBoundingClientRect();
      for (const t of box.querySelectorAll('h3, p, li, .x-tag')) if (!inDeco(t) && t.getBoundingClientRect().bottom > bb.bottom + 2) return true;
    }
    const blocks = [...body.querySelectorAll('[data-box], .x-goal, .x-verdict, .x-take')].filter(e => !inDeco(e));
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i], B = blocks[j]; if (A.contains(B) || B.contains(A)) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 6 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 6) return true;
    }
    return false;
  };
  for (const body of document.querySelectorAll('.x-body')) {
    if (!overflowing(body)) continue;
    body.classList.add('is-dense');                 // まずは詰めた組み方（engine.css の is-dense）に切り替える
    if (!overflowing(body)) { body.dataset.dense = '100'; continue; }
    // 文字を直接持つ要素（と箇条・大きな番号）を、元の大きさから一律の倍率で縮める。
    // 26px 未満のラベル（番号・タグ・STEP 表示）は縮めると読めなくなるので触らない
    const LABEL_PX = 26;
    const targets = [...body.querySelectorAll('*')].filter(e => e.matches('.x-bignum, li, h3, p') ||
      [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .filter(e => parseFloat(getComputedStyle(e).fontSize) >= LABEL_PX);
    const base = targets.map(e => parseFloat(getComputedStyle(e).fontSize));
    let scale = 1;
    for (let s = 1 - DENSE_STEP; s >= DENSE_MIN - 1e-6; s -= DENSE_STEP) {
      scale = s;
      targets.forEach((e, i) => { e.style.fontSize = `${base[i] * s}px`; });
      if (!overflowing(body)) break;
    }
    body.dataset.dense = String(Math.round(scale * 100));
  }

  /* ---- 2. 見出しの泣き別れ ---- */
  const groups = new Map();
  for (const box of document.querySelectorAll('[data-box], .x-tl-item')) {
    const h = box.querySelector('h3'); if (!h || !box.parentElement) continue;
    if (!groups.has(box.parentElement)) groups.set(box.parentElement, []);
    groups.get(box.parentElement).push(h);
  }
  for (const heads of groups.values()) {
    const scale = Math.min(...heads.map(need));
    if (scale >= 1) continue;
    const sizes = heads.map(h => parseFloat(getComputedStyle(h).fontSize));
    heads.forEach((h, i) => { h.style.fontSize = `${sizes[i] * scale}px`; h.dataset.fit = String(Math.round(scale * 100)); });
  }
  /* ---- 3. 表紙・章扉・締めの大見出し（.f-title） ----
     大きさは layouts.mjs が文字数から決めるが、文節で改行する（word-break: auto-phrase）ので、長い文節が1行に入らないと
     「育てていきましょ／う。」のように3行目へこぼれる。2行を超えるか最終行が2文字ほどなら、少しずつ縮める（最小で元の70%） */
  for (const h of document.querySelectorAll('.x-slide[data-frame] .f-title')) {
    const base = parseFloat(getComputedStyle(h).fontSize), max = Number(h.dataset.lines || 2);
    const bad = () => { const ls = lines(h); return ls.length > max || (ls.length >= 2 && ls[ls.length - 1].w < parseFloat(h.style.fontSize || base) * ORPHAN_EM); };
    if (!bad()) continue;
    let s = 1;
    for (s = 1 - 0.03; s >= 0.7 - 1e-6; s -= 0.03) { h.style.fontSize = `${base * s}px`; if (!bad()) break; }
    h.dataset.fit = String(Math.round(s * 100));
  }
  /* ---- 4. 幅の上限（CSS の --fit-w）を持つ大きな文字は、上限を超えたら縮める（章扉の大きな番号など） ---- */
  for (const e of document.querySelectorAll('.x-slide[data-frame] *')) {
    const max = parseFloat(getComputedStyle(e).getPropertyValue('--fit-w')); if (!max) continue;
    const w = e.getBoundingClientRect().width; if (w <= max) continue;
    e.style.fontSize = `${parseFloat(getComputedStyle(e).fontSize) * max / w}px`;
  }
  document.documentElement.dataset.fit = 'done';
})();
