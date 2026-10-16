/** Какой аккаунт и что за кнопкой «Create with Google Flow». */
import { launchChromeDirect, getPage, getContext, closeBrowser } from '../src/browser/connect.js';

await launchChromeDirect({ profileMode: 'agent', headless: false });
const ctx = getContext();
const page = getPage();

await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const who = await page.evaluate(() => {
  const t = document.body.innerText || '';
  return { url: location.href, email: (t.match(/[\w.+-]+@[\w.-]+\.\w+/) || [])[0] || null };
});
console.log('АККАУНТ:', JSON.stringify(who));

await page.goto('https://labs.google/fx/ru/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('a,button')]
    .find((e) => /Create with Google Flow|Try in Google Flow/i.test(e.innerText || ''));
  if (!el) return null;
  return { tag: el.tagName, href: el.getAttribute('href') || null, text: el.innerText.trim() };
});
console.log('КНОПКА:', JSON.stringify(clicked));

if (clicked) {
  await Promise.all([
    page.waitForLoadState('domcontentloaded').catch(() => {}),
    page.evaluate(() => {
      const el = [...document.querySelectorAll('a,button')]
        .find((e) => /Create with Google Flow/i.test(e.innerText || ''));
      el?.click();
    }),
  ]);
  await page.waitForTimeout(8000);
  const pages = ctx.pages();
  for (const p of pages) {
    const st = await p.evaluate(() => ({
      url: location.href,
      hasApp: /Создать проект|New project|Мои проекты|My projects|Новый проект/i.test(document.body.innerText || ''),
      head: (document.body.innerText || '').slice(0, 180).replace(/\s+/g, ' '),
    })).catch(() => null);
    if (st) console.log('ПОСЛЕ КЛИКА:', JSON.stringify(st, null, 2));
  }
  await pages[pages.length - 1].screenshot({ path: 'flow_after_click.png' }).catch(() => {});
  console.log('скриншот: flow_after_click.png');
}
await closeBrowser();
process.exit(0);
