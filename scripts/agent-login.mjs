/**
 * ОДНОРАЗОВЫЙ ВХОД В БРАУЗЕР АГЕНТА.
 *
 *   node scripts/agent-login.mjs                 # Google и ChatGPT
 *   node scripts/agent-login.mjs --only chatgpt  # только ChatGPT
 *   node scripts/agent-login.mjs --only google   # только Google
 *
 * Открывает окно с нужными вкладками и ждёт, пока владелец войдёт. Куки
 * остаются в профиле агента: дальше скрипты работают без входа.
 *
 * ⚠️ ВХОДИТЬ НАДО ИМЕННО В ЭТОМ ОКНЕ. Вход в обычном Chrome сюда не
 * переносится: у профиля агента своё хранилище кук — ради этого он и заведён.
 *
 * ⚠️ ПРОВЕРКА ИДЁТ ПО КУКАМ, А НЕ ПО СТРАНИЦАМ. Первая версия каждые десять
 * секунд открывала новую вкладку, чтобы посмотреть, пустил ли Flow, — окно
 * дёргалось, фокус уезжал, и владелец физически не успевал ввести пароль.
 * `context.cookies()` отвечает на тот же вопрос, ничего не открывая и не
 * трогая фокус.
 */
import { launchChromeDirect, getPage, getContext } from '../src/browser/connect.js';
import { agentProfileDir } from '../src/utils/platform.js';

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const TABS = [
  { key: 'google', name: 'Google', url: 'https://accounts.google.com/signin' },
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
].filter((t) => !only || t.key === only);

console.log('профиль агента:', agentProfileDir());
await launchChromeDirect({ profileMode: 'agent', headless: false });

const context = getContext();
const first = getPage();
await first.goto(TABS[0].url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
for (const t of TABS.slice(1)) {
  const p = await context.newPage();
  await p.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
}

console.log(`
  ОКНО ОТКРЫТО. Войди В НЁМ:${TABS.map((t) => `\n    · ${t.name} — ${t.url}`).join('')}

  Новых вкладок скрипт больше НЕ открывает и фокус не забирает —
  проверяет вход по кукам раз в десять секунд.
  Окно закроешь сам, когда закончишь.
`);

/** Признак живой сессии — по кукам, без единого перехода. */
async function state() {
  let cookies = [];
  try {
    cookies = await context.cookies();
  } catch {
    return null; // окно закрыли
  }
  const has = (host, name) =>
    cookies.some((c) => c.domain.includes(host) && c.name === name && c.value);

  return {
    // Вход в Google: сессионные куки аккаунта.
    google: has('google.com', 'SID') && has('google.com', '__Secure-1PSID'),
    // Доступ именно к Flow: своя сессия на labs.google поверх аккаунта.
    flow: has('labs.google', '__Secure-next-auth.session-token'),
    chatgpt: has('chatgpt.com', '__Secure-next-auth.session-token'),
  };
}

const need = new Set(TABS.map((t) => t.key));
for (let i = 0; i < 120; i += 1) {
  await new Promise((r) => setTimeout(r, 10000));
  const s = await state();
  if (!s) {
    console.log('\n  Окно закрыто. Что успело сохраниться — осталось в профиле.');
    process.exit(0);
  }

  const line = [];
  if (need.has('google')) line.push(`Google: ${s.google ? '✓' : '…'}  Flow: ${s.flow ? '✓' : '…'}`);
  if (need.has('chatgpt')) line.push(`ChatGPT: ${s.chatgpt ? '✓' : '…'}`);
  console.log(`  ${(i + 1) * 10}с — ${line.join('   ')}`);

  const done =
    (!need.has('google') || s.google) && (!need.has('chatgpt') || s.chatgpt);
  if (done) {
    console.log('\n  ✓ Вход выполнен, сессия в профиле агента. Окно можно закрыть.');
    process.exit(0);
  }
}

console.log('\n  Время ожидания вышло. Запусти скрипт заново, когда будешь готов.');
process.exit(1);
