import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';
import { get } from '../utils/config.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';
import { takeScreenshot } from '../utils/screenshots.js';
import {
  resolveChromePath,
  resolveProfileSource,
  resolveProfileName,
  tempProfileRoot,
  copyProfileSession,
  removeTempDir,
  cdpAlive,
  findFreePort,
  agentProfileDir,
  agentProfileReady,
} from '../utils/platform.js';

let browser = null;
let context = null;
let page = null;
let isConnected = false;

export async function connectToBrowser(options = {}) {
  if (isConnected && page) {
    logger.info('Already connected to browser');
    return { browser, context, page };
  }

  const cdpPort = options.cdpPort || get('cdpPort', 9222);
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;

  try {
    // Try connecting to existing Chrome instance via CDP
    logger.info('Attempting CDP connection', { url: cdpUrl });
    browser = await chromium.connectOverCDP(cdpUrl);
    logger.info('Connected via CDP');

    const contexts = browser.contexts();
    if (contexts.length > 0) {
      context = contexts[0];
    } else {
      context = await browser.newContext();
    }

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    isConnected = true;
    logger.info('Browser connected successfully');
    return { browser, context, page };
  } catch (err) {
    logger.warn('CDP connection failed, will launch new browser', { error: err.message });
    return await launchNewBrowser(cdpPort, options);
  }
}

async function launchNewBrowser(cdpPort, options = {}) {
  const chromePath = resolveChromePath(options.chromePath);
  const profileDir = options.profileDir || path.resolve(import.meta.dirname, '../../chrome-profile-kiara');

  if (!chromePath) {
    throw new FlowError(ErrorCodes.PLAYWRIGHT_ERROR,
      'Chrome не найден. Укажи "chromePath" в config/flow.config.json.');
  }

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    `--window-size=1920,1080`,
  ];

  if (get('headless', false)) {
    args.push('--headless=new');
  }

  // Kill any existing Chrome on this debugging port
  try {
    const existing = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    await existing.close();
  } catch (e) {
    // No existing instance, that's fine
  }

  logger.info('Launching Chrome with Kiara profile', {
    chromePath,
    profileDir,
    cdpPort,
  });

  browser = await chromium.launch({
    executablePath: chromePath,
    args,
    headless: false,
  });

  context = browser.contexts()[0] || await browser.newContext();
  page = context.pages()[0] || await context.newPage();
  isConnected = true;

  logger.info('New browser launched successfully');
  return { browser, context, page };
}

/**
 * Запускает Chrome НАПРЯМУЮ (не через Playwright), чтобы не палиться
 * автоматизацией (`navigator.webdriver === false`): делает временный
 * user-data-dir с куками рабочего профиля, поднимает Chrome процессом,
 * затем цепляет Playwright по CDP.
 *
 * ⚠️ Копия профиля — не паранойя, а обязательное условие. Chrome 136+
 * игнорирует `--remote-debugging-port`, если user-data-dir дефолтный:
 * порт слушается, но `/json/version` отдаёт 404, и `connectOverCDP`
 * виснет. Отладочный порт работает только на отдельной папке профиля.
 */
export async function launchChromeDirect(options = {}) {
  const chromePath = resolveChromePath(options.chromePath);
  const preferredPort = options.cdpPort || get('cdpPort', 9222);
  const headless = options.headless ?? get('headless', false);
  const profileSource = resolveProfileSource(options);
  const profileName = resolveProfileName(options.profile);

  if (isConnected && page) {
    logger.info('Already connected, reusing browser');
    return { browser, context, page };
  }

  if (!chromePath) {
    throw new FlowError(ErrorCodes.PLAYWRIGHT_ERROR,
      'Chrome не найден ни по одному стандартному пути. '
      + 'Укажи "chromePath" в config/flow.config.json.');
  }
  /* ── Выбор user-data-dir ────────────────────────────────────────────────
     `agent` (по умолчанию) — свой постоянный профиль. Куки наши, ничем не
     заблокированы, вход делается один раз руками.
     `copy` — старое поведение: копия профиля пользователя. Оставлено для
     разовых задач, но в бою бесполезно: работающий Chrome держит
     `Profile/Network`, копия уезжает без кук, и Google показывает заглушку
     «сервис недоступен в вашей стране». */
  const mode = options.profileMode || get('profileMode', 'agent');
  let tempDir;
  let persistent = false;

  if (mode === 'agent') {
    tempDir = agentProfileDir();
    persistent = true;
    fs.mkdirSync(tempDir, { recursive: true });
    logger.info('Using persistent agent profile', {
      dir: tempDir,
      signedIn: agentProfileReady(),
    });
  } else {
    if (!fs.existsSync(profileSource)) {
      throw new FlowError(ErrorCodes.CONFIG_ERROR,
        `Профиль не найден: ${profileSource}. Проверь "chromeUserDataDir" и "chromeProfile" `
        + 'в config/flow.config.json (путь виден в chrome://version → Profile Path).');
    }
    tempDir = tempProfileRoot();
    fs.mkdirSync(tempDir, { recursive: true });
    const { copied, skipped } = copyProfileSession(profileSource, tempDir, profileName);
    if (skipped.some((s) => s.name === 'Network')) {
      logger.warn('Cookies were locked by the running Chrome — session will be incomplete. '
        + 'Close Chrome or switch profileMode to "agent".', { skipped });
    }
    logger.info('Temp profile created', { tempDir, copied: copied.length, skipped });
  }

  // Наш прежний экземпляр гасим, чужой Chrome на этом порту — не трогаем,
  // а уходим на соседний свободный порт.
  const preferredUrl = `http://127.0.0.1:${preferredPort}`;
  if (global.__chromeTempDir && await cdpAlive(preferredUrl)) {
    try {
      const existing = await chromium.connectOverCDP(preferredUrl);
      await existing.close();
      await new Promise(r => setTimeout(r, 1000));
    } catch { }
  }

  const cdpPort = await findFreePort(preferredPort);
  if (!cdpPort) {
    throw new FlowError(ErrorCodes.PLAYWRIGHT_ERROR,
      `Нет свободного порта в диапазоне ${preferredPort}–${preferredPort + 39} для CDP.`);
  }
  if (cdpPort !== preferredPort) {
    logger.warn('Preferred CDP port busy, using another', { preferredPort, cdpPort });
  }
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tempDir}`,
    // В своём профиле папка всегда `Default`: имя профиля пользователя тут
    // ни при чём, а несовпадение имени с содержимым Chrome молча игнорирует
    // и заводит пустой профиль — то есть без сессии.
    `--profile-directory=${persistent ? 'Default' : profileName}`,
    '--no-first-run', '--no-default-browser-check',
    /* ⚠️ `--disable-blink-features=AutomationControlled` УБРАН намеренно.
       Он был нужен апстриму, который поднимал Chrome через Playwright с
       ключом автоматизации. Мы запускаем chrome.exe сами и этот ключ не
       передаём, поэтому `navigator.webdriver` и без флага равен false —
       проверено логом подключения. Зато сам флаг Chrome считает
       неподдерживаемым и рисует владельцу жёлтую полосу «стабильность и
       безопасность будут нарушены». Маскировка, которая себя выдаёт. */
    '--window-size=1920,1080',
  ];
  if (headless) args.push('--headless=new');

  logger.info('Launching Chrome directly', { chromePath, cdpPort, headless, profileName });

  /*
    ⚠️ Постоянный профиль запускается ОТВЯЗАННЫМ процессом.
    Раньше Chrome был дочерним процессом node: закрыл терминал — окно
    умерло вместе со скриптом, вместе с ним и вход. Для профиля агента это
    неверно: браузер обязан пережить и скрипт, и терминал, чтобы следующий
    запуск просто подключился к нему по отладочному порту.
    Временная копия профиля отвязки не получает: она живёт ровно один
    прогон, и оставлять её висеть незачем.
  */
  const chromeProcess = spawn(chromePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    detached: persistent,
  });
  if (persistent) chromeProcess.unref();
  let spawnError = null;
  chromeProcess.on('error', (err) => { spawnError = err; });
  global.__chromeProcess = chromeProcess;

  let ready = false;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (spawnError) {
      throw new FlowError(ErrorCodes.PLAYWRIGHT_ERROR,
        `Не удалось запустить Chrome (${chromePath}): ${spawnError.message}`);
    }
    if (await cdpAlive(cdpUrl)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) {
    throw new FlowError(ErrorCodes.PLAYWRIGHT_ERROR,
      `Chrome не поднял CDP на ${cdpUrl} за 25с. Частая причина — уже запущенный Chrome `
      + 'на том же user-data-dir: закрой окна Chrome и повтори.');
  }

  browser = await chromium.connectOverCDP(cdpUrl);
  context = browser.contexts()[0] || await browser.newContext();
  page = context.pages()[0] || await context.newPage();
  isConnected = true;
  // Постоянный профиль удалять НЕЛЬЗЯ — в нём живёт вход пользователя.
  // Под уборку помечается только временная копия.
  global.__chromeTempDir = persistent ? null : tempDir;

  logger.info('Chrome direct + CDP connected', { webdriver: await page.evaluate(() => navigator.webdriver) });
  return { browser, context, page };
}

export async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (err) {
      logger.warn('Error closing browser', { error: err.message });
    }
  }
  /* Порядок важен: Windows не отдаёт папку, пока жив процесс Chrome.
     Но браузер агента НЕ убиваем — он живёт между запусками, и следующий
     скрипт подключится к нему вместо того, чтобы поднимать новый и снова
     просить вход. Гасим только временную копию профиля. */
  if (global.__chromeTempDir && global.__chromeProcess && !global.__chromeProcess.killed) {
    try { global.__chromeProcess.kill(); } catch { }
    global.__chromeProcess = null;
  }
  if (global.__chromeTempDir) {
    const ok = await removeTempDir(global.__chromeTempDir);
    if (!ok) logger.warn('Temp cleanup failed', { dir: global.__chromeTempDir });
    global.__chromeTempDir = null;
  }
  browser = null;
  context = null;
  page = null;
  isConnected = false;
  logger.info('Browser disconnected');
}

export function getPage() {
  if (!page) {
    throw new FlowError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Browser not connected. Call connectToBrowser() first.');
  }
  return page;
}

export function getContext() {
  return context;
}

export function isBrowserConnected() {
  return isConnected;
}

export function setPage(newPage) {
  page = newPage;
}

export function getBrowser() {
  return browser;
}

export function setBrowser(b) {
  browser = b;
}

export function setConnected(connected) {
  isConnected = connected;
}

export function setContext(ctx) {
  context = ctx;
}
