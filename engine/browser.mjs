/* =====================================================================
   描画用ブラウザの起動（build・qc・旧ルートの render が共通で使う）
   1. Google Chrome で起動する。無ければ Playwright の Chromium に切り替える
      （SMK_BROWSER=chromium で Chromium を強制できる。試験用）
   2. Google Fonts の書体を手元に保存して使う（~/.cache/slide-master-kun/fonts/）
      一度読めば、次からはネットにつながっていなくても同じ書体で描ける。
      SMK_FONT_CACHE で保存先を変えられる。SMK_OFFLINE=1 でネットに出ない（試験用）
   ===================================================================== */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export async function launchBrowser() {
  const want = (process.env.SMK_BROWSER || 'chrome').toLowerCase();
  if (want === 'chrome') {
    try { return await chromium.launch({ channel: 'chrome' }); }
    catch { console.warn('⚠ Google Chrome が見つからないため、Playwright の Chromium で描きます（色や文字の出方がわずかに違うことがある）'); }
  }
  try { return await chromium.launch(); }
  catch (e) {
    throw new Error('描画用のブラウザが無い。Google Chrome を入れるか、`npx playwright-core install chromium` を実行する\n' + e.message.split('\n')[0]);
  }
}

/* 書体の読み込みを横取りして、手元の保存分を返す（無ければ取りに行って保存する） */
export async function useFontCache(page) {
  const dir = process.env.SMK_FONT_CACHE || join(homedir(), '.cache', 'slide-master-kun', 'fonts');
  const offline = process.env.SMK_OFFLINE === '1';
  mkdirSync(dir, { recursive: true });
  await page.route(FONT_HOSTS, async route => {
    const url = route.request().url();
    const key = join(dir, createHash('sha256').update(url).digest('hex').slice(0, 32));
    if (existsSync(key) && existsSync(key + '.json')) {
      const { contentType } = JSON.parse(readFileSync(key + '.json', 'utf8'));
      return route.fulfill({ status: 200, contentType, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(key) });
    }
    if (offline) return route.abort('internetdisconnected');
    try {
      const resp = await route.fetch();
      const body = await resp.body();
      if (resp.ok()) {
        // 書きかけのファイルを残さないよう、一時名で書いてから名前を変える
        writeFileSync(key + '.tmp', body); renameSync(key + '.tmp', key);
        writeFileSync(key + '.json', JSON.stringify({ url, contentType: resp.headers()['content-type'] || '' }));
      }
      return route.fulfill({ response: resp, body });
    } catch { return route.abort('internetdisconnected'); }
  });
}

/* スライド描画用のページ（書体の手元保存つき） */
export async function newSlidePage(browser, opts) {
  const page = await browser.newPage(opts);
  await useFontCache(page);
  return page;
}

/* スライドが撮れる状態になるまで待つ（書体の読み込み＋ core/fit.js の見出し調整）
   fit.js を読んでいない古いHTMLでは、書体だけ待って進む */
export async function waitSlideReady(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('script[data-fit]') || document.documentElement.dataset.fit === 'done', null, { timeout: 5000 })
    .catch(() => console.warn('⚠ 見出しの調整（core/fit.js）が5秒で終わらなかったので、そのまま撮ります'));
}
