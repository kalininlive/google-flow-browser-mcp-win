/**
 * Дымовой тест подключения: печатает разрешённые пути, поднимает Chrome,
 * открывает Flow, проверяет аккаунт.
 *
 *   node scripts/test-connect.mjs          # закрыть браузер после проверки
 *   node scripts/test-connect.mjs --keep   # оставить окно открытым
 *
 * Нужен потому, что до него единственным способом проверить подключение был
 * запуск всего MCP-сервера, где ошибка приходила без контекста путей.
 */
import { launchKiaraProfile, navigateToFlow } from '../src/browser/launch-profile.js';
import { getPage, closeBrowser } from '../src/browser/connect.js';
import { verifyAccount } from '../src/browser/account-check.js';
import {
  resolveChromePath, resolveProfileSource, resolveProfileName, defaultUserDataDir,
} from '../src/utils/platform.js';

console.log('platform     :', process.platform);
console.log('chromePath   :', resolveChromePath());
console.log('userDataDir  :', defaultUserDataDir());
console.log('profileSource:', resolveProfileSource());
console.log('profileName  :', resolveProfileName());

const keepOpen = process.argv.includes('--keep');

try {
  const t0 = Date.now();
  await launchKiaraProfile(false);
  console.log(`connect OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const page = getPage();
  const nav = await navigateToFlow(page);
  console.log('navigate     :', JSON.stringify(nav).slice(0, 300));

  try {
    const acc = await verifyAccount(page);
    console.log('account      :', JSON.stringify(acc).slice(0, 300));
  } catch (e) {
    console.log('account ERR  :', e.message);
  }
} catch (err) {
  console.error('FAIL:', err.message);
  console.error(err.stack?.split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  if (!keepOpen) await closeBrowser();
  process.exit(process.exitCode || 0);
}
