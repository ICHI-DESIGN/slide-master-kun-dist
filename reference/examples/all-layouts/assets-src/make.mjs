/* 見本 all-layouts の架空の画面（スマホ2枚・医院サイト4枚）を HTML で描いて assets/ に保存する
   実在のアプリ・会社に見えないよう、名前はすべて架空。使い方: node reference/examples/all-layouts/assets-src/make.mjs */
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../../../engine/browser.mjs';
const OUT = fileURLToPath(new URL('../assets/', import.meta.url));
const FONT = `font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;`;
const b = await launchBrowser();
const shot = async (name, w, h, html) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); await p.setContent(`<!doctype html><meta charset=utf-8><style>*{box-sizing:border-box;margin:0;padding:0}body{${FONT}width:${w}px;height:${h}px;overflow:hidden}</style>${html}`); await p.waitForTimeout(200); await p.screenshot({ path: OUT + name, type: name.endsWith('.jpg') ? 'jpeg' : 'png', quality: name.endsWith('.jpg') ? 88 : undefined }); await p.close(); };

/* スマホ1: 予約の変更画面 */
const slot = (t, st) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:30px 34px;border-radius:26px;background:${st==='sel'?'#1E6FD9':'#fff'};color:${st==='sel'?'#fff':'#1b2430'};border:2px solid ${st==='sel'?'#1E6FD9':'#E3E8EF'};margin-bottom:18px"><b style="font-size:40px">${t}</b><span style="font-size:30px;font-weight:700;opacity:${st==='full'?.45:1}">${st==='full'?'満':st==='sel'?'選択中':'空きあり'}</span></div>`;
await shot('phone-reserve.png', 780, 1650, `<div style="height:100%;background:#F4F7FB;padding:110px 40px 0">
 <div style="display:flex;justify-content:space-between;align-items:center;font-size:30px;color:#5b6675;font-weight:700"><span>‹ 戻る</span><span>みなみ歯科（架空）</span><span style="width:80px"></span></div>
 <h1 style="margin-top:40px;font-size:56px;color:#1b2430">予約の変更</h1>
 <p style="margin-top:14px;font-size:30px;color:#5b6675">いまの予約: 11月18日（火）10:30</p>
 <div style="display:flex;gap:14px;margin-top:44px">${['18<br>火','19<br>水','20<br>木','21<br>金','22<br>土'].map((d,i)=>`<div style="flex:1;text-align:center;padding:20px 0;border-radius:22px;font-size:30px;font-weight:800;line-height:1.35;background:${i===2?'#1b2430':'#fff'};color:${i===2?'#fff':'#1b2430'};border:2px solid #E3E8EF">${d}</div>`).join('')}</div>
 <div style="margin-top:44px">${slot('9:30','full')}${slot('11:00','')}${slot('14:30','sel')}${slot('16:00','')}${slot('17:30','full')}</div>
 <div style="position:absolute;left:40px;right:40px;bottom:90px;padding:38px;border-radius:999px;background:#1E6FD9;color:#fff;text-align:center;font-size:40px;font-weight:800">20日 14:30 に変更する</div></div>`);

/* スマホ2: 自動返信のトーク画面 */
const me = t => `<div style="align-self:flex-end;max-width:76%;padding:26px 32px;border-radius:34px 34px 8px 34px;background:#1E6FD9;color:#fff;font-size:32px;line-height:1.5;margin-top:22px">${t}</div>`;
const ai = t => `<div style="display:flex;gap:16px;margin-top:22px;align-items:flex-end"><div style="flex:none;width:64px;height:64px;border-radius:50%;background:#DDE7F5;color:#1E6FD9;display:grid;place-items:center;font-size:24px;font-weight:900">受付</div><div style="max-width:76%;padding:26px 32px;border-radius:34px 34px 34px 8px;background:#fff;color:#1b2430;font-size:32px;line-height:1.5;border:2px solid #E3E8EF">${t}</div></div>`;
await shot('phone-chat.png', 780, 1650, `<div style="height:100%;background:#EEF2F7;display:flex;flex-direction:column">
 <div style="padding:110px 40px 30px;background:#fff;border-bottom:2px solid #E3E8EF;font-size:36px;font-weight:800;color:#1b2430">みなみ歯科 受付（架空）<div style="font-size:24px;font-weight:700;color:#3C9A5F;margin-top:6px">● 自動で返信中</div></div>
 <div style="flex:1;display:flex;flex-direction:column;padding:10px 34px">
 <div style="align-self:center;margin-top:26px;font-size:24px;color:#7a8594;font-weight:700">今日 21:42</div>
 ${me('明日の予約、夕方に変えられますか？')}${ai('ご連絡ありがとうございます。明日（20日）は 14:30 と 16:00 に空きがあります。')}${me('16:00 でお願いします')}${ai('16:00 に変更しました。当日は保険証をお持ちください。')}
 <div style="align-self:center;margin-top:30px;padding:14px 26px;border-radius:999px;background:#DDE7F5;color:#1E6FD9;font-size:24px;font-weight:800">スタッフが翌朝に確認します</div></div>
 <div style="padding:26px 34px 70px;background:#fff;border-top:2px solid #E3E8EF"><div style="padding:26px 32px;border-radius:999px;background:#EEF2F7;color:#8a94a3;font-size:30px">メッセージを入力</div></div></div>`);

/* 画像を並べる: 架空の医院サイト4つ */
const site = (name, kind, c1, c2, ink, head, sub, cards) => `<div style="height:100%;background:#fff;color:${ink}">
 <div style="height:96px;display:flex;align-items:center;justify-content:space-between;padding:0 56px;border-bottom:2px solid #eef0f3"><b style="font-size:34px">${name}</b><div style="display:flex;gap:40px;font-size:24px;font-weight:700;opacity:.75"><span>診療案内</span><span>アクセス</span><span>よくある質問</span></div><span style="padding:16px 30px;border-radius:999px;background:${c1};color:#fff;font-size:24px;font-weight:800">Web予約</span></div>
 <div style="height:470px;position:relative;overflow:hidden;background:linear-gradient(120deg,${c1},${c2})">
  <div style="position:absolute;right:-120px;top:-160px;width:640px;height:640px;border-radius:50%;background:rgba(255,255,255,.14)"></div><div style="position:absolute;right:180px;bottom:-220px;width:460px;height:460px;border-radius:50%;background:rgba(255,255,255,.1)"></div>
  <div style="position:absolute;left:64px;top:96px;color:#fff"><div style="font-size:26px;font-weight:800;letter-spacing:.12em;opacity:.9">${kind}</div><div style="margin-top:20px;font-size:64px;font-weight:900;line-height:1.25">${head}</div><div style="margin-top:22px;font-size:28px;font-weight:600;opacity:.92">${sub}</div></div></div>
 <div style="display:flex;gap:28px;padding:44px 56px">${cards.map(t=>`<div style="flex:1;padding:30px;border-radius:22px;background:#f5f7fa"><div style="width:56px;height:8px;border-radius:4px;background:${c1}"></div><div style="margin-top:20px;font-size:28px;font-weight:800">${t}</div><div style="margin-top:12px;height:14px;border-radius:7px;background:#e3e7ec;width:90%"></div><div style="margin-top:10px;height:14px;border-radius:7px;background:#e3e7ec;width:70%"></div></div>`).join('')}</div></div>`;
await shot('site-dental.jpg', 1200, 900, site('みなみ歯科', 'DENTAL CLINIC', '#1E6FD9', '#59A8F0', '#1b2430', '夜20時まで、<br>Webで予約できる歯科', '予約の変更もLINEで24時間', ['一般歯科', '小児歯科', '予防・クリーニング']));
await shot('site-seikotsu.jpg', 1200, 900, site('あおば整骨院', 'SEIKOTSU', '#1F8A70', '#5CC3A0', '#17302a', '仕事帰りに寄れる、<br>駅前の整骨院', '受付はAIが24時間お答えします', ['肩こり・腰痛', '交通事故', '産後の骨盤']));
await shot('site-derma.jpg', 1200, 900, site('ひかり皮ふ科', 'DERMATOLOGY', '#C2557A', '#EE9DB5', '#3a1f2a', '待ち時間を、<br>おうちで過ごせる皮ふ科', '順番が近づくと通知でお知らせ', ['一般皮膚科', '小児皮膚科', 'Web問診']));
await shot('site-admin.jpg', 1200, 900, `<div style="height:100%;display:flex;background:#F4F6F9;color:#1b2430"><div style="width:250px;background:#1b2430;color:#cfd6df;padding:44px 30px;font-size:24px;font-weight:700;line-height:3"><div style="color:#fff;font-size:28px;font-weight:900;margin-bottom:24px">受付の管理</div><div style="color:#fff">● 今日の問い合わせ</div><div>返信の下書き</div><div>よくある質問</div><div>設定</div></div>
 <div style="flex:1;padding:48px"><div style="font-size:40px;font-weight:900">今日の問い合わせ</div><div style="display:flex;gap:24px;margin-top:30px">${[['自動で返信','38件','#1E6FD9'],['スタッフ確認','6件','#E08A1E'],['電話','4件','#5b6675']].map(([l,v,c])=>`<div style="flex:1;padding:28px;border-radius:20px;background:#fff;border:2px solid #e6e9ee"><div style="font-size:24px;font-weight:700;color:#5b6675">${l}</div><div style="margin-top:8px;font-size:56px;font-weight:900;color:${c}">${v}</div></div>`).join('')}</div>
 <div style="margin-top:30px;border-radius:20px;background:#fff;border:2px solid #e6e9ee">${['予約の変更（20日 16:00）','駐車場の場所','初診の持ち物','キャンセル（21日）','料金の目安'].map((t,i)=>`<div style="display:flex;justify-content:space-between;padding:24px 30px;border-top:${i?'2px solid #eef0f3':'0'};font-size:26px;font-weight:700"><span>${t}</span><span style="color:${i===4?'#E08A1E':'#3C9A5F'}">${i===4?'確認待ち':'返信済み'}</span></div>`).join('')}</div></div></div>`);
await b.close(); console.log('ok');
