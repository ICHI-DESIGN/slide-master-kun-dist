#!/usr/bin/env node
/* =====================================================================
   スライドマスターくん QC — 描画後のスライドを「機械で測れる品質基準」で検品する
   使い方:
     node scripts/qc.mjs <deckDir>          # 描画して検品のみ（PNGは保存しない）→ out/qc-report.json
     import { checkSlide, checkDeck } from './qc.mjs'   # build.mjs（と legacy/scripts/render.mjs）から利用
   基準の出典と意味: reference/rubric.md
   重さ:
     error = 必須ゲート。1件でもあれば納品禁止（終了コード1）
     warn  = 減点。直せるなら直す。レビュー役の判断材料にもなる
   ===================================================================== */
import { launchBrowser, newSlidePage, waitSlideReady } from '../engine/browser.mjs';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRAME_IDS, CARDISH_IDS, DECK_RULES as R } from '../engine/layouts.mjs';

export const W = 1920, H = 1080;
/* セーフエリア（brand/pageno の帯を除いた本文ゾーン） */
const SAFE = { top: 60, bottom: 990, left: 100, right: 1820 };
/* 空き箱の基準（箱の内側の何割・何px以上が連続して空いていたら「空き」か）と、見出し下の空きの上限 */
const HOLLOW = { ratio: 0.35, px: 120 }, TITLE_GAP_LIMIT = 160;

/* 旧来の手書きHTMLから型を推定する（新エンジンは data-layout を付ける） */
const LAYOUT_SIGNATURES = [
  ['[data-layout]', null],
  ['.l-cover', 'cover'], ['.l-section', 'section'], ['.l-closing', 'closing'],
  ['.photo-hero', 'photo-hero'], ['.kinetic', 'kinetic'], ['.breakout', 'breakout'],
  ['.hero-grid', 'hero-stat'], ['.timeline', 'timeline'], ['.funnel', 'funnel'],
  ['.matrix', 'matrix'], ['.bars', 'bars'], ['.agenda', 'agenda'], ['.compare', 'compare'],
  ['.steps', 'steps'], ['.stats', 'stats'], ['.quote-wrap', 'quote'], ['.media-grid', 'media'],
  ['.tablewrap', 'table'], ['.cards', 'cards'], ['.vlist', 'list'],
];
/* 分類の正本は engine/layouts.mjs の family。ここで足すのは旧ルート（legacy/ の手書きHTML）だけにある型名 */
/* 「文章カードを並べただけ」系。多用すると単調になる */
export const CARDISH = new Set([...CARDISH_IDS, 'cards', 'list', 'points']);
/* 本文として数えない枚（図解率・カード比率の分母から除く） */
export const NON_BODY = new Set([...FRAME_IDS, 'kinetic', 'photo-hero']);
const P = r => Math.round(r * 100);

/* ---------------------------------------------------------------------
   1枚の検品（page は既に goto 済み・fonts.ready 済みであること）
   --------------------------------------------------------------------- */
export async function checkSlide(page) {
  // 画像のデコード完了を待つ（壊れた画像でも例外にしない）
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  const bgUrls = await page.evaluate(() => {
    const urls = new Set();
    for (const el of document.querySelectorAll('.slide *')) {
      const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/);
      if (m) urls.add(m[1]);
    }
    return [...urls];
  });
  const brokenBg = await page.evaluate(urls => Promise.all(urls.map(u => new Promise(res => {
    const im = new Image(); im.onload = () => res(null); im.onerror = () => res(u); im.src = u;
  }))).then(r => r.filter(Boolean)), bgUrls);

  const shot = await page.screenshot({ scale: 'css', type: 'png' });

  const result = await page.evaluate(async ({ b64, brokenBg, SAFE, SIGS, HOLLOW_RATIO, HOLLOW_PX, TITLE_GAP_PX }) => {
    const W = 1920, H = 1080;
    const issues = [];
    const add = (sev, code, msg, fix, target = '') => issues.push({ sev, code, msg, fix, target });
    const slide = document.querySelector('.slide');
    if (!slide) { add('error', 'NO_SLIDE', '.slide 要素がない', 'テンプレートの骨格を使う'); return { issues, meta: {} }; }

    const label = el => {
      if (!el) return '';
      if (el.dataset && el.dataset.slot) return `[${el.dataset.slot}]`;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
      return `<${el.tagName.toLowerCase()}${cls}>「${(el.textContent || '').trim().slice(0, 18)}」`;
    };
    const isDeco = el => !!el.closest('.deco, [data-decor], .section-num, .ghost, .quote-mark');
    // 動画用は下20%（テロップの帯）を安全域から外す
    if (slide.classList.contains('x-video')) SAFE = { ...SAFE, bottom: Math.round(H * 0.8) - 20 };
    const isChrome = el => !!el.closest('.brand, .pageno');
    const visible = el => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };

    /* ---- 型の判定 ---- */
    let layout = 'unknown';
    const dl = slide.closest('[data-layout]') || slide.querySelector('[data-layout]') || (slide.dataset.layout ? slide : null);
    if (dl) layout = dl.dataset.layout;
    else for (const [sel, name] of SIGS) { if (name && (slide.matches(sel) || slide.querySelector(sel))) { layout = name; break; } }

    /* ---- スクショを canvas に展開（画素検査用） ---- */
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, W, H).data;
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // どんな色表記（rgb / color(srgb …) / oklch 等）でも、1画素塗って読み取る
    const one = document.createElement('canvas'); one.width = one.height = 1;
    const oc = one.getContext('2d', { willReadFrequently: true });
    const parseColor = c => { oc.clearRect(0, 0, 1, 1); oc.fillStyle = '#000'; oc.fillStyle = c; oc.fillRect(0, 0, 1, 1); const d = oc.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };

    /* ---- テキスト要素（直下に文字を持つ要素）を集める ---- */
    const texts = [];
    for (const el of slide.querySelectorAll('*')) {
      if (isDeco(el) || !visible(el)) continue;
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      if (!own.length) continue;
      const rects = [];
      for (const n of own) { const r = document.createRange(); r.selectNodeContents(n); rects.push(...[...r.getClientRects()].filter(x => x.width > 1 && x.height > 1)); }
      if (!rects.length) continue;
      texts.push({ el, rects, text: own.map(n => n.textContent).join('').trim() });
    }

    /* 0. 書体の読み込み失敗（ネットが切れていた等で、代わりの書体で描かれている）
       ・Webフォント（document.fonts に登録された書体）は「読み込み済み」の face があるかで見る
       ・登録が無い書体は、Mac に入っている書体かを英字の幅で見分ける
         （和文は全角の正方形で、どの書体でも幅が同じになるので使えない） */
    {
      const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif']);
      const norm = f => f.trim().replace(/^["']|["']$/g, '');
      const faces = [...document.fonts];
      const mc = document.createElement('canvas').getContext('2d');
      const PROBE = 'mmmmmmmmmmlli1WQ@0123456789';
      const installed = fam => ['monospace', 'serif'].some(fb => {
        mc.font = `40px ${fb}`; const base = mc.measureText(PROBE).width;
        mc.font = `40px "${fam}", ${fb}`; return Math.abs(mc.measureText(PROBE).width - base) > 0.01;
      });
      const fams = new Set();
      // 数字だけの欧文書体（SMK Num）は数字の無い文字では読み込まれないので、その次の書体を見る。数字を含む文字があるときだけ SMK Num も確かめる
      for (const t of texts) if (!isChrome(t.el)) {
        const list = getComputedStyle(t.el).fontFamily.split(',').map(norm);
        if (list[0] === 'SMK Num' && /[0-9]/.test(t.el.textContent)) fams.add('SMK Num');
        const fam = list.find(f => f !== 'SMK Num') || '';
        if (fam && !GENERIC.has(fam.toLowerCase())) fams.add(fam);
      }
      const missing = new Set();
      for (const fam of fams) {
        const mine = faces.filter(f => norm(f.family) === fam);
        if (mine.length ? !mine.some(f => f.status === 'loaded') : !installed(fam)) missing.add(fam);
      }
      for (const fam of missing) add('error', 'FONT_MISSING', `書体「${fam}」が読み込めず、代わりの書体で描かれている`, 'ネットにつないで描き直す（一度読めば手元に保存され、次からはネット無しでも描ける）', '');
    }

    /* 1. はみ出し（キャンバス外） */
    for (const t of texts) {
      for (const r of t.rects) {
        if (r.right > W + 3 || r.bottom > H + 3 || r.left < -3 || r.top < -3) {
          add('error', 'OUT_OF_SLIDE', `文字がスライドの外にはみ出している: ${label(t.el)}`, '文字数を減らす／型を変える', label(t.el)); break;
        }
      }
    }
    /* 2. 枠内あふれ */
    for (const box of slide.querySelectorAll('.card, .panel, .stat, .agenda li, .vlist li, .step, [data-box]')) {
      if (isDeco(box)) continue;
      const pb = box.getBoundingClientRect();
      if (box.scrollHeight > box.clientHeight + 2 && getComputedStyle(box).overflow !== 'visible')
        add('error', 'BOX_OVERFLOW', `枠の中で文字があふれている: ${label(box)}`, '文字数を減らす／項目を分ける', label(box));
      else for (const t of texts) if (box.contains(t.el) && t.rects.some(r => r.bottom > pb.bottom + 3)) {
        add('error', 'BOX_OVERFLOW', `枠の外へ文字が出ている: ${label(t.el)}`, '文字数を減らす／項目を分ける', label(t.el)); break;
      }
    }
    /* 2a. 本文ゾーンからのはみ出し・箱同士の重なり（文字以外も見る） */
    for (const zone of slide.querySelectorAll('.x-body, [data-zone]')) {
      const zb = zone.getBoundingClientRect();
      const kids = [...zone.querySelectorAll('*')].filter(e => !isDeco(e) && visible(e) && !e.closest('.x-sticker, .x-pill'));
      const over = kids.find(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > zb.bottom + 4; });
      if (over) add('error', 'ZONE_OVERFLOW', `本文ゾーンの下からはみ出している: ${label(over)}`, '文字数を減らす／項目を減らす／goal・lead など任意の枠を外す', label(over));
    }
    const blocks = [...slide.querySelectorAll('.card, .panel, .step, [data-box], .x-flow-step, .x-goal, .x-verdict, .x-side, .x-hero, .x-browser, .x-problem-row, .x-feature, .x-chip, .x-evidence, .x-take, .x-plan, .x-pyr-text, .x-mx-cell, .x-fn-text, .x-voice-card, .x-result, .x-faq-item, .x-sum-panel, .x-fact, .x-stat, .x-member, .x-check-item, .x-question-steps li')]
      .filter(e => !isDeco(e) && visible(e));
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i], B = blocks[j];
      if (A.contains(B) || B.contains(A)) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 8 && h > 8) add('error', 'BOX_OVERLAP', `枠同士が重なっている: ${label(A)} × ${label(B)}`, '文字数や項目を減らす／型を変える', label(A));
    }

    /* 2b. 箱の中が空いている（大きい箱に少しの中身）
       箱の内側（余白 padding・枠線を除く）を縦に見て、文字・画像・図が占めていない
       いちばん大きい連続した空きを測る。下だけでなく、中央寄せで上下が空く・上下に
       分かれて真ん中が空く場合も拾う。対象は型が data-box を付けた箱（旧ルートは .card 等） */
    const boxStats = [];
    for (const box of slide.querySelectorAll('[data-box], .card, .panel, .step')) {
      if (isDeco(box) || !visible(box)) continue;
      const pb = box.getBoundingClientRect(); if (pb.height < 160) continue;
      const bs = getComputedStyle(box);
      const inTop = pb.top + parseFloat(bs.paddingTop) + parseFloat(bs.borderTopWidth);
      const inBottom = pb.bottom - parseFloat(bs.paddingBottom) - parseFloat(bs.borderBottomWidth);
      const inH = inBottom - inTop; if (inH < 80) continue;
      const spans = [];
      for (const t of texts) if (box.contains(t.el)) for (const r of t.rects) spans.push([r.top, r.bottom]);
      // 飾りでも data-fill（空きを埋める大きな番号など）は中身として数える
      for (const e of box.querySelectorAll('img, svg, .donut, [data-visual], [data-fill]')) {
        if (isDeco(e) && !e.hasAttribute('data-fill')) continue; const r = e.getBoundingClientRect(); if (r.width > 2 && r.height > 2) spans.push([r.top, r.bottom]);
      }
      spans.sort((a, b) => a[0] - b[0]);
      let cur = inTop, gap = 0;
      for (const [t, b] of spans) { if (t > cur) gap = Math.max(gap, Math.min(t, inBottom) - cur); cur = Math.max(cur, b); }
      gap = Math.max(gap, inBottom - cur);
      boxStats.push({ box: label(box), h: Math.round(pb.height), gap: Math.round(Math.max(0, gap)), ratio: +(Math.max(0, gap) / inH).toFixed(2) });
    }
    const hollowList = boxStats.filter(b => b.ratio > HOLLOW_RATIO && b.gap > HOLLOW_PX);
    if (boxStats.length && hollowList.length / boxStats.length >= 0.5) {
      const worst = hollowList.reduce((a, b) => (b.gap > a.gap ? b : a));
      add('error', 'HOLLOW_BOXES', `箱の中が空いている（${boxStats.length}個中${hollowList.length}個。最大で${worst.gap}px＝内側の${Math.round(worst.ratio * 100)}%が何も無い）`, '箱を低くする（中身に合わせる）／各箱に数字・アイコン・図を足す／文を具体化する', worst.box);
    }

    /* 2d. 並んだ箱どうしで、見出し・本文の高さがずれている（1つだけ見出しが2行になった等）
       同じ段に並ぶ兄弟の箱（data-box）と、ロードマップの列（.x-tl-item）を比べる */
    {
      const groups = new Set();
      for (const box of slide.querySelectorAll('[data-box], .x-tl-item')) if (box.parentElement) groups.add(box.parentElement);
      for (const g of groups) {
        const kids = [...g.children].filter(k => (k.matches('[data-box], .x-tl-item')) && visible(k));
        if (kids.length < 2) continue;
        const rows = [];
        for (const k of kids) { const t = k.getBoundingClientRect().top; let row = rows.find(r => Math.abs(r.top - t) < 4); if (!row) rows.push(row = { top: t, kids: [] }); row.kids.push(k); }
        for (const row of rows) {
          if (row.kids.length < 2) continue;
          // 見出しは「下の線」、本文は「書き出し」をそろえる（見出しを下ぞろえにした型では上の線がずれるのが正しい）
          for (const sel of ['h3', 'p']) {
            const ys = row.kids.map(k => k.querySelector(sel)).filter(Boolean).map(e => { const r = e.getBoundingClientRect(); return sel === 'h3' ? r.bottom : r.top; });
            if (ys.length !== row.kids.length) continue;
            const spread = Math.max(...ys) - Math.min(...ys);
            if (spread > 6) { add('warn', 'ROW_MISALIGN', `並んだ箱の${sel === 'h3' ? '見出し' : '本文'}の高さが${Math.round(spread)}pxずれている`, '見出しの長さをそろえる（1つだけ2行にならないように）／型の行そろえ（subgrid）を使う', label(row.kids[0])); break; }
          }
        }
      }
    }

    /* 2e. 箱の見出し・本文の最終行が1〜2文字だけ（泣き別れ） */
    const lineWidths = el => {
      const r = document.createRange(); r.selectNodeContents(el); const lines = [];
      for (const rc of r.getClientRects()) {
        if (rc.width < 1) continue;
        const same = lines.find(l => Math.abs((l.top + l.h / 2) - (rc.top + rc.height / 2)) < Math.min(l.h, rc.height) * 0.5);
        if (same) same.w += rc.width; else lines.push({ top: rc.top, w: rc.width, h: rc.height });
      }
      return lines.sort((x, y) => x.top - y.top);
    };
    for (const el of slide.querySelectorAll('h3, p, li')) {
      if (isDeco(el) || isChrome(el) || !visible(el) || !el.textContent.trim()) continue;
      const lines = lineWidths(el); if (lines.length < 2) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      const limit = el.matches('h3') ? fs * 2.6 : fs * 1.6;
      if (lines[lines.length - 1].w < limit)
        add('warn', 'LINE_ORPHAN', `最終行が${el.matches('h3') ? '2文字以下' : '1文字'}だけ:「${el.textContent.trim().slice(-12)}」`, '言い換えて1〜2字短くする／長くして2行目を埋める', label(el));
    }

    /* 2c. 見出しと本文の間が大きく空いている（本文が下に落ちて見える） */
    let titleGap = null;
    const headEl = slide.querySelector('.x-head');
    if (headEl && visible(headEl)) {
      const hb = headEl.getBoundingClientRect().bottom;
      let first = Infinity;
      for (const t of texts) if (!headEl.contains(t.el) && !isChrome(t.el)) for (const r of t.rects) if (r.top >= hb - 2) first = Math.min(first, r.top);
      // 図の「枠」（data-visual）は見出しのすぐ下から始まるので数えない。実際に描かれている文字・画像・アイコン・箱で測る
      for (const e of slide.querySelectorAll('img, svg, [data-box]')) {
        if (headEl.contains(e) || isDeco(e) || isChrome(e) || !visible(e)) continue;
        const r = e.getBoundingClientRect(); if (r.width > 2 && r.height > 2 && r.top >= hb - 2) first = Math.min(first, r.top);
      }
      if (isFinite(first)) {
        titleGap = Math.round(first - hb);
        if (titleGap > TITLE_GAP_PX) add('error', 'TITLE_GAP', `見出しと本文の間が${titleGap}px空いている（本文が下に落ちて見える）`, '本文を上に詰める型にする／本文の要素を大きくする', '[title]');
      }
    }

    /* 3. 文字同士の重なり */
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i], B = texts[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      let hit = false;
      for (const a of A.rects) { for (const b of B.rects) {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 6 && h > Math.min(a.height, b.height) * 0.35) { hit = true; break; }
      } if (hit) break; }
      if (hit) add('error', 'TEXT_OVERLAP', `文字同士が重なっている: ${label(A.el)} × ${label(B.el)}`, '文字数を減らす／型を変える', label(A.el));
    }

    /* 4. 画像の欠け・歪み・低解像度 */
    for (const im of slide.querySelectorAll('img')) {
      if (isDeco(im) && !im.getAttribute('src')) continue;
      const r = im.getBoundingClientRect();
      if (!im.getAttribute('src') || (im.complete && im.naturalWidth === 0)) {
        add('error', 'IMG_BROKEN', `画像が表示されていない（空の枠）: ${im.getAttribute('src') || '(src なし)'}`, '画像ファイルを assets/ に置く／パスを直す／画像なしの型に変える', im.getAttribute('src') || 'img');
        continue;
      }
      const fit = getComputedStyle(im).objectFit;
      if (fit !== 'cover' && fit !== 'contain' && r.height > 0) {
        const d = Math.abs((r.width / r.height) / (im.naturalWidth / im.naturalHeight) - 1);
        if (d > 0.03) add('error', 'IMG_DISTORTED', `画像の縦横比が歪んでいる（${(d * 100).toFixed(0)}%）`, 'object-fit: cover の枠に入れる', im.getAttribute('src'));
      }
      if (r.width > 300 && im.naturalWidth < r.width * 1.5)
        add('warn', 'IMG_LOWRES', `画像の解像度が足りない（${im.naturalWidth}px を ${Math.round(r.width)}px で表示。4K出力では粗く見える）`, '大きい画像に差し替える', im.getAttribute('src'));
    }
    for (const u of brokenBg) add('error', 'IMG_BROKEN', `背景画像が読み込めない: ${u}`, 'ファイルを置く／パスを直す', u);

    /* 5. 見出しの検査（途中切れ・行数・泣き別れ） */
    const heads = [...slide.querySelectorAll('h1, h2, .cover-title, .section-title, .closing-title, .quote-text, [data-slot=title], [data-slot=message]')]
      .filter(h => !isDeco(h) && visible(h) && h.textContent.trim());
    const titleTexts = [];
    for (const h of heads) {
      const raw = h.textContent.replace(/\s+/g, '').trim();
      titleTexts.push(raw);
      const ended = /[。！？!?」』）)]$/.test(raw);
      const hardTail = /(、|の|を|が|(?<![こごひもあ])と|や|へ|より|から|ため|ので|けど|けれど|…|\.\.\.|：|:)$/;
      const softTail = /(は|に|で|も)$/;
      if (!ended && hardTail.test(raw))
        add('error', 'TITLE_FRAGMENT', `見出しが文の途中で終わっている:「${raw}」`, '述語まで書き切る（例:「〜を原本と見比べる」）。長いなら言い換えて短くする', raw);
      else if (!ended && /[をがにはと][一-龥ぁ-んァ-ン]$/.test(raw) && raw.length > 8)
        add('error', 'TITLE_FRAGMENT', `見出しの最後が1文字で切れている疑い:「${raw}」`, '述語まで書き切る（例:「〜が正しい」）', raw);
      else if (!ended && softTail.test(raw))
        add('warn', 'TITLE_SOFT_END', `見出しが助詞で終わっている:「${raw}」`, '意図した言い切りなら「。」を付ける。そうでなければ述語まで書く', raw);
      // 行数と最終行の文字数
      const r = document.createRange(); r.selectNodeContents(h);
      const lines = [];
      for (const rc of r.getClientRects()) {
        if (rc.width < 1) continue;
        // 強調 <em> の枠と文字の枠が順不同で返るので、直前の行だけでなく全行と照合する
        const last = lines.find(l => Math.abs((l.top + l.h / 2) - (rc.top + rc.height / 2)) < Math.min(l.h, rc.height) * 0.5);
        if (last) last.w += rc.width;
        else lines.push({ top: rc.top, w: rc.width, h: rc.height });
      }
      const fs = parseFloat(getComputedStyle(h).fontSize);
      const maxLines = h.matches('.quote-text, [data-slot=message]') ? 3 : 2;
      if (lines.length > maxLines)
        add('error', 'TITLE_TOO_LONG', `見出しが${lines.length}行になっている（上限${maxLines}行）:「${raw.slice(0, 20)}…」`, '見出しを短くする（目安: 1行あたり全角20字以内）', raw);
      if (lines.length >= 2 && lines[lines.length - 1].w < fs * 2.6)
        add('warn', 'TITLE_ORPHAN', `見出しの最終行が2文字以下（泣き別れ）:「${raw}」`, '言い換えて行末をそろえる', raw);
    }

    /* 6. 文字サイズ（1920×1080基準。1pt＝2px） */
    const CAPTION = '.x-axis, .brand, .pageno, .kicker, .eyebrow, .when, .badge, .cover-meta, .f-kick, .f-meta, .f-card-label, .x-kicker, .x-step-no, .x-tag, .x-sticker, .x-pill, .x-tl-when, .x-progress, .x-meta, .x-note, .x-li-mark, .x-problem-statlabel, .x-goal-label, .x-contact, .x-browser-bar, .x-node-no, .x-num-dot, .x-stat-note, .x-member-role, .x-quote-role, .x-timer, .x-take-label, .x-th .x-pill, .x-plan-unit, .x-mx-y, .x-mx-x, .x-voice-role, .x-result-label, .x-profile-role, .x-fact-label, .x-sum-next-label, .x-qa, .note, .foot, .chip, .annot, .sticker, .mx-axis, small, [data-role=caption], .tl-date, .quote-who';
    let minBody = 999, sizes = new Set();
    for (const t of texts) {
      const fs = parseFloat(getComputedStyle(t.el).fontSize);
      sizes.add(Math.round(fs));
      const cap = !!t.el.closest(CAPTION);
      if (fs < 18) add('error', 'FONT_TINY', `文字が小さすぎて読めない（${fs}px）: ${label(t.el)}`, '18px未満は禁止。削るか型を変える', label(t.el));
      else if (fs < 22 && !cap) add('warn', 'FONT_SMALL', `文字がかなり小さい（${fs}px）: ${label(t.el)}`, '注釈以外は28px以上に', label(t.el));
      else if (!cap && fs < 28) add('warn', 'FONT_SMALL', `本文が小さい（${fs}px。画面共有で読める目安は36px）: ${label(t.el)}`, '文字数を減らしてサイズを上げる', label(t.el));
      if (!cap && t.text.length >= 12) minBody = Math.min(minBody, fs);
    }

    /* 7. コントラスト（描画した画素から背景色を推定） */
    let lowest = 99;
    for (const t of texts) {
      if (isChrome(t.el)) continue;
      const cs = getComputedStyle(t.el);
      const m = parseColor(cs.color);
      const alpha = m[3];
      if (alpha < 0.05 || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue;
      const r0 = t.rects[0];
      let solid = null;
      for (let e = t.el, k = 0; e && e !== slide && k < 3; e = e.parentElement, k++) {
        const s2 = getComputedStyle(e);
        if (s2.backgroundImage !== 'none') break;
        const bm = parseColor(s2.backgroundColor);
        if (bm[3] > 0.95) { solid = relLum(bm[0], bm[1], bm[2]); break; }
      }
      // 文字の外周4辺の少し外側を背景として採る
      const samples = [];
      const pts = [[r0.left - 6, r0.top + r0.height / 2], [r0.right + 6, r0.top + r0.height / 2], [r0.left + r0.width / 2, r0.top - 4], [r0.left + r0.width / 2, r0.bottom + 4], [r0.left - 6, r0.top - 4], [r0.right + 6, r0.bottom + 4]];
      for (const [x, y] of pts) {
        const X = Math.max(0, Math.min(W - 1, Math.round(x))), Y = Math.max(0, Math.min(H - 1, Math.round(y)));
        const i = (Y * W + X) * 4; samples.push(relLum(px[i], px[i + 1], px[i + 2]));
      }
      samples.sort((a, b) => a - b);
      const bgL = solid ?? samples[Math.floor(samples.length / 2)];
      const fg = relLum(m[0], m[1], m[2]);
      const fgL = alpha < 1 ? fg * alpha + bgL * (1 - alpha) : fg; // 近似
      const cr = ratio(fgL, bgL);
      const fs = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
      const large = fs >= 48 || (fs >= 37 && bold);
      lowest = Math.min(lowest, cr);
      const isCap = !!t.el.closest(CAPTION);
      if (isCap && cr >= 2 && cr < 3) add('warn', 'CAPTION_FAINT', `注釈・英字キャプションが薄い（${cr.toFixed(1)}:1）: ${label(t.el)}`, 'アクセント色を濃くする', label(t.el));
      else if (cr < (large || isCap ? 3 : 4.5) && !(isCap && cr >= 2)) add('error', 'LOW_CONTRAST', `文字が背景に沈んでいる（コントラスト比 ${cr.toFixed(1)}:1）: ${label(t.el)}`, '文字色を濃く／背景を変える（基準: 通常4.5:1・大きい文字3:1）', label(t.el));
      else if (!large && !t.el.closest(CAPTION) && cr < 7) add('warn', 'CONTRAST_WEAK', `本文がやや薄い（${cr.toFixed(1)}:1。推奨7:1）: ${label(t.el)}`, '本文色を濃くする', label(t.el));
    }

    /* 8. 余白と重心（本文ゾーンのどこまで使っているか） */
    let cTop = H, cBottom = 0, cLeft = W, cRight = 0;
    const contentEls = [...texts.filter(t => !isChrome(t.el)).flatMap(t => t.rects),
      ...[...slide.querySelectorAll('img, svg, canvas, .donut, .card, .panel, .stat, .step, .fu-bar, .mx-cell, .tl-node, .media-box, [data-visual]')]
        .filter(e => !isDeco(e) && visible(e)).map(e => e.getBoundingClientRect())];
    for (const r of contentEls) {
      if (r.width < 2 || r.height < 2) continue;
      cTop = Math.min(cTop, r.top); cBottom = Math.max(cBottom, r.bottom);
      cLeft = Math.min(cLeft, r.left); cRight = Math.max(cRight, r.right);
    }
    const fillY = Math.max(0, (Math.min(cBottom, SAFE.bottom) - Math.max(cTop, SAFE.top)) / (SAFE.bottom - SAFE.top));
    const fillX = Math.max(0, (Math.min(cRight, SAFE.right) - Math.max(cLeft, SAFE.left)) / (SAFE.right - SAFE.left));
    const bottomGap = SAFE.bottom - cBottom;
    const videoBottom = Math.max(0, ...contentEls.filter(r => r.width > 1 && r.height > 1 && !(r.width >= W - 2 && r.height >= H - 2)).map(r => r.bottom));
    if (slide.classList.contains('x-video') && videoBottom > H * 0.8 + 2)
      add('error', 'VIDEO_BAND', `動画のテロップ帯（下20%・${Math.round(H * 0.8)}px より下）に中身が入っている（下端 ${Math.round(videoBottom)}px）`, '文字数・項目を減らす／2枚に分ける／図の少ない型にする', '');

    // 画素ベース: 前景（背景色と違う画素）の重心と空きブロック率
    const grid = 24; let empty = 0, total = 0, sx = 0, sy = 0, sw = 0, lumSum = 0;
    const bgCounts = new Map();
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
      const i = (y * W + x) * 4; const key = (px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4);
      bgCounts.set(key, (bgCounts.get(key) || 0) + 1);
      lumSum += relLum(px[i], px[i + 1], px[i + 2]);
    }
    const meanLum = lumSum / ((H / 8) * (W / 8));
    for (let gy = SAFE.top; gy < SAFE.bottom - grid; gy += grid) for (let gx = SAFE.left; gx < SAFE.right - grid; gx += grid) {
      let mn = 1, mx = 0;
      for (let y = gy; y < gy + grid; y += 3) for (let x = gx; x < gx + grid; x += 3) {
        const i = (y * W + x) * 4; const l = relLum(px[i], px[i + 1], px[i + 2]);
        if (l < mn) mn = l; if (l > mx) mx = l;
      }
      total++;
      if (mx - mn < 0.06) empty++; else { sx += gx + grid / 2; sy += gy + grid / 2; sw++; }
    }
    const whitespace = empty / total;
    const cx = sw ? (sx / sw) / W - 0.5 : 0, cy = sw ? (sy / sw) / H - 0.5 : 0;

    const layoutsAllowEmpty = new Set(['cover', 'section', 'closing', 'quote', 'kinetic', 'message', 'photo-hero', 'breakout']);
    if (!layoutsAllowEmpty.has(layout)) {
      if (bottomGap > (SAFE.bottom - SAFE.top) * 0.33)
        add('error', 'BOTTOM_EMPTY', `下1/3が空いている（内容の下端 ${Math.round(cBottom)}px）`, '型を変える（図解・巨大数字）／要素を大きく／2枚を1枚に統合', '');
      else if (bottomGap > (SAFE.bottom - SAFE.top) * 0.2)
        add('warn', 'BOTTOM_SPARSE', `下の余白が広め（${Math.round(bottomGap)}px 空き）`, '要素を大きくする／縦に広げる', '');
      if (whitespace > 0.72) add('warn', 'SPARSE', `スカスカに見える（空きブロック ${(whitespace * 100).toFixed(0)}%）`, '主役を大きくする／図解を足す', '');
    }

    /* 9. ジャンプ率（最大の文字 ÷ 最小の本文） */
    let maxFs = 0; for (const t of texts) if (!isChrome(t.el)) maxFs = Math.max(maxFs, parseFloat(getComputedStyle(t.el).fontSize));
    const jump = minBody < 999 ? maxFs / minBody : null;
    if (jump && jump < 1.5 && !layoutsAllowEmpty.has(layout))
      add('warn', 'LOW_JUMP', `文字の大小差が小さい（最大/本文=${jump.toFixed(2)}倍。目安1.5倍以上）`, '見出しか主役を大きく、脇役を小さく', '');

    /* 10. 置き忘れ文字 */
    // NaN・undefined は大文字小文字を区別して単語として探す（区別しないと finance・banana の nan に反応する）
    if (/lorem|ipsum|\bTODO\b|\bxxx\b|\[insert|ここに(入れる|入力)|ダミー/i.test(slide.innerText) || /\bNaN\b|\bundefined\b/.test(slide.innerText))
      add('error', 'PLACEHOLDER', '置き忘れの仮テキストがある', '本文に差し替える', '');

    /* 図解（主役ビジュアル）の有無 */
    const safeArea = (SAFE.right - SAFE.left) * (SAFE.bottom - SAFE.top);
    let visualArea = 0;
    for (const e of slide.querySelectorAll('img, svg, canvas, .donut, .hero-card, .timeline, .funnel, .mx-grid, .bars, .media-box, .compare, [data-visual]')) {
      if (isDeco(e) || !visible(e)) continue;
      if (e.tagName === 'IMG' && e.naturalWidth === 0) continue;
      if (e.querySelector('img') && [...e.querySelectorAll('img')].every(i => i.naturalWidth === 0)) continue;
      if (e.tagName.toLowerCase() === 'svg' && e.closest('.badge, .icon, [data-role=icon]')) continue;
      const r = e.getBoundingClientRect(); visualArea = Math.max(visualArea, r.width * r.height);
    }
    const bigNumber = texts.some(t => !isDeco(t.el) && parseFloat(getComputedStyle(t.el).fontSize) >= 150 && /\d/.test(t.text));
    const hasVisual = visualArea / safeArea >= 0.2 || bigNumber;

    return { issues, meta: { layout, hasVisual, dark: meanLum < 0.18, meanLum: +meanLum.toFixed(3),
      fillX: +fillX.toFixed(2), fillY: +fillY.toFixed(2), whitespace: +whitespace.toFixed(2),
      balance: { x: +cx.toFixed(3), y: +cy.toFixed(3) }, jump: jump && +jump.toFixed(2),
      minBodyPx: minBody < 999 ? minBody : null, lowestContrast: lowest < 99 ? +lowest.toFixed(2) : null,
      fontSizes: [...sizes].sort((a, b) => a - b), titles: titleTexts, boxes: boxStats, titleGap } };
  }, { b64: shot.toString('base64'), brokenBg, SAFE, SIGS: LAYOUT_SIGNATURES, HOLLOW_RATIO: HOLLOW.ratio, HOLLOW_PX: HOLLOW.px, TITLE_GAP_PX: TITLE_GAP_LIMIT });

  return result;
}

/* ---------------------------------------------------------------------
   デッキ全体の検品（各枚の meta を並べて判定）
   --------------------------------------------------------------------- */
export function checkDeck(slides /* [{file, meta}] */) {
  const issues = [];
  const add = (sev, code, msg, fix) => issues.push({ sev, code, msg, fix });
  const n = slides.length;
  const L = slides.map(s => s.meta.layout);

  // 同じ型の連続
  let run = 1;
  for (let i = 1; i < n; i++) {
    run = L[i] === L[i - 1] ? run + 1 : 1;
    if (run === 3) add('error', 'LAYOUT_REPEAT', `同じ型「${L[i]}」が3枚連続（${slides[i - 2].file}〜${slides[i].file}）`, '真ん中の1枚を別の型（図解・巨大数字・写真）に変える');
  }
  const body = slides.filter(s => !NON_BODY.has(s.meta.layout));
  if (body.length >= 4) {
    const cardish = body.filter(s => CARDISH.has(s.meta.layout)).length / body.length;
    if (cardish > R.cardStop) add('error', 'CARDS_DOMINANT', `カード並べ系の型が本文の${P(cardish)}%（上限${P(R.cardStop)}%・目安${P(R.cardWarn)}%以下）`, 'カードの枚を図解・比較・巨大数字・手順図に置き換える');
    else if (cardish > R.cardWarn) add('warn', 'CARDS_MANY', `カード並べ系の型が本文の${P(cardish)}%（目安${P(R.cardWarn)}%以下）`, '1〜2枚を図解に置き換える');

    const vis = body.filter(s => s.meta.hasVisual).length / body.length;
    if (vis < R.visualStop) add('error', 'VISUAL_SHORTAGE', `図解・写真・巨大数字が主役の枚が本文の${P(vis)}%しかない（最低${P(R.visualStop)}%・目標${P(R.visualTarget)}%）`, '数字は巨大数字、比較は比較図、流れはフロー図、画面は実物スクショに');
    else if (vis < R.visualTarget) add('warn', 'VISUAL_LOW', `図解が主役の枚が本文の${P(vis)}%（目標${P(R.visualTarget)}%以上）`, 'あと1〜2枚を図解にする');

    const counts = {}; for (const s of body) counts[s.meta.layout] = (counts[s.meta.layout] || 0) + 1;
    for (const [k, c] of Object.entries(counts))
      if (body.length >= 6 && c / body.length > 0.3) add('warn', 'LAYOUT_DOMINANT', `型「${k}」が本文の${Math.round(c / body.length * 100)}%を占める（目安30%以下）`, '別の型に振り分ける');
  }
  const kinds = new Set(L).size;
  if (n >= 8 && kinds / n * 10 < 5) add('warn', 'LOW_VARIETY', `型の種類が少ない（${n}枚で${kinds}種。10枚あたり5種以上が目安）`, '決定表から別の型を選ぶ');

  // 明暗リズム
  const darks = slides.filter(s => s.meta.dark).length;
  if (n >= 8 && darks === 0) add('warn', 'NO_DARK', '暗い背景の枚が1枚もない（明暗リズムがない）', '章扉・キーメッセージを暗面にする（全体の15〜35%）');
  let same = 1;
  for (let i = 1; i < n; i++) {
    same = slides[i].meta.dark === slides[i - 1].meta.dark ? same + 1 : 1;
    if (same === 6) { add('warn', 'FLAT_RHYTHM', `同じ明るさの枚が6枚以上続く（${slides[i - 5].file}〜）`, '途中に暗面の章扉・メッセージを挟む'); break; }
  }
  // 文字サイズの種類
  for (const s of slides) if ((s.meta.fontSizes || []).length > 9)
    add('warn', 'FONT_SCALE_MESSY', `${s.file} の文字サイズが${s.meta.fontSizes.length}段階（1枚3〜6段階が目安。ばらついて見える）`, '型テンプレートの既定サイズに任せる');
  return issues;
}

export function summarize(slideResults, deckIssues) {
  const all = [...slideResults.flatMap(s => s.issues.map(i => ({ ...i, file: s.file }))), ...deckIssues.map(i => ({ ...i, file: '(デッキ全体)' }))];
  const errors = all.filter(i => i.sev === 'error');
  const warns = all.filter(i => i.sev === 'warn');
  return { errors, warns, pass: errors.length === 0 };
}

export function printReport(rep) {
  const line = i => `  [${i.code}] ${i.file} → ${i.msg}\n      直し方: ${i.fix}`;
  if (rep.errors.length) { console.error(`\n✖ 必須ゲート違反 ${rep.errors.length}件（納品禁止）`); rep.errors.forEach(i => console.error(line(i))); }
  if (rep.warns.length) { console.log(`\n△ 減点 ${rep.warns.length}件`); rep.warns.forEach(i => console.log(line(i))); }
  if (rep.pass) console.log(`\n✔ 必須ゲート全合格${rep.warns.length ? `（減点${rep.warns.length}件は可能なら直す）` : '・減点ゼロ'}`);
}

/* ---------------------------------------------------------------------
   CLI: 描画して検品だけ行う
   --------------------------------------------------------------------- */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deckDir = resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? '.');
  const files = readdirSync(deckDir).filter(f => f.endsWith('.html')).sort();
  if (!files.length) { console.error(`no .html files in ${deckDir}`); process.exit(1); }
  const browser = await launchBrowser();
  const page = await newSlidePage(browser, { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const results = [];
  for (const f of files) {
    await page.goto('file://' + join(deckDir, f), { waitUntil: 'load' });
    await waitSlideReady(page);
    await page.waitForTimeout(120);
    const r = await checkSlide(page);
    results.push({ file: f, ...r });
    const e = r.issues.filter(i => i.sev === 'error').length, w = r.issues.length - e;
    console.log(`${e ? '✖' : '✓'} ${f}  型=${r.meta.layout}${r.meta.hasVisual ? ' 図解あり' : ''}${r.meta.dark ? ' 暗面' : ''}${e ? `  必須違反${e}` : ''}${w ? `  減点${w}` : ''}`);
  }
  await browser.close();
  const deckIssues = checkDeck(results);
  const rep = summarize(results, deckIssues);
  mkdirSync(join(deckDir, 'out'), { recursive: true });
  writeFileSync(join(deckDir, 'out', 'qc-report.json'), JSON.stringify({ pass: rep.pass, errors: rep.errors, warns: rep.warns, slides: results.map(r => ({ file: r.file, meta: r.meta })) }, null, 2));
  printReport(rep);
  process.exit(rep.pass ? 0 : 1);
}
