#!/usr/bin/env node
/* =====================================================================
   README の画像（docs/images/）を、今のエンジンで見本から作り直す
     node scripts/docs-images.mjs
   - 中身は見本（reference/examples/）だけを使う。案件のデッキは使わない
   - 全33型の見本を必要なテーマで描き、型ごとの1枚・テーマ一覧・各見本の一覧を JPEG にする
   - 見た目（engine.css・テーマ・型）を変えたら流し直す。数分かかる
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../engine/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const EX = join(ROOT, 'reference', 'examples');
const WORK = join(tmpdir(), `smk-docs-${process.pid}`);

// README の表に並べる1枚（型・テーマ・ファイル名）
const SINGLES = [
  ['funnel', 'pop'], ['pyramid', 'warm'], ['table', 'tech'], ['pricing', 'duotone'],
  ['message', 'dynamic'], ['stats', 'corporate'], ['line', 'fresh'], ['question', 'corporate'],
];
// テーマ一覧に並べるテーマと、各テーマで見せる型
const SHEET_THEMES = [
  ['medical', '治療院・医療'], ['estate', '不動産・住まい'], ['finance', '士業・金融'], ['kids', '教育・子ども'],
  ['gradient', 'グラデ・モダン'], ['luxury', '黒×金'], ['neon', 'ネオン'], ['nordic', '北欧・くすみ色'],
  ['industrial', '建設・製造'], ['public', '自治体・公共'], ['resort', '観光・リゾート'], ['fitness', 'フィットネス'],
];
const SHEET_LAYOUTS = ['cover', 'bars', 'message', 'stats'];

const build = (dir, extra = []) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), dir, ...extra], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) { console.error((r.stdout || '') + (r.stderr || '')); throw new Error(`描画が不合格: ${dir}`); }
};

/* ---- 1. 全33型の見本を、使うテーマごとに描く ---- */
const base = JSON.parse(readFileSync(join(EX, 'all-layouts', 'deck.json'), 'utf8'));
const themes = [...new Set([...SINGLES.map(s => s[1]), ...SHEET_THEMES.map(t => t[0])])];
mkdirSync(WORK, { recursive: true });
const pngOf = {};   // theme → layout → png
for (const theme of themes) {
  const dir = join(WORK, theme);
  cpSync(join(EX, 'all-layouts'), dir, { recursive: true, filter: s => !s.includes(`${join('all-layouts', 'out')}`) && !s.includes(`${join('all-layouts', 'html')}`) });
  writeFileSync(join(dir, 'deck.json'), JSON.stringify({ ...base, theme, brand: `テーマ ${theme}（見本）` }, null, 1));
  const t0 = Date.now();
  build(dir, ['--scale=1']);
  pngOf[theme] = {};
  for (const f of readdirSync(join(dir, 'out')).filter(f => /^\d+_.+\.png$/.test(f)).sort()) {
    const layout = f.replace(/^\d+_/, '').replace('.png', '');
    pngOf[theme][layout] ??= join(dir, 'out', f);
  }
  console.log(`✓ ${theme}（${((Date.now() - t0) / 1000).toFixed(0)}秒）`);
}

/* ---- 2. 画像にする（ブラウザで並べて JPEG で撮る） ---- */
const browser = await launchBrowser();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const uri = p => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
async function shoot(html, width, file) {
  await page.setViewportSize({ width, height: 400 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif}img{display:block}</style>${html}`);
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 82, fullPage: true });
  console.log(`  → docs/images/${file}`);
}

// 型ごとの1枚
for (const [layout, theme] of SINGLES) {
  const p = pngOf[theme][layout]; if (!p) throw new Error(`見本に ${layout} が無い`);
  await shoot(`<img src="${uri(p)}" style="width:1280px">`, 1280, `${layout}_${theme}.jpg`);
}

// テーマ一覧（2列 × 6段。1段にテーマ名と4枚）
const TW = 280, TH = 158, G = 8;
const cell = ([theme, label]) => `<div><div style="font-size:22px;font-weight:700;margin:0 0 8px">${theme}
  <span style="font-size:15px;font-weight:500;color:#666;margin-left:10px">${label}</span></div>
  <div style="display:flex;gap:${G}px">${SHEET_LAYOUTS.map(l => `<img src="${uri(pngOf[theme][l])}" style="width:${TW}px;height:${TH}px">`).join('')}</div></div>`;
const sheetW = 2 * (4 * TW + 3 * G) + 48 + 48;
await shoot(`<div style="background:#f2f2f0;padding:24px">
  <div style="font-size:26px;font-weight:800;margin-bottom:20px">業種・世界観のテーマ12種（表紙／グラフ／キーメッセージ／数字の並び）</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px 48px">${SHEET_THEMES.map(cell).join('')}</div></div>`, sheetW, 'themes_sheet.jpg');

// 版面の流儀（同じ4枚を card / swiss / kinetic で）
const PAGE_LAYOUTS = ['problem', 'stats', 'features', 'flow'];
const pagePng = {};
for (const pages of ['swiss', 'kinetic']) {
  const dir = join(WORK, `pages-${pages}`);
  cpSync(join(EX, 'all-layouts'), dir, { recursive: true, filter: s => !s.includes(`${join('all-layouts', 'out')}`) && !s.includes(`${join('all-layouts', 'html')}`) });
  writeFileSync(join(dir, 'deck.json'), JSON.stringify({ ...base, pages }, null, 1));
  build(dir, ['--scale=1']);
  pagePng[pages] = {};
  for (const f of readdirSync(join(dir, 'out')).filter(f => /^\d+_.+\.png$/.test(f))) pagePng[pages][f.replace(/^\d+_/, '').replace('.png', '')] ??= join(dir, 'out', f);
}
pagePng.card = pngOf[base.theme] || null;
if (!pagePng.card) throw new Error(`見本のテーマ ${base.theme} を SINGLES か SHEET_THEMES に入れる`);
const PW = 440, PH = 248;
await shoot(`<div style="background:#f2f2f0;padding:24px">${[['card', 'card（既定）角丸の箱＋影'], ['swiss', 'swiss 左に見出しの柱・黒の太い罫線・大きな数字'], ['kinetic', 'kinetic 斜めの帯・段違いの箱・ずらした色の板の影']].map(([k, label]) => `
  <div style="font-size:22px;font-weight:700;margin:14px 0 8px">${label}</div>
  <div style="display:flex;gap:${G}px">${PAGE_LAYOUTS.map(l => `<img src="${uri(pagePng[k][l])}" style="width:${PW}px;height:${PH}px">`).join('')}</div>`).join('')}</div>`,
  4 * PW + 3 * G + 48, 'pages_sheet.jpg');

/* ---- 3. 見本の一覧（見本そのものを描いた sheet.png を縮める） ---- */
for (const [name, file] of [['inquiry-ai-proposal', 'hero_sheet.jpg'], ['cafe-workshop', 'cafe_sheet.jpg'], ['all-layouts', 'gallery_sheet.jpg']]) {
  const dir = join(WORK, `ex-${name}`);
  cpSync(join(EX, name), dir, { recursive: true });
  build(dir, ['--scale=1']);
  await shoot(`<img src="${uri(join(dir, 'out', 'sheet.png'))}" style="width:1600px">`, 1600, file);
}
await browser.close();
rmSync(WORK, { recursive: true, force: true });
console.log('✓ docs/images を作り直した');
