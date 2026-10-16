/** Снимок состояния Flow в профиле агента: скриншот + ключевые признаки. */
import { launchChromeDirect, getPage, closeBrowser } from '../src/browser/connect.js';

await launchChromeDirect({ profileMode: 'agent', headless: false });
const page = getPage();
await page.goto('https://labs.google/fx/ru/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const btn = [...document.querySelectorAll('button,a')]
    .map((e) => (e.innerText || '').trim())
    .filter(Boolean).slice(0, 25);
  return {
    url: location.href,
    signInVisible: /Войти|Sign in|Начать|Get started/i.test(t),
    projectsVisible: /Создать проект|New project|Мои проекты|My projects/i.test(t),
    buttons: btn,
    text: t.slice(0, 400).replace(/\s+/g, ' '),
  };
});
console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: 'flow_state.png', fullPage: false });
console.log('скриншот: flow_state.png');
await closeBrowser();
process.exit(0);
