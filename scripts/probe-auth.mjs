/** Под каким аккаунтом Google живёт профиль агента. */
import { launchChromeDirect, getPage, closeBrowser } from '../src/browser/connect.js';

await launchChromeDirect({ profileMode: 'agent', headless: false });
const page = getPage();

await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const acc = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const mail = (t.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || null;
  return {
    url: location.href,
    signedIn: !/accounts\.google\.com\/(signin|v3\/signin)/.test(location.href),
    email: mail,
    head: t.slice(0, 200).replace(/\s+/g, ' '),
  };
});
console.log('GOOGLE:', JSON.stringify(acc, null, 2));
await page.screenshot({ path: 'auth_google.png' });

await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const gpt = await page.evaluate(() => {
  const t = document.body.innerText || '';
  return {
    url: location.href,
    loginWall: /Log in|Войти|Sign up|Регистрация/i.test(t.slice(0, 300)),
    head: t.slice(0, 200).replace(/\s+/g, ' '),
  };
});
console.log('CHATGPT:', JSON.stringify(gpt, null, 2));
await page.screenshot({ path: 'auth_chatgpt.png' });

await closeBrowser();
process.exit(0);
