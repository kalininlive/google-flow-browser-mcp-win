/**
 * ПЕРЕНОС СЕССИИ ВЛАДЕЛЬЦА В ПРОФИЛЬ АГЕНТА — разовая операция.
 *
 *   node scripts/adopt-profile.mjs
 *
 * Копирует куки и настройки рабочего профиля (`chromeProfile` из конфига) в
 * постоянный профиль агента. После этого входить руками не нужно.
 *
 * ⚠️ Профиль-источник не должен быть ОТКРЫТ в работающем Chrome: активный
 * профиль держит `Network/Cookies` эксклюзивно, и копия уедет без сессии.
 * Скрипт это проверяет и говорит прямо, а не делает вид, что всё хорошо.
 */
import fs from 'fs';
import path from 'path';
import {
  resolveProfileSource, resolveUserDataDir, agentProfileDir, copyProfileSession,
} from '../src/utils/platform.js';

const source = resolveProfileSource();
const agentDir = agentProfileDir();
const cookiesSrc = path.join(source, 'Network', 'Cookies');

console.log('источник :', source);
console.log('приёмник :', agentDir);

if (!fs.existsSync(source)) {
  console.error('Профиля-источника нет. Проверь chromeProfile в config/flow.config.json.');
  process.exit(1);
}

try {
  fs.openSync(cookiesSrc, 'r');
} catch (err) {
  console.error(`\nКуки заблокированы (${err.code}). Этот профиль сейчас открыт в Chrome.`);
  console.error('Закрой окна ЭТОГО профиля и повтори — либо укажи другой профиль в конфиге.');
  process.exit(1);
}

fs.mkdirSync(agentDir, { recursive: true });
const { copied, skipped } = copyProfileSession(source, agentDir, 'Default');

// `Local State` рядом с профилем: в нём ключ шифрования кук.
const ls = path.join(resolveUserDataDir(), 'Local State');
if (fs.existsSync(ls)) {
  try {
    fs.copyFileSync(ls, path.join(agentDir, 'Local State'));
    copied.push('Local State');
  } catch (e) {
    skipped.push({ name: 'Local State', reason: e.code });
  }
}

const size = fs.existsSync(path.join(agentDir, 'Default', 'Network', 'Cookies'))
  ? fs.statSync(path.join(agentDir, 'Default', 'Network', 'Cookies')).size : 0;

console.log('\nскопировано:', copied.join(' · ') || '—');
if (skipped.length) console.log('пропущено  :', skipped.map((s) => `${s.name} (${s.reason})`).join(' · '));
console.log('куки в профиле агента:', size ? `${Math.round(size / 1024)} КБ` : 'НЕТ');
process.exit(size ? 0 : 1);
