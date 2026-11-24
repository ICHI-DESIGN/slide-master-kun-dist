#!/usr/bin/env node
/* =====================================================================
   見本の総点検 — 見本デッキを全部描いて、結果を1行ずつ並べる
   使い方:
     node scripts/samples.mjs                 # reference/examples/* を全部描画＋検品
     node scripts/samples.mjs --check         # 事前チェックだけ（速い）
     node scripts/samples.mjs --sheets        # 描画のあと、各見本の sheet.jpg（一覧画像）も作り直す
     node scripts/samples.mjs decks/a decks/b # 見本以外のデッキを指定して点検
     node scripts/samples.mjs --diff          # 描いた画像を基準（reference/baseline/）と比べ、変わった枚を出す
     node scripts/samples.mjs --baseline      # 描いた画像を新しい基準として保存する（見た目の変更を確かめて受け入れたあと）
   エンジン・テーマ・検品を直したら必ず流す。1つでも不合格なら終了コード1（--diff で変わった枚があっても1）
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../engine/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const sheets = args.includes('--sheets');
const diff = args.includes('--diff'), saveBase = args.includes('--baseline');
const given = args.filter(a => !a.startsWith('--'));

const exampleDir = join(ROOT, 'reference', 'examples');
const decks = given.length
  ? given.map(d => resolve(d)).filter(d => existsSync(join(d, 'deck.json')) || (console.log(`- ${d} は deck.json が無いので飛ばします`), false))
  : readdirSync(exampleDir).map(d => join(exampleDir, d)).filter(d => statSync(d).isDirectory() && existsSync(join(d, 'deck.json')));

const rows = [];
for (const dir of decks) {
  const name = relative(ROOT, dir) || basename(dir);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), dir, ...(checkOnly ? ['--check'] : [])], { encoding: 'utf8', cwd: ROOT });
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  const slides = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8')).slides.length;
  let errors = '-', warns = '-';
  if (!checkOnly && existsSync(join(dir, 'out', 'qc-report.json'))) {
    const rep = JSON.parse(readFileSync(join(dir, 'out', 'qc-report.json'), 'utf8'));
    errors = rep.errors.length; warns = rep.warns.length;
  }
  const ok = r.status === 0;
  rows.push({ name, slides, ok, errors, warns, sec, out: (r.stdout || '') + (r.stderr || '') });
  console.log(`${ok ? '✓' : '✖'} ${name.padEnd(42)} ${String(slides).padStart(3)}枚  必須違反 ${String(errors).padStart(2)}  減点 ${String(warns).padStart(3)}  ${sec}秒`);
}

/* 一覧画像を見本に保存する（out/sheet.png を幅1600の JPEG に縮める。OS の道具に頼らずブラウザで縮める） */
if (sheets && !checkOnly) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 });
  for (const row of rows.filter(r => r.ok)) {
    const dir = resolve(ROOT, row.name), src = join(dir, 'out', 'sheet.png');
    if (!existsSync(src)) continue;
    // 空のページからは Mac のファイルを読めないので、画像を埋め込んで開く
    const b64 = readFileSync(src).toString('base64');
    await page.setContent(`<style>body{margin:0}img{width:1600px;display:block}</style><img src="data:image/png;base64,${b64}">`);
    await page.evaluate(() => document.images[0].decode());
    await page.screenshot({ path: join(dir, 'sheet.jpg'), type: 'jpeg', quality: 82, fullPage: true });
    console.log(`  一覧画像 → ${relative(ROOT, join(dir, 'sheet.jpg'))}`);
  }
  await browser.close();
}

/* ---------- 見比べテスト ----------
   基準は 1280×720 の JPEG（全部で数MB）。描くたびに矢印の縁などが数画素だけ揺れるので、
   色の差が TOL 以下の画素は数えず、変わった画素が MIN_PX を超えた枚だけを「変わった」とする */
const TOL = 48, MIN_PX = 80, BW = 1280, BH = 720;
let changed = 0;
if ((diff || saveBase) && !checkOnly) {
  const baseRoot = join(ROOT, 'reference', 'baseline');
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: BW, height: BH }, deviceScaleFactor: 1 });
  const toJpeg = async png => {
    await page.setContent(`<style>body{margin:0}img{width:${BW}px;height:${BH}px;display:block}</style><img src="data:image/png;base64,${png.toString('base64')}">`);
    await page.evaluate(() => document.images[0].decode());
    return page.screenshot({ type: 'jpeg', quality: 90 });
  };
  for (const row of rows.filter(r => r.ok)) {
    const dir = resolve(ROOT, row.name), out = join(dir, 'out'), base = join(baseRoot, basename(dir));
    const shots = readdirSync(out).filter(f => /^\d+_.+\.png$/.test(f)).sort();
    if (saveBase) {
      rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true });
      for (const f of shots) writeFileSync(join(base, f.replace(/\.png$/, '.jpg')), await toJpeg(readFileSync(join(out, f))));
      console.log(`  基準を保存 → ${relative(ROOT, base)}（${shots.length}枚）`);
      continue;
    }
    if (!existsSync(base)) { console.log(`  △ ${row.name} は基準が無い（--baseline で作る）`); continue; }
    const olds = readdirSync(base).filter(f => f.endsWith('.jpg')), news = shots.map(f => f.replace(/\.png$/, '.jpg'));
    const msgs = [];
    for (const f of olds.filter(f => !news.includes(f))) msgs.push(`${f.replace('.jpg', '')} が無くなった`);
    for (const f of news.filter(f => !olds.includes(f))) msgs.push(`${f.replace('.jpg', '')} が増えた`);
    const dd = join(out, 'diff'); rmSync(dd, { recursive: true, force: true });
    for (const f of news.filter(f => olds.includes(f))) {
      const cur = await toJpeg(readFileSync(join(out, f.replace(/\.jpg$/, '.png'))));
      const r = await page.evaluate(async ({ a, b, TOL, BW, BH }) => {
        const load = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
        const [A, B] = await Promise.all([load(a), load(b)]);
        const cv = document.createElement('canvas'); cv.width = BW; cv.height = BH; const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(A, 0, 0, BW, BH); const da = g.getImageData(0, 0, BW, BH);
        g.drawImage(B, 0, 0, BW, BH); const db = g.getImageData(0, 0, BW, BH);
        let n = 0; const o = g.createImageData(BW, BH);
        for (let i = 0; i < da.data.length; i += 4) {
          const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
          const hit = d > TOL; if (hit) n++;
          // 変わった画素は赤、それ以外は今の画像を薄く
          o.data[i] = hit ? 230 : 255 - (255 - db.data[i]) * 0.35; o.data[i + 1] = hit ? 30 : 255 - (255 - db.data[i + 1]) * 0.35; o.data[i + 2] = hit ? 40 : 255 - (255 - db.data[i + 2]) * 0.35; o.data[i + 3] = 255;
        }
        g.putImageData(o, 0, 0);
        return { n, png: n ? cv.toDataURL('image/png').split(',')[1] : null };
      }, { a: `data:image/jpeg;base64,${readFileSync(join(base, f)).toString('base64')}`, b: `data:image/jpeg;base64,${cur.toString('base64')}`, TOL, BW, BH });
      if (r.n > MIN_PX) {
        mkdirSync(dd, { recursive: true }); writeFileSync(join(dd, f.replace('.jpg', '.png')), Buffer.from(r.png, 'base64'));
        msgs.push(`${f.replace('.jpg', '')} が変わった（${r.n}画素・${(r.n / (BW * BH) * 100).toFixed(2)}%）`);
      }
    }
    changed += msgs.length;
    console.log(msgs.length ? `  ◆ ${row.name}: ${msgs.length}枚に差\n${msgs.map(m => `      ${m}`).join('\n')}\n      赤く塗った画像 → ${relative(ROOT, dd)}/` : `  = ${row.name}: 基準と同じ`);
  }
  await browser.close();
  if (diff) console.log(changed ? `\n◆ 基準と違う枚が${changed}枚。意図した変更なら --baseline で基準を更新する` : '\n= 全部基準と同じ');
}

const bad = rows.filter(r => !r.ok);
for (const b of bad) console.log(`\n✖ ${b.name} の出力（末尾）:\n` + b.out.split('\n').slice(-25).join('\n'));
console.log(`\n${bad.length ? `✖ ${bad.length}件が不合格` : '✓ 全部合格'}（${rows.length}件）`);
process.exit(bad.length || (diff && changed) ? 1 : 0);
