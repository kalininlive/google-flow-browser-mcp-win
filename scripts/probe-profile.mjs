/**
 * Какой профиль реально видит Flow залогиненным.
 *
 * `flow_account_check` отвечает «assumed» — он лишь проверяет отсутствие
 * чужого аккаунта. Здесь смотрим на саму страницу: есть ли список проектов,
 * метка тарифа и кнопка создания проекта.
 */
import { launchKiaraProfile, navigateToFlow } from '../src/browser/launch-profile.js';
import { getPage, closeBrowser } from '../src/browser/connect.js';
import { resolveProfileSource } from '../src/utils/platform.js';

console.log('профиль:', resolveProfileSource());
try {
  await launchKiaraProfile(false);
  const page = getPage();
  await navigateToFlow(page);
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      url: location.href,
      signedIn: !location.href.includes('accounts.google.com'),
      hasProjects: /Создать проект|New project|Создать/i.test(t),
      plan: (t.match(/\b(PRO|ULTRA|FREE)\b/) || [])[1] || null,
      credits: (t.match(/(\d+)\s*(credits|кредит)/i) || [])[0] || null,
      head: t.slice(0, 160).replace(/\s+/g, ' '),
    };
  });
  console.log(JSON.stringify(info, null, 2));
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
  process.exit(process.exitCode || 0);
}
