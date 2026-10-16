import { chromium } from 'playwright';
import { cdpAlive } from '../src/utils/platform.js';
let page = null;
for (let p = 9222; p <= 9240; p++) {
  const u = `http://127.0.0.1:${p}`;
  if (!(await cdpAlive(u, 700))) continue;
  const b = await chromium.connectOverCDP(u);
  const ctx = b.contexts()[0];
  page = ctx.pages().find(x => x.url().includes('chatgpt.com')) || ctx.pages()[0];
  console.log('порт', p, '| вкладка', page.url().slice(0, 60));
  break;
}
if (!page) { console.log('нет окна'); process.exit(1); }
const info = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')].map(i => ({
    src: (i.currentSrc || i.src || '').slice(0, 120),
    w: i.naturalWidth, h: i.naturalHeight,
  })).filter(i => i.w >= 200);
  const btns = [...document.querySelectorAll('button[aria-label],a[download]')]
    .map(b => b.getAttribute('aria-label') || b.getAttribute('download')).filter(Boolean).slice(0, 15);
  return { imgs, btns, url: location.href };
});
console.log(JSON.stringify(info, null, 2).slice(0, 2500));
process.exit(0);
