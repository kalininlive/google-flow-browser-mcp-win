/**
 * Платформенный слой: пути Chrome, профиль, временная папка.
 *
 * Форк написан под Linux и зашивал `/opt/google/chrome/chrome`,
 * `$HOME/.config/google-chrome/Profile 3` и `/tmp`. На Windows
 * `process.env.HOME` у дочернего процесса не задан, поэтому
 * `path.resolve(process.env.HOME, ...)` падал с
 * `The "paths[0]" argument must be of type string`.
 *
 * Правило: ни один путь не зашивается в код. Сначала config, потом
 * переменная окружения, потом список кандидатов текущей платформы.
 */
import os from 'os';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { get } from './config.js';

export function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Кандидаты установки Chrome по платформам, в порядке предпочтения. */
function chromeCandidates() {
  const home = homeDir();
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
      path.join(pf, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ];
  }
  return [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
}

/**
 * Путь к исполняемому Chrome.
 * @param {string} [override] значение из аргументов инструмента
 * @returns {string|null} null — если Chrome не найден ни по одному пути
 */
export function resolveChromePath(override) {
  const explicit = override || get('chromePath') || process.env.FLOW_CHROME_PATH;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  return chromeCandidates().find((p) => fs.existsSync(p)) || null;
}

/** Куда Chrome кладёт профили по умолчанию на этой платформе. */
export function defaultUserDataDir() {
  const home = homeDir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, 'Google', 'Chrome', 'User Data');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return path.join(home, '.config', 'google-chrome');
}

export function resolveUserDataDir(override) {
  return override || get('chromeUserDataDir') || defaultUserDataDir();
}

/** Имя папки профиля: `Default`, `Profile 1` и т. п. */
export function resolveProfileName(override) {
  return override || get('chromeProfile') || 'Default';
}

/** Полный путь к папке профиля-исходника. */
export function resolveProfileSource(options = {}) {
  if (options.profileSource) return options.profileSource;
  return path.join(resolveUserDataDir(options.userDataDir), resolveProfileName(options.profile));
}

/** Корень для временного user-data-dir (os.tmpdir, а не `/tmp`). */
export function tempProfileRoot() {
  return path.join(os.tmpdir(), `flow-chrome-cdp-${process.pid}-${Date.now()}`);
}

/**
 * ПОСТОЯННЫЙ ПРОФИЛЬ АГЕНТА — рабочий режим по умолчанию.
 *
 * Почему не копия профиля пользователя. Куки Chrome лежат в `Profile/Network`,
 * и запущенный браузер держит эту папку: копирование падает с `EBUSY`, копия
 * уезжает без сессии, а Google отдаёт страницу «сервис недоступен в вашей
 * стране» — потому что аккаунта в этой копии нет. Проверено 10.08.2026 на
 * профиле Default. Чтобы копия получилась полной, пользователю пришлось бы
 * закрывать свой Chrome перед КАЖДОЙ генерацией.
 *
 * Отдельный профиль снимает всё разом: куки принадлежат нам и никем не
 * заблокированы, отладочный порт работает (Chrome 136+ глушит его только на
 * ДЕФОЛТНОМ user-data-dir), а основной браузер пользователя не трогается.
 * Цена — один вход руками при первом запуске.
 */
export function agentProfileDir() {
  const configured = get('agentProfileDir');
  if (configured) return configured;
  const home = path.resolve(fileDirname(), '..', '..');
  return path.join(home, 'chrome-profile-agent');
}

/**
 * Папка этого файла.
 *
 * ⚠️ Только через `fileURLToPath`. `new URL(import.meta.url).pathname`
 * отдаёт процентно-закодированный путь, и в каталоге с пробелом получается
 * `D:\MY%20PROJECT%20FOLDER\…` — Chrome заводит по такому пути пустой профиль
 * вместо нашего.
 */
function fileDirname() {
  return path.dirname(fileURLToPath(import.meta.url));
}

/** Заведён ли уже профиль агента (есть ли в нём хоть один вход). */
export function agentProfileReady() {
  const dir = agentProfileDir();
  return fs.existsSync(path.join(dir, 'Default', 'Network', 'Cookies'))
    || fs.existsSync(path.join(dir, 'Default', 'Cookies'));
}

/**
 * Что копируем из профиля во временный user-data-dir.
 *
 * Копировать профиль целиком нельзя: на Windows это гигабайты кэша, а часть
 * файлов заблокирована работающим Chrome. Для авторизации в Google нужны
 * только сессионные данные — куки (в Windows-профиле лежат в `Network/`),
 * настройки и локальное хранилище.
 */
export const PROFILE_ENTRIES = [
  'Network',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Local Extension Settings',
  'Sync Data',
  'Preferences',
  'Secure Preferences',
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data For Account',
  'Web Data',
  'Trust Tokens',
  'Affiliation Database',
];

/**
 * Копирует сессионные данные профиля во временный user-data-dir.
 * Заблокированные файлы пропускаются, а не роняют запуск: Chrome держит
 * часть SQLite-файлов открытыми, и на Windows это `EBUSY`/`EPERM`.
 *
 * @returns {{copied: string[], skipped: {name: string, reason: string}[]}}
 */
export function copyProfileSession(profileSource, tempDir, profileName) {
  const target = path.join(tempDir, profileName);
  fs.mkdirSync(target, { recursive: true });

  const copied = [];
  const skipped = [];

  /**
   * Копирование ПОФАЙЛОВО, а не папкой целиком.
   *
   * ⚠️ `fs.cpSync` на каталоге падает на первом же заблокированном файле и
   * бросает всю папку. Именно так терялись куки: в `Network/` лежит и
   * `Cookies`, и журналы, которые Chrome держит открытыми, — папка уезжала
   * целиком, профиль получался без сессии, а Google показывал «сервис
   * недоступен в вашей стране». Поймано 10.08.2026.
   */
  const copyTree = (src, dst) => {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      let ok = 0;
      let fail = 0;
      for (const name of fs.readdirSync(src)) {
        const r = copyTree(path.join(src, name), path.join(dst, name));
        ok += r.ok;
        fail += r.fail;
      }
      return { ok, fail };
    }
    try {
      fs.copyFileSync(src, dst);
      return { ok: 1, fail: 0 };
    } catch {
      return { ok: 0, fail: 1 };
    }
  };

  for (const entry of PROFILE_ENTRIES) {
    const src = path.join(profileSource, entry);
    if (!fs.existsSync(src)) continue;
    const { ok, fail } = copyTree(src, path.join(target, entry));
    if (ok) copied.push(fail ? `${entry} (${ok} из ${ok + fail})` : entry);
    if (!ok) skipped.push({ name: entry, reason: 'все файлы заблокированы' });
  }

  // `Local State` лежит рядом с профилем и хранит ключ шифрования кук.
  // Без него Chrome заведётся, но сессия Google не расшифруется.
  const localStateSrc = path.join(path.dirname(profileSource), 'Local State');
  const localStateDst = path.join(tempDir, 'Local State');
  try {
    if (fs.existsSync(localStateSrc)) {
      fs.cpSync(localStateSrc, localStateDst, { force: true });
      copied.push('Local State');
    } else {
      fs.writeFileSync(localStateDst, JSON.stringify({ profile: { info_cache: {} } }));
    }
  } catch (err) {
    skipped.push({ name: 'Local State', reason: err.code || err.message });
    if (!fs.existsSync(localStateDst)) {
      fs.writeFileSync(localStateDst, JSON.stringify({ profile: { info_cache: {} } }));
    }
  }

  return { copied, skipped };
}

/**
 * Удаление временной папки с повторами: Windows держит хэндлы ещё
 * несколько секунд после закрытия Chrome.
 */
export async function removeTempDir(dir, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return false;
}

/** Свободен ли TCP-порт на локальном интерфейсе. */
export function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Ищет свободный порт начиная с желаемого.
 *
 * Нужно потому, что обычный Chrome пользователя занимает 9222 и при этом
 * DevTools не отдаёт (Chrome 136+ на дефолтном профиле). Наш экземпляр на
 * этот порт просто не сядет, и ожидание CDP упрётся в таймаут без причины.
 */
export async function findFreePort(preferred, span = 40) {
  for (let p = preferred; p < preferred + span; p += 1) {
    if (await portFree(p)) return p;
  }
  return null;
}

/** Работает ли DevTools-эндпоинт: порт может слушаться, а /json/version — нет. */
export async function cdpAlive(cdpUrl, timeoutMs = 2500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return resp.ok;
  } catch {
    return false;
  }
}
