/* =====================================================================
   スライドマスターくん engine — 型（レイアウト）の定義
   ---------------------------------------------------------------------
   1つの型 = 「枠（入れてよい中身と文字数の上限）」＋「HTMLの組み方」
   ・AI（どのモデルでも）が決めるのは「型の選択」と「枠に入れる言葉」だけ
   ・座標・サイズ・色はここと core/engine.css が決める（AIは触らない）
   ・枠の文字数は全角=1・半角=0.5 で数える（engine/text.mjs の width）
   新しい型を足すときは reference/layouts.md の決定表にも追記すること
   ===================================================================== */
import { esc, rich, width, plain } from './text.mjs';
import { icon, ICON_NAMES } from './icons.mjs';

/* ---------- 枠の書き方（validate.mjs が読む） ---------- */
export const T = (max, o = {}) => ({ kind: 'text', max, min: o.min ?? 0, req: o.req ?? true, hint: o.hint });
export const OPT = (max, o = {}) => T(max, { ...o, req: false });
export const LIST = (item, min, max, o = {}) => ({ kind: 'list', item, min, max, req: o.req ?? true, hint: o.hint });
export const OBJ = (fields, o = {}) => ({ kind: 'obj', fields, req: o.req ?? true });
export const ENUM = (values, o = {}) => ({ kind: 'enum', values, req: o.req ?? false });
export const NUM = (o = {}) => ({ kind: 'num', min: o.min ?? 0, max: o.max ?? 99, req: o.req ?? false });
export const IMG = (o = {}) => ({ kind: 'img', req: o.req ?? true });
const ICON = (o = {}) => ENUM(ICON_NAMES, o);

/* ---------- 共通パーツ ---------- */
const head = (s, o = {}) => `
  <header class="x-head${o.center ? ' is-center' : ''}">
    ${s.kicker ? `<div class="x-kicker">${esc(s.kicker)}</div>` : ''}
    <h2 class="x-title" data-slot="title">${rich(s.title)}</h2>
    ${s.lead ? `<p class="x-lead" data-slot="lead">${rich(s.lead)}</p>` : ''}
  </header>`;

const pad2 = n => String(n).padStart(2, '0');

/* グラフの目盛り: 0 を含め、1・2・2.5・5 の区切りで4段前後にする */
const niceScale = (min, max) => {
  if (min === max) max = min + 1;
  const raw = (max - min) / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { lo, hi, ticks };
};
/* 割合を整数にして合計を100にそろえる（端数の大きい順に1ずつ足す） */
const roundTo100 = ps => {
  const f = ps.map(Math.floor); let rest = 100 - f.reduce((a, b) => a + b, 0);
  ps.map((p, i) => [p - f[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) f[i]++; });
  return f;
};

/* 数字と単位を分けて、単位を小さく組む（例: "1,000枚" → 1,000 + 枚） */
const numUnit = (value, unit) => {
  if (unit) return `<span class="x-n">${esc(value)}</span><span class="x-u">${esc(unit)}</span>`;
  const m = String(value).match(/^([+\-−±]?[\d.,]+)(.*)$/);
  return m ? `<span class="x-n">${esc(m[1])}</span>${m[2] ? `<span class="x-u">${esc(m[2])}</span>` : ''}`
           : `<span class="x-n is-word">${esc(value)}</span>`;
};

/* ---------- 表紙・章扉・締めの見た目（frame） ----------
   deck.json の "frames"（デッキ全体）か、スライドの "style"（その1枚だけ）で選ぶ。書かなければテーマごとに自動
     slant   = 斜めの色帯（スピード感）
     block   = 左の色面＋大きな文字（ブロック）
     type    = 大見出しが主役（タイポグラフィ）
     classic = 以前の形（透かしの英字・数字。丸い台座アイコンは自分の決まりで禁止のため出さない） */
export const FRAME_STYLES = ['slant', 'block', 'type', 'classic'];
export const FRAME_LAYOUTS = ['cover', 'section', 'closing'];
/* auto のときの対応表。テーマの性格で決める（勢い＝slant / きっちり＝block / 言葉で引っぱる＝type）。
   表に無いテーマ（新しく足したテーマ）はテーマ名から3つのどれかに決める（同じテーマなら毎回同じ） */
export const FRAME_AUTO = {
  slant: [
    'dynamic', 'fitness', 'pop', 'neon', 'tech', 'gradient', 'industrial', 'kids'],
  block: ['corporate', 'finance', 'estate', 'medical', 'public', 'duotone', 'retro'],
  type: ['fresh', 'minimal', 'elegant', 'feminine', 'luxury', 'resort', 'warm', 'nordic'],
};
export function frameOf(slide, deck = {}) {
  const want = slide.style || deck.frames || 'auto';
  if (want !== 'auto') return want;
  for (const [f, list] of Object.entries(FRAME_AUTO)) if (list.includes(deck.theme)) return f;
  let h = 0; for (const ch of String(deck.theme || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ['slant', 'block', 'type'][h % 3];
}
/* ---------- 中身のスライドの版面の流儀（page） ----------
   deck.json の "pages"（デッキ全体）か、スライドの "page"（その1枚だけ）で選ぶ。書かなければ card（今までの見た目）
     card    = 角丸の箱＋影（やわらかく見せる）
     swiss   = 見出しを左の柱に置き、中身は右。黒の太い罫線と大きな数字、色は1色（提案書・報告・数字で説得）
     kinetic = 斜めの帯、角の立った箱を段違いに並べ、ずらした色の板を影にする（営業・告知・イベント）
     mix     = swiss を基本にして、見せ場の型（MIX_KINETIC）だけ kinetic
   表紙・章扉・締めなど枠の型（family が frame）には効かない（そちらは frames の担当） */
export const PAGE_STYLES = ['card', 'swiss', 'kinetic', 'mix'];
export const MIX_KINETIC = ['big-number', 'stats', 'problem'];
export function pageOf(slide, deck = {}) {
  const L = LAYOUTS[slide.layout];
  if (!L || L.family === 'frame') return null;
  const want = slide.page || deck.pages || 'card';
  if (want === 'mix') return MIX_KINETIC.includes(slide.layout) ? 'kinetic' : 'swiss';
  return want === 'card' ? null : want;
}
/* その1枚が暗い面（dark）・色面（accent）・明るい面（light）のどれか。型の tone が関数のときは見た目で変わる */
export function toneOf(slide, deck = {}) {
  const L = LAYOUTS[slide.layout]; if (!L) return 'light';
  return typeof L.tone === 'function' ? L.tone(slide, frameOf(slide, deck)) : L.tone;
}
/* 見出しの字数から、枠の幅に lines 行で収まる大きさを決める（全角=1・半角=0.5） */
const fitFs = (raw, boxW, maxFs, minFs, lines = 2) => {
  const ls = String(raw ?? '').split('\n').map(width);
  const total = ls.reduce((a, b) => a + b, 0), longest = Math.max(...ls, 1);
  // 改行（\n）を書いた見出しは1行ずつ枠に収める。書いていなければ折り返しはブラウザに任せ、全体が lines 行に収まる大きさにする
  const fs = Math.min(maxFs, (boxW * Math.max(lines, ls.length) * 0.96) / Math.max(total, 1), ls.length > 1 ? (boxW * 0.98) / longest : Infinity);
  return Math.round(Math.max(minFs, fs));
};
const markLen = m => Math.max(1, [...String(m)].length);
const arrowBtn = (t, cls = '') => `<div class="f-cta${cls}"><span>${rich(t)}</span><i>${icon('arrow', 44)}</i></div>`;
const progress = (c, cls) => `<div class="${cls}" style="--t:${c.sectionsTotal}">${Array.from({ length: c.sectionsTotal }, (_, i) =>
  `<span class="${i + 1 === c.sectionNo ? 'is-on' : i + 1 < c.sectionNo ? 'is-done' : ''}"></span>`).join('')}</div>`;

const COVER = {
  slant: (s, c) => `
      <div class="deco f-band2"></div>
      <div class="deco f-band">${s.image ? `<div class="f-band-photo"><img src="${esc(c.asset(s.image))}" alt=""></div>` : ''}</div>
      ${s.image ? '' : `<div class="deco f-mark" style="--len:${markLen(s.mark || 'AI')}">${esc(s.mark || 'AI')}</div>`}
      <div class="f-copy">
        ${s.meta ? `<div class="f-meta">${esc(s.meta)}</div>` : ''}
        ${s.kicker ? `<div class="f-kick">— ${esc(s.kicker)}</div>` : ''}
        <h1 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1180, 128, 80)}px"><span class="f-hl">${rich(s.title)}</span></h1>
        ${s.subtitle ? `<p class="f-sub" data-slot="subtitle">${rich(s.subtitle)}</p>` : ''}
      </div>`,
  block: (s, c) => `
      <div class="deco f-block">${s.image ? `<img src="${esc(c.asset(s.image))}" alt="">` : ''}</div>
      ${s.meta ? `<div class="f-meta">${esc(s.meta)}</div>` : ''}
      ${s.image ? '' : `<div class="deco f-mark" style="--len:${markLen(s.mark || 'AI')}">${esc(s.mark || 'AI')}</div>`}
      <div class="f-copy">
        ${s.kicker ? `<div class="f-tag">${esc(s.kicker)}</div>` : ''}
        <h1 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1140, 120, 76)}px">${rich(s.title)}</h1>
        ${s.subtitle ? `<p class="f-sub" data-slot="subtitle">${rich(s.subtitle)}</p>` : ''}
      </div>`,
  type: (s, c) => `
      ${s.meta ? `<div class="f-meta">${esc(s.meta)}</div>` : ''}
      <div class="f-copy">
        ${s.kicker ? `<div class="f-kick">${esc(s.kicker)}</div>` : ''}
        <h1 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1680, 168, 96)}px">${rich(s.title)}</h1>
      </div>
      <div class="deco f-bar">${s.image ? `<div class="f-bar-photo"><img src="${esc(c.asset(s.image))}" alt=""></div>` : ''}</div>
      ${s.subtitle ? `<p class="f-sub${s.image ? ' has-photo' : ''}" data-slot="subtitle">${rich(s.subtitle)}</p>` : ''}`,
  classic: (s, c) => `
      <div class="deco x-dots"></div>
      <div class="deco x-orb x-orb-a"></div><div class="deco x-orb x-orb-b"></div>
      <div class="x-cover">
        <div class="x-cover-copy">
          ${s.meta ? `<div class="x-meta">${esc(s.meta)}</div>` : ''}
          ${s.kicker ? `<div class="x-kicker">${esc(s.kicker)}</div>` : ''}
          <h1 class="x-cover-title" data-slot="title">${rich(s.title)}</h1>
          <div class="x-rule"></div>
          ${s.subtitle ? `<p class="x-cover-sub" data-slot="subtitle">${rich(s.subtitle)}</p>` : ''}
        </div>
        <div class="x-cover-visual">
          ${s.image
            ? `<div class="x-photo" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div><div class="deco x-photo-frame"></div>`
            : `<div class="deco x-mark is-solo">${esc(s.mark || 'AI')}</div>`}
        </div>
      </div>`,
};

const SECTION = {
  slant: (s, c) => `
      <div class="deco f-band"></div>
      <div class="f-no">${pad2(c.sectionNo)}</div>
      <div class="f-copy">
        <div class="f-kick">SECTION ${pad2(c.sectionNo)}</div>
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 940, 120, 72)}px">${rich(s.title)}</h2>
        ${s.lead ? `<p class="f-sub">${rich(s.lead)}</p>` : ''}
        ${progress(c, 'f-prog')}
      </div>`,
  block: (s, c) => `
      <div class="f-no">${pad2(c.sectionNo)}</div>
      <div class="deco f-rule"></div>
      <div class="f-copy">
        <div class="f-kick">SECTION ${pad2(c.sectionNo)}</div>
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 880, 120, 72)}px">${rich(s.title)}</h2>
        ${s.lead ? `<p class="f-sub">${rich(s.lead)}</p>` : ''}
      </div>
      ${progress(c, 'deco f-prog')}`,
  type: (s, c) => `
      <div class="f-no">${pad2(c.sectionNo)}</div>
      <div class="f-kick">SECTION ${pad2(c.sectionNo)} / ${pad2(c.sectionsTotal)}</div>
      <div class="f-copy">
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1680, 200, 96)}px">${rich(s.title)}</h2>
        ${s.lead ? `<p class="f-sub">${rich(s.lead)}</p>` : ''}
      </div>
      ${progress(c, 'deco f-prog')}`,
  classic: (s, c) => `
      <div class="deco x-section-num">${pad2(c.sectionNo)}</div>
      <div class="deco x-grid-lines"></div>
      <div class="x-section">
        <div class="x-kicker">SECTION ${pad2(c.sectionNo)}</div>
        <h2 class="x-section-title" data-slot="title">${rich(s.title)}</h2>
        <div class="x-rule"></div>
        ${s.lead ? `<p class="x-section-lead">${rich(s.lead)}</p>` : ''}
        <div class="x-progress">${Array.from({ length: c.sectionsTotal }, (_, i) =>
          `<span class="${i + 1 === c.sectionNo ? 'is-on' : ''}">${pad2(i + 1)}</span>`).join('')}</div>
      </div>`,
};

const CLOSING = {
  slant: s => `
      <div class="deco f-band"></div>
      <div class="f-copy">
        <div class="f-kick">— ${esc(s.kicker || 'NEXT STEP')}</div>
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1640, 128, 84)}px">${rich(s.title)}</h2>
        ${s.subtitle ? `<p class="f-sub">${rich(s.subtitle)}</p>` : ''}
      </div>
      ${s.cta ? arrowBtn(s.cta) : ''}
      ${s.contact ? `<div class="f-contact">${esc(s.contact)}</div>` : ''}`,
  block: s => `
      <div class="deco f-light"></div>
      <div class="f-copy${s.cta || s.contact ? '' : ' is-wide'}">
        <div class="f-kick">— ${esc(s.kicker || 'NEXT STEP')}</div>
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, s.cta || s.contact ? 900 : 1640, 104, 72)}px">${rich(s.title)}</h2>
        ${s.subtitle ? `<p class="f-sub">${rich(s.subtitle)}</p>` : ''}
      </div>
      ${s.cta || s.contact ? `<div class="f-card">
        <div class="f-card-label">${s.cta ? 'つぎにすること' : 'お問い合わせ'}</div>
        ${s.cta ? `<div class="f-card-act"><span>${rich(s.cta)}</span>${icon('arrow', 48)}</div>` : ''}
        ${s.contact ? `<div class="f-contact">${esc(s.contact)}</div>` : ''}
      </div>` : ''}`,
  type: s => `
      <div class="f-copy">
        <div class="f-kick">— ${esc(s.kicker || 'NEXT STEP')}</div>
        <h2 class="f-title" data-slot="title" style="font-size:${fitFs(s.title, 1640, 160, 96)}px">${rich(s.title)}</h2>
        ${s.subtitle ? `<p class="f-sub">${rich(s.subtitle)}</p>` : ''}
      </div>
      <div class="f-foot">${s.cta ? arrowBtn(s.cta) : ''}${s.contact ? `<div class="f-contact">${esc(s.contact)}</div>` : ''}</div>`,
  classic: s => `
      <div class="deco x-ghost-word is-dark">NEXT</div>
      <div class="deco x-orb x-orb-c"></div>
      <div class="x-closing">
        <div class="x-kicker">${esc(s.kicker || 'NEXT STEP')}</div>
        <h2 class="x-closing-title" data-slot="title">${rich(s.title)}</h2>
        ${s.subtitle ? `<p class="x-closing-sub">${rich(s.subtitle)}</p>` : ''}
        ${s.cta ? `<div class="x-cta"><span>${rich(s.cta)}</span><span class="x-cta-arrow">${icon('arrow', 44)}</span></div>` : ''}
        ${s.contact ? `<div class="x-contact">${esc(s.contact)}</div>` : ''}
      </div>`,
};
const STYLE = ENUM(['auto', ...FRAME_STYLES], { hint: '表紙・章扉・締めの見た目をこの1枚だけ変える（ふつうは書かない）' });

/* =====================================================================
   型の一覧
   ===================================================================== */
export const LAYOUTS = {

  /* ------------------------------------------------------------------ */
  cover: {
    name: '表紙', family: 'frame', tone: 'light',
    use: 'デッキの1枚目。何の資料で、相手に何の得があるか',
    spec: { kicker: OPT(24), title: T(30, { min: 6, hint: '相手の得が読めるタイトル。2行以内' }), subtitle: OPT(70),
            meta: OPT(30, { hint: '例: 2026.09 ご説明資料' }), image: IMG({ req: false }),
            mark: OPT(4, { hint: '画像が無いときの大きな英字（例: AI）' }), icon: ICON({ hint: '使わない（丸い台座アイコンはやめた。古いデッキの互換のため残している）' }), style: STYLE },
    render: (s, c) => COVER[c.frame || 'classic'](s, c),
  },

  /* ------------------------------------------------------------------ */
  agenda: {
    name: '目次', family: 'frame', tone: 'light',
    use: '5枚を超えるデッキの2枚目。章は3〜6個',
    spec: { kicker: OPT(20), title: T(24), items: LIST(OBJ({ title: T(16), desc: OPT(30) }), 3, 6) },
    render: s => {
      const two = s.items.length > 3;
      return `
      <div class="deco x-dots"></div>
      <div class="deco x-ghost-word">INDEX</div>
      ${head(s)}
      <div class="x-body x-agenda${two ? ' is-two' : ''}" style="--rows:${two ? Math.ceil(s.items.length / 2) : s.items.length}">
        ${s.items.map((it, i) => `
          <div class="x-agenda-item">
            <div class="x-agenda-no">${pad2(i + 1)}</div>
            <div class="x-agenda-text">
              <div class="x-agenda-title">${rich(it.title)}</div>
              ${it.desc ? `<div class="x-agenda-desc">${rich(it.desc)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  section: {
    name: '章扉', family: 'frame', tone: (s, f) => (f === 'type' ? 'light' : f === 'block' ? 'accent' : 'dark'),
    use: '章の切り替わり。目次の章名と同じ言葉にする',
    spec: { title: T(20), lead: OPT(50), style: STYLE },
    render: (s, c) => SECTION[c.frame || 'classic'](s, c),
  },

  /* ------------------------------------------------------------------ */
  problem: {
    name: '課題提起', family: 'text', tone: 'light',
    use: '「困っていること」「なぜ難しいか」を2〜4個。数字か具体場面を入れる',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            items: LIST(OBJ({ head: T(14), body: T(46), stat: OPT(8, { hint: '例: 1,000枚' }), statLabel: OPT(12), icon: ICON() }), 2, 4),
            highlight: NUM({ min: 1, max: 4 }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-problem" style="--n:${s.items.length}">
        ${s.items.map((it, i) => `
          <div class="x-problem-row${s.highlight === i + 1 ? ' is-hl' : ''}" data-box>
            <div class="x-problem-key">
              ${it.stat ? `<div class="x-problem-stat">${numUnit(it.stat)}</div>${it.statLabel ? `<div class="x-problem-statlabel">${esc(it.statLabel)}</div>` : ''}`
                        : `<div class="x-icon-tile">${icon(it.icon || 'alert', 64)}</div>`}
            </div>
            <div class="x-problem-text">
              <h3>${rich(it.head)}</h3>
              <p>${rich(it.body)}</p>
            </div>
            ${s.highlight === i + 1 ? '<div class="x-sticker">いちばんの壁</div>' : ''}
          </div>`).join('')}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  message: {
    name: 'キーメッセージ', family: 'frame', tone: 'dark',
    use: 'いちばん伝えたい一文。根拠の数字を1〜3個添えられる。デッキの山場に',
    spec: { kicker: OPT(24), message: T(40, { min: 6 }), sub: OPT(40),
            evidence: LIST(OBJ({ value: T(8), label: T(22) }), 0, 3, { req: false }) },
    render: s => `
      <div class="deco x-quote-mark">“</div>
      <div class="deco x-orb x-orb-c"></div>
      <div class="x-message${s.evidence?.length ? '' : ' is-solo'}">
        ${s.kicker ? `<div class="x-kicker">${esc(s.kicker)}</div>` : ''}
        <h2 class="x-message-text" data-slot="message">${rich(s.message)}</h2>
        ${s.sub ? `<p class="x-message-sub">${rich(s.sub)}</p>` : ''}
        ${s.evidence?.length ? `<div class="x-evidence" style="--n:${s.evidence.length}">${s.evidence.map(e => `
          <div class="x-evidence-item"><div class="x-evidence-value">${numUnit(e.value)}</div><div class="x-evidence-label">${rich(e.label)}</div></div>`).join('')}</div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  'big-number': {
    name: '巨大数字', family: 'visual', tone: 'light',
    use: '一番伝えたい数字が1つあるとき（実績・削減量・規模）。比較（前→後）を添えると強い',
    spec: { kicker: OPT(24), title: T(28), body: T(80, { min: 20 }), note: OPT(40, { hint: '出典・期間' }),
            value: T(7, { hint: '例: 1,000 / 38 / 3' }), unit: OPT(4, { hint: '例: 枚 / % / 倍' }), label: T(18),
            from: OPT(10), to: OPT(10), ring: NUM({ min: 0, max: 100 }),
            chips: LIST(OBJ({ value: T(7), label: T(14), icon: ICON() }), 0, 2, { req: false }) },
    render: s => {
      const ring = typeof s.ring === 'number';
      const C = 2 * Math.PI * 150;
      return `
      <div class="deco x-dots"></div>
      <div class="deco x-ghost-num">${esc(s.value)}</div>
      ${head(s)}
      <div class="x-body x-bignum">
        <div class="x-bignum-copy">
          <p class="x-bignum-body">${rich(s.body)}</p>
          ${s.chips?.length ? `<div class="x-chips">${s.chips.map(ch => `
            <div class="x-chip">${ch.icon ? `<span class="x-chip-ico">${icon(ch.icon, 34)}</span>` : ''}<span class="x-chip-v">${esc(ch.value)}</span><span class="x-chip-l">${esc(ch.label)}</span></div>`).join('')}</div>` : ''}
          ${s.note ? `<div class="x-note">※ ${esc(s.note)}</div>` : ''}
        </div>
        <div class="x-hero" data-visual>
          <div class="x-sticker is-tilt">${esc(s.label)}</div>
          <div class="x-hero-main${ring ? ' has-ring' : ''}">
            ${ring ? `<svg class="x-ring" viewBox="0 0 340 340" aria-hidden="true">
                <circle cx="170" cy="170" r="150" class="x-ring-bg"/>
                <circle cx="170" cy="170" r="150" class="x-ring-fg" stroke-dasharray="${(C * s.ring / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>` : ''}
            <div class="x-hero-value">${numUnit(s.value, s.unit)}</div>
          </div>
          ${s.from && s.to ? `<div class="x-fromto"><span class="x-from">${esc(s.from)}</span><span class="x-arrow">${icon('arrow', 56)}</span><span class="x-to">${esc(s.to)}</span></div>` : ''}
        </div>
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  compare: {
    name: '比較', family: 'visual', tone: 'light',
    use: 'Before→After（mode=before-after）／A vs B（versus）／役割分担など対等な2つ（split）',
    spec: { kicker: OPT(24), title: T(30), lead: OPT(56), mode: ENUM(['before-after', 'versus', 'split']),
            left: OBJ({ label: T(16), value: OPT(8), items: LIST(T(26), 2, 5) }),
            right: OBJ({ label: T(16), value: OPT(8), items: LIST(T(26), 2, 5) }),
            verdict: OPT(36) },
    render: s => {
      const mode = s.mode || 'before-after';
      const side = (p, cls, mark) => `
        <div class="x-side ${cls}" data-box>
          <div class="x-side-label">${rich(p.label)}</div>
          ${p.value ? `<div class="x-side-value">${numUnit(p.value)}</div>` : ''}
          <ul>${p.items.map(t => `<li><span class="x-li-mark">${mark}</span><span>${rich(t)}</span></li>`).join('')}</ul>
        </div>`;
      const leftMark = mode === 'before-after' ? icon('alert', 34) : mode === 'split' ? icon('robot', 34) : '•';
      const rightMark = mode === 'split' ? icon('person', 34) : icon('check', 34);
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-compare is-${mode}" data-visual>
        <div class="x-compare-grid">
          ${side(s.left, 'is-left', leftMark)}
          ${mode === 'split' ? '' : `<div class="x-compare-mid">${mode === 'versus' ? '<span class="x-vs">VS</span>' : icon('arrow', 72)}</div>`}
          ${side(s.right, 'is-right', rightMark)}
        </div>
        ${s.verdict ? `<div class="x-verdict">${icon('flag', 40)}<span>${rich(s.verdict)}</span></div>` : ''}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  flow: {
    name: '手順フロー', family: 'visual', tone: 'light',
    use: '順番のある手順・処理の流れ（3〜5段）。最後にゴールを置ける',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            steps: LIST(OBJ({ head: T(12), body: T(40), tag: OPT(12), icon: ICON() }), 3, 5),
            highlight: NUM({ min: 1, max: 5 }), goal: OPT(28) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-flow" style="--n:${s.steps.length}" data-visual>
        <div class="x-flow-track"><div class="x-flow-line"></div>
          ${s.steps.map((st, i) => `<div class="x-flow-node${s.highlight === i + 1 ? ' is-hl' : ''}">${st.icon ? `${icon(st.icon, 50)}<b class="x-node-no">${i + 1}</b>` : `<span>${i + 1}</span>`}</div>`).join('')}
        </div>
        <div class="x-flow-cols">
          ${s.steps.map((st, i) => `
            <div class="x-flow-step${s.highlight === i + 1 ? ' is-hl' : ''}" data-box>
              ${s.steps.length <= 3 ? `<div class="x-step-no">STEP ${pad2(i + 1)}</div>` : ''}
              <h3>${rich(st.head)}</h3>
              <p>${rich(st.body)}</p>
              ${st.tag ? `<div class="x-tag">${esc(st.tag)}</div>` : ''}
              <div class="deco x-bigclip" aria-hidden="true"><div class="x-bignum" data-fill>${pad2(i + 1)}</div></div>
            </div>`).join('')}
        </div>
        ${s.goal ? `<div class="x-goal"><span class="x-goal-label">GOAL</span><span>${rich(s.goal)}</span></div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  timeline: {
    name: 'ロードマップ', family: 'visual', tone: 'light',
    use: '時期のある予定・フェーズ（3〜5個）。現在地を now で示す',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            items: LIST(OBJ({ when: T(10), head: T(14), body: T(36) }), 3, 5), now: NUM({ min: 1, max: 5 }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-timeline" style="--n:${s.items.length}" data-visual>
        <div class="x-tl-axis"><div class="x-tl-fill" style="--p:${s.now ? ((s.now - 0.5) / s.items.length) : 0}"></div></div>
        <div class="x-tl-cols">
          ${s.items.map((it, i) => {
            const st = s.now ? (i + 1 < s.now ? 'is-done' : i + 1 === s.now ? 'is-now' : 'is-next') : 'is-next';
            return `
            <div class="x-tl-item ${st}">
              <div class="x-tl-when">${esc(it.when)}${st === 'is-now' ? '<span class="x-pill">いまここ</span>' : ''}</div>
              <div class="x-tl-dot">${st === 'is-done' ? icon('check', 30) : ''}</div>
              <h3>${rich(it.head)}</h3>
              <p>${rich(it.body)}</p>
              <div class="deco x-bignum" data-fill aria-hidden="true">${pad2(i + 1)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  features: {
    name: '特徴・決めごと', family: 'cardish', tone: 'light',
    use: '順序のない要点3〜4個（強み・ルール・安全策）。各項目にアイコン必須。多用禁止（本文の25%まで）',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            items: LIST(OBJ({ icon: ICON({ req: true }), head: T(14), body: T(44), stat: OPT(8) }), 3, 4),
            highlight: NUM({ min: 1, max: 4 }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-features" style="--n:${s.items.length}">
        ${s.items.map((it, i) => `
          <div class="x-feature${s.highlight === i + 1 ? ' is-hl' : ''}" data-box>
            <div class="x-feature-top">
              <div class="x-icon-tile">${icon(it.icon, 60)}</div>
              <div class="x-feature-no">${pad2(i + 1)}</div>
            </div>
            <h3>${rich(it.head)}</h3>
            <p>${rich(it.body)}</p>
            ${it.stat ? `<div class="x-feature-stat">${numUnit(it.stat)}</div>` : ''}
          </div>`).join('')}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  screenshot: {
    name: '画面紹介', family: 'visual', tone: 'light',
    use: '実際の画面を見せる。画像ファイルが無いときは使えない（別の型を選ぶ）',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), image: IMG({ req: true }), url: OPT(40),
            points: LIST(OBJ({ head: T(14), body: T(40) }), 2, 3) },
    render: (s, c) => `
      <div class="deco x-dots"></div>
      <div class="deco x-orb x-orb-d"></div>
      ${head(s)}
      <div class="x-body x-shot">
        <ol class="x-shot-points">
          ${s.points.map((p, i) => `<li><span class="x-num-dot">${i + 1}</span><div><h3>${rich(p.head)}</h3><p>${rich(p.body)}</p></div></li>`).join('')}
        </ol>
        <div class="x-browser" data-visual>
          <div class="x-browser-bar"><i></i><i></i><i></i><span>${esc(s.url || '')}</span></div>
          <div class="x-browser-view"><img src="${esc(c.asset(s.image))}" alt=""></div>
        </div>
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  bars: {
    name: 'グラフ（棒）', family: 'visual', tone: 'light',
    use: '数量を比べる・推移を見せる（2〜6本）。言いたい棒を highlight、結論を takeaway に。数字は実数だけ',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), mode: ENUM(['bar', 'column'], { hint: 'bar=横棒（項目の比較） / column=縦棒（時期の推移）' }),
            unit: OPT(4, { hint: '例: 時間 / 件 / %' }),
            items: LIST(OBJ({ label: T(12), value: NUM({ min: 0, max: 1e12, req: true }), display: OPT(10, { hint: '棒に出す文字。省略時は value＋unit' }) }), 2, 6),
            highlight: NUM({ min: 1, max: 6 }), takeaway: OPT(40, { hint: 'グラフから言えること。例: 月40時間が8時間に' }), note: OPT(40, { hint: '出典・期間' }) },
    render: s => {
      const mode = s.mode || 'bar';
      const max = Math.max(...s.items.map(it => it.value)) || 1;
      const show = it => it.display || `${it.value.toLocaleString('ja-JP')}${s.unit || ''}`;
      const hl = s.highlight ? s.items[s.highlight - 1] : null;
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-bars is-${mode}${s.takeaway ? ' has-take' : ''}" style="--n:${s.items.length}">
        <div class="x-chart-wrap">
        <div class="x-chart" data-visual>
          ${s.items.map((it, i) => `
            <div class="x-bar-row${s.highlight === i + 1 ? ' is-hl' : ''}" style="--p:${Math.max(it.value / max, 0.04).toFixed(3)}">
              <div class="x-bar-label">${rich(it.label)}</div>
              <div class="x-bar-track"><div class="x-bar-fill"></div><div class="x-bar-value">${esc(show(it))}</div></div>
            </div>`).join('')}
        </div>
          ${s.note ? `<div class="x-note x-chart-note">※ ${esc(s.note)}</div>` : ''}
        </div>
        ${s.takeaway ? `
        <div class="x-take">
          ${hl ? `<div class="x-take-value">${numUnit(show(hl))}</div><div class="x-take-label">${rich(hl.label)}</div>` : `<div class="x-take-ico">${icon('bar-chart', 90)}</div>`}
          <div class="x-take-rule"></div>
          <p class="x-take-text">${rich(s.takeaway)}</p>
        </div>` : ''}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  line: {
    name: 'グラフ（折れ線）', family: 'visual', tone: 'light',
    use: '時期ごとの推移を線で見せる（3〜12点・線は2本まで）。言いたい点を highlight、結論を takeaway に。数字は実数だけ',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), unit: OPT(4, { hint: '例: 件 / 万円 / %' }),
            labels: LIST(T(6, { hint: '例: 4月 / 2025年' }), 3, 12),
            series: LIST(OBJ({ name: T(10, { hint: '線が2本のときの名前。例: 電話 / LINE' }), values: LIST(NUM({ min: -1e12, max: 1e12, req: true }), 3, 12) }), 1, 2),
            highlight: NUM({ min: 1, max: 12, hint: '1本目の線で言いたい点の番号' }), takeaway: OPT(40, { hint: 'グラフから言えること。例: 半年で電話が半分に' }), note: OPT(40, { hint: '出典・期間' }) },
    render: s => {
      const n = s.labels.length, two = s.series.length > 1, unit = s.unit || '';
      const all = s.series.flatMap(se => se.values);
      const { lo, hi, ticks } = niceScale(Math.min(0, ...all), Math.max(0, ...all));
      const X = i => (n === 1 ? 50 : (i / (n - 1)) * 100), Y = v => ((v - lo) / (hi - lo)) * 100;
      const num = v => `${v.toLocaleString('ja-JP')}${unit}`;
      const hl = s.highlight ? s.highlight - 1 : -1;
      const ends = s.series.map(se => Y(se.values[n - 1]));
      // 終点のラベル（数字＋線の名前で2行）が重ならないよう、近ければ上下に離す
      if (two && Math.abs(ends[0] - ends[1]) < 26) { const up = ends[0] >= ends[1] ? 0 : 1, mid = (ends[0] + ends[1]) / 2; ends[up] = mid + 13; ends[1 - up] = mid - 13; }
      const showX = i => n <= 8 || (n - 1 - i) % 2 === 0 || i === hl;
      const pts = se => se.values.map((v, i) => `${(X(i) * 10).toFixed(1)},${(1000 - Y(v) * 10).toFixed(1)}`).join(' ');
      const main = s.series[0], hv = hl >= 0 ? main.values[hl] : main.values[n - 1];
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-line${s.takeaway ? ' has-take' : ''}">
        <div class="x-chart-wrap">
          ${two ? `<div class="x-line-legend">${s.series.map((se, k) => `<span class="is-s${k + 1}"><i></i>${esc(se.name)}</span>`).join('')}</div>` : ''}
          <div class="x-line-chart" data-visual>
            <div class="x-line-plot">
              ${ticks.map(t => `<div class="x-line-tick${t === 0 ? ' is-zero' : ''}" style="bottom:${Y(t).toFixed(2)}%"><span class="x-axis">${t.toLocaleString('ja-JP')}</span></div>`).join('')}
              ${unit ? `<div class="x-line-unit x-axis">（${esc(unit)}）</div>` : ''}
              <svg class="x-line-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                <polygon class="x-line-area" points="0,${(1000 - Y(Math.max(lo, 0)) * 10).toFixed(1)} ${pts(main)} 1000,${(1000 - Y(Math.max(lo, 0)) * 10).toFixed(1)}"/>
                ${s.series.map((se, k) => `<polyline class="x-line-path is-s${k + 1}" points="${pts(se)}" vector-effect="non-scaling-stroke"/>`).reverse().join('')}
              </svg>
              ${s.series.map((se, k) => se.values.map((v, i) => `<i class="x-line-dot is-s${k + 1}${k === 0 && i === hl ? ' is-hl' : ''}" style="left:${X(i).toFixed(2)}%;bottom:${Y(v).toFixed(2)}%"></i>`).join('')).reverse().join('')}
              ${hl >= 0 && hl < n - 1 ? `<div class="x-line-flag" style="left:${X(hl).toFixed(2)}%;bottom:${Y(main.values[hl]).toFixed(2)}%">${numUnit(num(main.values[hl]))}</div>` : ''}
              ${s.series.map((se, k) => `<div class="x-line-end is-s${k + 1}${k === 0 ? (hl === n - 1 || hl < 0 ? ' is-hl' : '') : ''}" style="bottom:${ends[k].toFixed(2)}%"><span class="x-line-val">${numUnit(num(se.values[n - 1]))}</span>${two ? `<span class="x-line-name x-axis">${esc(se.name)}</span>` : ''}</div>`).join('')}
            </div>
            <div class="x-line-x">${s.labels.map((l, i) => showX(i) ? `<span class="x-axis${i === hl ? ' is-hl' : ''}" style="left:${X(i).toFixed(2)}%">${esc(l)}</span>` : '').join('')}</div>
          </div>
          ${s.note ? `<div class="x-note x-chart-note">※ ${esc(s.note)}</div>` : ''}
        </div>
        ${s.takeaway ? `
        <div class="x-take">
          <div class="x-take-value">${numUnit(num(hv))}</div><div class="x-take-label">${esc(s.labels[hl >= 0 ? hl : n - 1])}${two ? `・${esc(main.name)}` : ''}</div>
          <div class="x-take-rule"></div>
          <p class="x-take-text">${rich(s.takeaway)}</p>
        </div>` : ''}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  donut: {
    name: '内訳（ドーナツ・帯）', family: 'visual', tone: 'light',
    use: '1つの全体を2〜5つに分けた割合を見せる。言いたい1つを highlight（中央に大きく出る）。近い値どうしを比べたいなら bars',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), mode: ENUM(['donut', 'stack'], { hint: 'donut=円（既定） / stack=横の帯（項目名が長い・横長に見せたい）' }),
            unit: OPT(4, { hint: '値の単位。例: 件 / 人。割合をそのまま書くなら %' }),
            items: LIST(OBJ({ label: T(12), value: NUM({ min: 0, max: 1e12, req: true }), display: OPT(10, { hint: '割合の下に出す実数。省略時は value＋unit' }) }), 2, 5),
            highlight: NUM({ min: 1, max: 5, hint: '省略時は一番大きい項目' }), center: OPT(8, { hint: '円の中央の文字。省略時は highlight の割合' }), centerLabel: OPT(10),
            takeaway: OPT(40), note: OPT(40, { hint: '出典・期間・母数' }) },
    render: s => {
      const vals = s.items.map(it => it.value), total = vals.reduce((a, b) => a + b, 0) || 1;
      const pct = roundTo100(vals.map(v => (v / total) * 100));
      const hl = s.highlight ? s.highlight - 1 : vals.indexOf(Math.max(...vals));
      const SHADES = [46, 32, 22, 15], stack = s.mode === 'stack';
      // 帯は主役の上に割合の文字を載せるので、白文字を載せる前提の濃い塗り（--acc-fill）にする
      let r = 0; const col = s.items.map((_, i) => i === hl ? (stack ? 'var(--acc-fill)' : 'var(--acc)') : `color-mix(in srgb, var(--fg) ${SHADES[r++]}%, var(--surface))`);
      const raw = it => s.unit === '%' ? '' : (it.display || `${it.value.toLocaleString('ja-JP')}${s.unit || ''}`);
      const R = 80, C = 2 * Math.PI * R, GAP = s.items.length > 1 ? 1.6 : 0;
      let acc = 0;
      const segs = s.items.map((it, i) => { const len = (it.value / total) * C, off = acc; acc += len;
        return `<circle class="x-donut-seg" cx="100" cy="100" r="${R}" stroke="${col[i]}" stroke-dasharray="${Math.max(len - GAP, 0.01).toFixed(2)} ${(C - Math.max(len - GAP, 0.01)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; }).join('');
      const legend = `<ol class="x-donut-legend${stack ? ' is-row' : ''}">${s.items.map((it, i) => `
          <li${i === hl ? ' class="is-hl"' : ''}><i class="x-donut-sw" style="background:${col[i]}"></i><span class="x-donut-lb">${rich(it.label)}</span><b class="x-donut-pc">${pct[i]}<small>%</small></b>${raw(it) ? `<span class="x-donut-raw">${esc(raw(it))}</span>` : ''}</li>`).join('')}</ol>`;
      const chart = stack
        ? `<div class="x-stack-wrap"><div class="x-stack" data-visual>${s.items.map((it, i) => `<div class="x-stack-seg${i === hl ? ' is-hl' : ''}" style="flex:${Math.max(it.value, total * 0.005)};background:${col[i]}">${i === hl ? `<span>${pct[i]}<small>%</small></span>` : ''}</div>`).join('')}</div>${legend}</div>`
        : `<div class="x-donut-chart" data-visual><svg viewBox="0 0 200 200" aria-hidden="true">${segs}</svg>
            <div class="x-donut-center"><div class="x-donut-cv">${s.center ? numUnit(s.center) : `<span class="x-n">${pct[hl]}</span><span class="x-u">%</span>`}</div><div class="x-donut-cl">${esc(s.centerLabel || plain(s.items[hl].label))}</div></div>
          </div>${legend}`;
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-donut${stack ? ' is-stack' : ''}${s.takeaway ? ' has-take' : ''}" style="--n:${s.items.length}">
        ${chart}
        ${s.takeaway ? `<div class="x-take"><div class="x-take-value">${numUnit(`${pct[hl]}%`)}</div><div class="x-take-label">${rich(s.items[hl].label)}</div><div class="x-take-rule"></div><p class="x-take-text">${rich(s.takeaway)}</p></div>` : ''}
      </div>
      ${s.note ? `<div class="x-note x-chart-note x-donut-note">※ ${esc(s.note)}</div>` : ''}`;
    },
  },

  /* ------------------------------------------------------------------ */
  gallery: {
    name: '画像を並べる', family: 'cardish', tone: 'light',
    use: '実物の写真・画面・作品を2〜6枚並べる（制作事例・店内・導入先の様子）。画像ファイルが無いときは使えない。1枚を主役にするなら highlight',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            items: LIST(OBJ({ image: IMG({ req: true }), head: T(14), body: OPT(30, { hint: '4枚以下のときだけ書ける' }) }), 2, 6),
            highlight: NUM({ min: 1, max: 6, hint: '3枚・5枚のとき主役が大きくなる' }) },
    render: (s, c) => {
      const n = s.items.length, hl = s.highlight ? s.highlight - 1 : (n === 5 ? 0 : -1);
      const feature = hl >= 0 && (n === 3 || n === 5);
      const order = feature ? [hl, ...s.items.map((_, i) => i).filter(i => i !== hl)] : s.items.map((_, i) => i);
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-gallery is-n${n}${feature ? ' is-feature' : ''}">
        ${order.map(i => { const it = s.items[i]; return `
        <figure class="x-gal-item${i === hl ? ' is-hl' : ''}">
          <div class="x-gal-img" data-visual style="--src:url('${esc(c.asset(it.image))}')"><img src="${esc(c.asset(it.image))}" alt=""></div>
          <figcaption><h3>${rich(it.head)}</h3>${it.body ? `<p>${rich(it.body)}</p>` : ''}</figcaption>
        </figure>`; }).join('')}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  phone: {
    name: 'スマホ画面', family: 'visual', tone: 'light',
    use: 'スマホの画面（アプリ・LINE・予約画面）を見せる。縦長の画面の画像ファイルが無いときは使えない。2画面目は image2',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), image: IMG({ req: true }), image2: IMG({ req: false }),
            points: LIST(OBJ({ head: T(14), body: T(40) }), 2, 3) },
    render: (s, c) => {
      const dev = (img, cls = '') => `<div class="x-device${cls}"><div class="x-device-screen"><img src="${esc(c.asset(img))}" alt=""></div><i class="x-device-island"></i></div>`;
      return `
      <div class="deco x-dots"></div>
      <div class="deco x-orb x-orb-d"></div>
      ${head(s)}
      <div class="x-body x-phone${s.image2 ? ' is-two' : ''}">
        <ol class="x-shot-points">
          ${s.points.map((p, i) => `<li><span class="x-num-dot">${i + 1}</span><div><h3>${rich(p.head)}</h3><p>${rich(p.body)}</p></div></li>`).join('')}
        </ol>
        <div class="x-phones" data-visual>${dev(s.image)}${s.image2 ? dev(s.image2, ' is-back') : ''}</div>
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  table: {
    name: '表', family: 'visual', tone: 'light',
    use: '2〜4つを3つ以上の観点で見比べる（プラン・方式・条件の一覧）。セルは短い言葉か ○ △ ×。highlight で推す列',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), columns: LIST(T(12), 2, 4, { hint: '列の見出し（比べる対象）' }),
            rows: LIST(OBJ({ label: T(12), cells: LIST(T(18), 2, 4, { hint: 'columns と同じ個数' }) }), 2, 6),
            highlight: NUM({ min: 1, max: 4 }), note: OPT(40) },
    render: s => {
      const mark = t => ({ '○': 'is-ok', '◯': 'is-ok', '◎': 'is-best', '△': 'is-mid', '×': 'is-ng', '✕': 'is-ng' })[t.trim()];
      const cell = (t, j) => {
        const m = mark(t);
        const hl = s.highlight === j + 1 ? ' is-hl' : '';
        return m ? `<div class="x-td x-td-mark ${m}${hl}"><span>${esc(t.trim())}</span></div>` : `<div class="x-td${hl}"><span>${rich(t)}</span></div>`;
      };
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-table-wrap">
        <div class="x-table" style="--cols:${s.columns.length};--rows:${s.rows.length}" data-visual>
          <div class="x-th x-th-corner"></div>
          ${s.columns.map((c, j) => `<div class="x-th${s.highlight === j + 1 ? ' is-hl' : ''}">${s.highlight === j + 1 ? '<span class="x-pill">おすすめ</span>' : ''}<span>${rich(c)}</span></div>`).join('')}
          ${s.rows.map(r => `<div class="x-td x-td-label"><span>${rich(r.label)}</span></div>${r.cells.map(cell).join('')}`).join('')}
        </div>
        ${s.note ? `<div class="x-note">※ ${esc(s.note)}</div>` : ''}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  pricing: {
    name: '料金プラン', family: 'text', tone: 'light',
    use: '料金・プランを2〜3個。おすすめを recommend で1つ強調。金額は決まっている実際の数字だけ',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            plans: LIST(OBJ({ name: T(12), price: T(10, { hint: '例: 220,000' }), unit: OPT(10, { hint: '例: 円（税込）' }), desc: OPT(30), items: LIST(T(22), 2, 5) }), 2, 3),
            recommend: NUM({ min: 1, max: 3 }), note: OPT(50) },
    render: s => `
      <div class="deco x-dots"></div>
      <div class="deco x-orb x-orb-d"></div>
      ${head(s)}
      <div class="x-body x-pricing" style="--n:${s.plans.length}">
        <div class="x-plans">
          ${s.plans.map((p, i) => `
            <div class="x-plan${s.recommend === i + 1 ? ' is-rec' : ''}" data-box>
              ${s.recommend === i + 1 ? '<div class="x-sticker">おすすめ</div>' : ''}
              <div class="x-plan-name">${rich(p.name)}</div>
              <div class="x-plan-price"><span class="x-plan-num">${esc(p.price)}</span>${p.unit ? `<span class="x-plan-unit">${esc(p.unit)}</span>` : ''}</div>
              ${p.desc ? `<p class="x-plan-desc">${rich(p.desc)}</p>` : ''}
              <ul>${p.items.map(t => `<li><span class="x-li-mark">${icon('check', 30)}</span><span>${rich(t)}</span></li>`).join('')}</ul>
            </div>`).join('')}
        </div>
        ${s.note ? `<div class="x-note">※ ${esc(s.note)}</div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  pyramid: {
    name: '構造図（ピラミッド）', family: 'visual', tone: 'light',
    use: '土台の上に積み上がる関係・階層（3〜5段）。上から順に書く（上ほど目的・少数、下ほど土台）',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            layers: LIST(OBJ({ head: T(12), body: T(40) }), 3, 5, { hint: '上の段から順に' }), highlight: NUM({ min: 1, max: 5 }) },
    render: s => {
      const n = s.layers.length;
      const w = t => 0.26 + 0.74 * t;          // 上端でも番号が入る幅を残す
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-pyramid" style="--n:${n}" data-visual>
        ${s.layers.map((ly, i) => {
          const a = w(i / n), b = w((i + 1) / n);
          const poly = `${(50 - a * 50).toFixed(2)}% 0, ${(50 + a * 50).toFixed(2)}% 0, ${(50 + b * 50).toFixed(2)}% 100%, ${(50 - b * 50).toFixed(2)}% 100%`;
          return `
          <div class="x-pyr-row${s.highlight === i + 1 ? ' is-hl' : ''}" style="--i:${i}">
            <div class="x-pyr-shape" style="clip-path:polygon(${poly})"><span>${pad2(i + 1)}</span></div>
            <div class="x-pyr-line"></div>
            <div class="x-pyr-text"><h3>${rich(ly.head)}</h3><p>${rich(ly.body)}</p></div>
          </div>`;
        }).join('')}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  matrix: {
    name: '2×2マトリクス', family: 'visual', tone: 'light',
    use: '2つの軸で4つに分ける（位置づけ・優先順位・狙う所）。cells は 左上→右上→左下→右下 の順',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            x: OBJ({ label: T(10), low: T(8), high: T(8) }), y: OBJ({ label: T(10), low: T(8), high: T(8) }),
            cells: LIST(OBJ({ head: T(12), body: T(30) }), 4, 4, { hint: '左上・右上・左下・右下' }), highlight: NUM({ min: 1, max: 4 }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-matrix" data-visual>
        <div class="x-mx-y"><span>${esc(s.y.high)}</span><b>${esc(s.y.label)}</b><span>${esc(s.y.low)}</span></div>
        <div class="x-mx-grid">
          ${s.cells.map((c, i) => `
            <div class="x-mx-cell${s.highlight === i + 1 ? ' is-hl' : ''}" data-box>
              ${s.highlight === i + 1 ? '<div class="x-sticker">ここを狙う</div>' : ''}
              <h3>${rich(c.head)}</h3><p>${rich(c.body)}</p>
            </div>`).join('')}
          <div class="deco x-mx-cross"></div>
        </div>
        <div class="x-mx-x"><span>${esc(s.x.low)}</span><b>${esc(s.x.label)}</b><span>${esc(s.x.high)}</span></div>
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  funnel: {
    name: 'ファネル', family: 'visual', tone: 'light',
    use: '段階ごとに数が絞られていく流れ（認知→問い合わせ→成約など3〜5段）。数字は実数だけ',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            stages: LIST(OBJ({ label: T(10), value: OPT(10, { hint: '例: 1,200人 / 38%' }), body: T(36) }), 3, 5),
            highlight: NUM({ min: 1, max: 5 }) },
    render: s => {
      const n = s.stages.length;
      return `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-funnel" style="--n:${n}" data-visual>
        ${s.stages.map((st, i) => `
          <div class="x-fn-row${s.highlight === i + 1 ? ' is-hl' : ''}">
            <div class="x-fn-lane"><div class="x-fn-bar" style="--w:${(1 - i * (0.5 / Math.max(n - 1, 1))).toFixed(3)}">${st.value ? `<span class="x-fn-value">${numUnit(st.value)}</span>` : `<span class="x-fn-no">${pad2(i + 1)}</span>`}</div></div>
            <div class="x-fn-text"><h3>${rich(st.label)}</h3><p>${rich(st.body)}</p></div>
          </div>`).join('')}
      </div>`;
    },
  },

  /* ------------------------------------------------------------------ */
  testimonial: {
    name: 'お客様の声・事例', family: 'text', tone: 'light',
    use: '実在の利用者の声・導入事例。発言は本人の言葉のまま（作らない）。成果の数字があれば results に',
    spec: { kicker: OPT(24), title: T(28), quote: T(90, { min: 10 }), name: T(20, { hint: '許可を取った表記。例: A治療院 院長' }),
            role: OPT(30), image: IMG({ req: false }),
            results: LIST(OBJ({ value: T(8), label: T(16) }), 0, 3, { req: false }) },
    render: (s, c) => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-voice${s.results?.length ? ' has-results' : ''}">
        <div class="x-voice-card" data-box>
          <div class="deco x-voice-mark">“</div>
          <p class="x-voice-quote">${rich(s.quote)}</p>
          <div class="x-voice-who">
            ${s.image ? `<div class="x-avatar" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div>` : `<div class="x-avatar is-icon">${icon('person', 56)}</div>`}
            <div><div class="x-voice-name">${esc(s.name)}</div>${s.role ? `<div class="x-voice-role">${esc(s.role)}</div>` : ''}</div>
          </div>
        </div>
        ${s.results?.length ? `<div class="x-results" data-visual>${s.results.map(r => `
          <div class="x-result"><div class="x-result-value">${numUnit(r.value)}</div><div class="x-result-label">${rich(r.label)}</div></div>`).join('')}</div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  profile: {
    name: 'プロフィール', family: 'text', tone: 'light',
    use: '話し手・会社・担当者の紹介。実績の数字と肩書きは事実だけ',
    spec: { kicker: OPT(24), title: T(20, { hint: '例: 講師紹介 / 私たちについて' }), name: T(16), role: T(30),
            image: IMG({ req: false }), bio: T(100, { min: 20 }),
            facts: LIST(OBJ({ value: T(8), label: T(16) }), 0, 3, { req: false }), tags: LIST(T(12), 0, 4, { req: false }) },
    render: (s, c) => `
      <div class="deco x-dots"></div>
      <div class="deco x-ghost-word">PROFILE</div>
      ${head(s)}
      <div class="x-body x-profile">
        <div class="x-profile-visual">
          ${s.image ? `<div class="x-portrait" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div><div class="deco x-photo-frame"></div>`
                    : `<div class="x-monogram"><span>${esc([...String(s.name).replace(/\s/g, '')][0] || '')}</span></div>`}
        </div>
        <div class="x-profile-copy">
          <div class="x-profile-role">${esc(s.role)}</div>
          <div class="x-profile-name">${esc(s.name)}</div>
          ${s.tags?.length ? `<div class="x-tags">${s.tags.map(t => `<span class="x-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <p class="x-profile-bio">${rich(s.bio)}</p>
          ${s.facts?.length ? `<div class="x-facts" style="--n:${s.facts.length}">${s.facts.map(f => `
            <div class="x-fact"><div class="x-fact-value">${numUnit(f.value)}</div><div class="x-fact-label">${rich(f.label)}</div></div>`).join('')}</div>` : ''}
        </div>
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  photo: {
    name: '写真＋メッセージ', family: 'frame', tone: 'dark',
    use: '実物の写真1枚で空気・現場を伝える山場。写真ファイルが無いときは使えない（message を使う）',
    spec: { kicker: OPT(24), message: T(26, { min: 6, hint: '1行14字×2行まで' }), sub: OPT(50), image: IMG({ req: true }), credit: OPT(30) },
    render: (s, c) => `
      <div class="x-photo-bg" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div>
      <div class="deco x-photo-scrim"></div>
      <div class="x-photo-copy">
        ${s.kicker ? `<div class="x-kicker">${esc(s.kicker)}</div>` : ''}
        <h2 class="x-photo-message" data-slot="message">${rich(s.message)}</h2>
        ${s.sub ? `<p class="x-photo-sub">${rich(s.sub)}</p>` : ''}
        ${s.credit ? `<div class="x-note">${esc(s.credit)}</div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  faq: {
    name: 'よくある質問', family: 'text', tone: 'light',
    use: '導入前の不安に先回りして答える（2〜4問）。答えは結論から書く',
    spec: { kicker: OPT(24), title: T(28), items: LIST(OBJ({ q: T(30), a: T(64) }), 2, 4) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-faq" style="--n:${s.items.length}">
        ${s.items.map(it => `
          <div class="x-faq-item" data-box>
            <div class="x-faq-q"><span class="x-qa is-q">Q</span><h3>${rich(it.q)}</h3></div>
            <div class="x-faq-a"><span class="x-qa is-a">A</span><p>${rich(it.a)}</p></div>
          </div>`).join('')}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  summary: {
    name: 'まとめ', family: 'text', tone: 'light',
    use: '締めの直前に要点を3〜4個で振り返る。各要点は言い切りの一文',
    spec: { kicker: OPT(24), title: T(24), points: LIST(OBJ({ head: T(20), body: OPT(40) }), 3, 4), next: OPT(30, { hint: '次にしてほしいこと' }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-summary" style="--n:${s.points.length}">
        <div class="x-sum-panel" data-box>
          <div class="x-sum-count"><span class="x-n">${s.points.length}</span><span class="x-u">つの要点</span></div>
          ${s.next ? `<div class="x-sum-next"><span class="x-sum-next-label">NEXT</span><span>${rich(s.next)}</span></div>` : ''}
        </div>
        <ol class="x-sum-list">
          ${s.points.map((p, i) => `
            <li><span class="x-sum-no">${pad2(i + 1)}</span><div><h3>${rich(p.head)}</h3>${p.body ? `<p>${rich(p.body)}</p>` : ''}</div></li>`).join('')}
        </ol>
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  stats: {
    name: '数字で見る', family: 'visual', tone: 'light',
    use: '主役の数字が2〜4個並ぶとき（会社の規模・KPI・実績）。1つだけなら big-number。数字は実数だけ',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56),
            items: LIST(OBJ({ value: T(8, { hint: '例: 1,200社 / 98%' }), label: T(16), note: OPT(24, { hint: '前年比・期間など' }), icon: ICON() }), 2, 4),
            highlight: NUM({ min: 1, max: 4 }), note: OPT(40, { hint: '出典・時点' }) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-stats" style="--n:${s.items.length}">
        <div class="x-stats-grid" data-visual>
          ${s.items.map((it, i) => `
            <div class="x-stat${s.highlight === i + 1 ? ' is-hl' : ''}" data-box>
              ${it.icon ? `<div class="x-stat-ico">${icon(it.icon, 44)}</div>` : ''}
              <div class="x-stat-value">${numUnit(it.value)}</div>
              <div class="x-stat-label">${rich(it.label)}</div>
              ${it.note ? `<div class="x-stat-note">${esc(it.note)}</div>` : ''}
            </div>`).join('')}
        </div>
        ${s.note ? `<div class="x-note">※ ${esc(s.note)}</div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  spec: {
    name: '概要（項目と内容）', family: 'text', tone: 'light',
    use: '会社概要・開催概要・募集要項など「項目：内容」の一覧（3〜7行）。行ごとに短く',
    spec: { kicker: OPT(24), title: T(24), rows: LIST(OBJ({ key: T(8, { hint: '例: 日時 / 所在地' }), value: T(40) }), 3, 7),
            icon: ICON({ hint: '使わない（丸い台座アイコンはやめた。古いデッキの互換のため残している）' }), image: IMG({ req: false }), cta: OPT(24, { hint: '申し込み方法など1行' }) },
    render: (s, c) => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-spec${s.image ? ' has-side' : ''}" style="--n:${s.rows.length}">
        <dl class="x-spec-list">
          ${s.rows.map(r => `<div class="x-spec-row"><dt>${esc(r.key)}</dt><dd>${rich(r.value)}</dd></div>`).join('')}
        </dl>
        ${s.image ? `<div class="x-spec-side"><div class="x-photo" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div></div>` : ''}
      </div>
      ${s.cta ? `<div class="x-spec-cta">${icon('arrow', 36)}<span>${rich(s.cta)}</span></div>` : ''}`,
  },

  /* ------------------------------------------------------------------ */
  team: {
    name: 'チーム紹介', family: 'text', tone: 'light',
    use: '2〜4人のメンバー紹介。1人だけなら profile。肩書き・経歴は事実だけ。写真が無ければ頭文字の丸になる',
    spec: { kicker: OPT(24), title: T(24), lead: OPT(56),
            members: LIST(OBJ({ name: T(12), role: T(20), bio: T(44), image: IMG({ req: false }) }), 2, 4) },
    render: (s, c) => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-team" style="--n:${s.members.length}">
        ${s.members.map(m => `
          <div class="x-member" data-box>
            ${m.image ? `<div class="x-member-photo" data-visual><img src="${esc(c.asset(m.image))}" alt=""></div>`
                      : `<div class="x-member-photo is-initial"><span>${esc([...m.name.trim()][0] || '')}</span></div>`}
            <div class="x-member-role">${esc(m.role)}</div>
            <div class="x-member-name">${esc(m.name)}</div>
            <p class="x-member-bio">${rich(m.bio)}</p>
          </div>`).join('')}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  question: {
    name: '問いかけ・ワーク', family: 'frame', tone: 'dark',
    use: '聞き手に考えてもらう問い・手を動かすワーク。時間とやることを添えられる（講座・研修・クイズ）',
    spec: { kicker: OPT(24, { hint: '例: WORK / QUESTION' }), question: T(32, { min: 6, hint: '「？」で終わる問い、または「〜を書き出す」。steps を付けるなら24字まで' }),
            sub: OPT(50), time: OPT(8, { hint: '例: 3分' }), steps: LIST(T(26), 0, 3, { req: false, hint: 'ワークの手順' }) },
    render: s => `
      <div class="deco x-ghost-word is-dark">${s.steps?.length ? 'WORK' : 'Q'}</div>
      <div class="deco x-orb x-orb-c"></div>
      <div class="x-question${s.steps?.length ? ' has-steps' : ''}">
        <div class="x-question-main">
          <div class="x-question-top">
            <div class="x-kicker">${esc(s.kicker || (s.steps?.length ? 'WORK' : 'QUESTION'))}</div>
            ${s.time ? `<div class="x-timer">${icon('clock', 40)}<span>${esc(s.time)}</span></div>` : ''}
          </div>
          <h2 class="x-question-text" data-slot="message">${rich(s.question)}</h2>
          ${s.sub ? `<p class="x-question-sub">${rich(s.sub)}</p>` : ''}
        </div>
        ${s.steps?.length ? `<ol class="x-question-steps">${s.steps.map((t, i) => `<li><span class="x-num-dot">${i + 1}</span><span>${rich(t)}</span></li>`).join('')}</ol>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  checklist: {
    name: 'チェックリスト', family: 'text', tone: 'light',
    use: '明日からやること・持ち物・作業前の確認など、チェックして使う項目（3〜6個）',
    spec: { kicker: OPT(24), title: T(28), lead: OPT(56), items: LIST(OBJ({ head: T(20), body: OPT(36) }), 3, 6), note: OPT(40) },
    render: s => `
      <div class="deco x-dots"></div>
      ${head(s)}
      <div class="x-body x-checklist${s.items.length > 3 ? ' is-two' : ''}" style="--rows:${s.items.length > 3 ? Math.ceil(s.items.length / 2) : s.items.length}">
        ${s.items.map((it, i) => {
          // 2列のときは同じ段の相手と見出しの高さをそろえる。段の2つとも補足が無ければ、見出しを箱の真ん中に置く
          const rows = Math.ceil(s.items.length / 2), mate = s.items[i < rows ? i + rows : i - rows];
          const solo = s.items.length <= 3 || (!it.body && !mate?.body);
          return `
          <div class="x-check-item${solo ? ' is-solo' : ''}" data-box>
            <div class="x-check-line"><span class="x-checkbox">${icon('check', 40)}</span><h3>${rich(it.head)}</h3></div>
            ${it.body ? `<p>${rich(it.body)}</p>` : ''}
          </div>`; }).join('')}
      </div>
      ${s.note ? `<div class="x-note x-checklist-note">※ ${esc(s.note)}</div>` : ''}`,
  },

  /* ------------------------------------------------------------------ */
  quote: {
    name: '引用・名言', family: 'frame', tone: 'dark',
    use: '実在の人の言葉を大きく見せる（講演・インタビュー・事例）。発言者と出典がある言葉だけ。自分たちの主張なら message',
    spec: { kicker: OPT(24), quote: T(60, { min: 6 }), name: T(20), role: OPT(30), image: IMG({ req: false }) },
    render: (s, c) => `
      <div class="deco x-quote-mark">“</div>
      <div class="deco x-orb x-orb-c"></div>
      <div class="x-quote${s.image ? ' has-photo' : ''}">
        <div class="x-quote-main">
          ${s.kicker ? `<div class="x-kicker">${esc(s.kicker)}</div>` : ''}
          <blockquote class="x-quote-text" data-slot="quote">${rich(s.quote)}</blockquote>
          <div class="x-quote-who"><span class="x-quote-rule"></span><div><div class="x-quote-name">${esc(s.name)}</div>${s.role ? `<div class="x-quote-role">${esc(s.role)}</div>` : ''}</div></div>
        </div>
        ${s.image ? `<div class="x-quote-photo" data-visual><img src="${esc(c.asset(s.image))}" alt=""></div>` : ''}
      </div>`,
  },

  /* ------------------------------------------------------------------ */
  closing: {
    name: '締め・行動喚起', family: 'frame', tone: (s, f) => (f === 'type' ? 'accent' : 'dark'),
    use: '最後の1枚。次にしてほしい行動を1つだけ',
    spec: { kicker: OPT(20), title: T(24), subtitle: OPT(70), cta: OPT(26, { hint: '動詞で終わる行動。例: デモを触ってみる（書かなければボタンを出さない）' }), contact: OPT(40), style: STYLE },
    render: (s, c) => CLOSING[c.frame || 'classic'](s, c),
  },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS);

/* ---------------------------------------------------------------------
   型の分類（正本はここ。事前チェック validate.mjs・機械検品 qc.mjs・
   型の一覧 layouts-doc.mjs は全部これを読む。手で別の一覧を書かない）
     frame   = 表紙・章扉・締めなどの「枠」。図解率・カード比率の分母に入れない
     visual  = 図解の型（図解率に数える）
     cardish = カードを並べる型（多いと単調）
     text    = 文章が主役の型
   --------------------------------------------------------------------- */
const idsOf = family => LAYOUT_IDS.filter(id => LAYOUTS[id].family === family);
export const FRAME_IDS = idsOf('frame');
export const VISUAL_IDS = idsOf('visual');
export const CARDISH_IDS = idsOf('cardish');

/* デッキ全体の割合の決まり（本文＝frame 以外の枚） */
export const DECK_RULES = {
  visualStop: 0.4,   // 図解がこれ未満なら止める（error）
  visualTarget: 0.6, // これ未満は減点（warn）
  cardWarn: 0.25,    // カード並べがこれを超えたら減点
  cardStop: 0.5,     // これを超えたら止める
};
const pct = r => `${Math.round(r * 100)}%`;
export const DECK_RULES_TEXT = {
  visual: `図解の型を本文の${pct(DECK_RULES.visualTarget)}以上（${pct(DECK_RULES.visualStop)}未満は止まる・${pct(DECK_RULES.visualStop)}〜${Math.round(DECK_RULES.visualTarget * 100) - 1}%は減点）`,
  card: `カード並べ（${CARDISH_IDS.join(' / ')}）は本文の${pct(DECK_RULES.cardWarn)}まで（${pct(DECK_RULES.cardStop)}超は止まる）`,
};
