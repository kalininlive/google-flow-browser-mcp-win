import { chromium } from 'playwright';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { get } from '../utils/config.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';
import { launchChromeDirect, setPage, setContext, setConnected, setBrowser, isBrowserConnected } from './connect.js';
import {
  resolveChromePath,
  resolveProfileSource,
  resolveProfileName,
  cdpAlive,
} from '../utils/platform.js';

const CDP_PORT = get('cdpPort', 9222);
const FLOW_URL = get('flowUrl', 'https://labs.google/fx/fr/tools/flow');

export async function launchKiaraProfile(headless = false) {
  if (isBrowserConnected()) {
    logger.info('Browser already connected, reusing');
    return { success: true, message: 'Already connected' };
  }

  const chromePath = resolveChromePath();
  const profileSource = resolveProfileSource();
  const profileName = resolveProfileName();
  const cdpUrl = `http://127.0.0.1:${CDP_PORT}`;

  if (!chromePath) {
    throw new FlowError(ErrorCodes.CONFIG_ERROR,
      'Chrome не найден ни по одному стандартному пути этой платформы. '
      + 'Укажи "chromePath" в config/flow.config.json.');
  }
  if (!fs.existsSync(profileSource)) {
    throw new FlowError(ErrorCodes.CONFIG_ERROR,
      `Профиль не найден: ${profileSource}. Открой chrome://version → "Profile Path" `
      + 'и впиши папку выше в "chromeUserDataDir", а имя профиля — в "chromeProfile".');
  }

  logger.info('Launching Chrome via direct+CDP method (anti-detection)',
    { chromePath, profileSource, profileName, platform: process.platform });

  // Живой CDP проверяется запросом, а не попыткой коннекта: Chrome 136+ на
  // дефолтном user-data-dir слушает порт, но отдаёт 404 на /json/version,
  // и connectOverCDP в этом случае висит до таймаута вместо честной ошибки.
  if (await cdpAlive(cdpUrl)) {
    try {
      const existing = await chromium.connectOverCDP(cdpUrl);
      logger.info('Found existing Chrome instance, reusing');
      const ctx = existing.contexts()[0] || await existing.newContext();
      const pg = ctx.pages()[0] || await ctx.newPage();
      setBrowser(existing);
      setContext(ctx);
      setPage(pg);
      setConnected(true);
      return { browser: existing, context: ctx, page: pg };
    } catch (err) {
      logger.warn('CDP alive but attach failed, launching own Chrome', { error: err.message });
    }
  }

  return await launchChromeDirect({
    chromePath,
    cdpPort: CDP_PORT,
    headless,
    profileSource,
    profile: profileName,
  });
}

export async function navigateToFlow(page, toolPage) {
  const targetUrl = toolPage === true
    ? 'https://labs.google/fx/fr/tools/flow'
    : FLOW_URL;

  logger.info('Navigating to Google Flow', { url: targetUrl });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  logger.info('Flow page loaded', { url: currentUrl.substring(0, 100) });

  if (currentUrl.includes('accounts.google.com')) {
    return { authenticated: false, url: currentUrl,
      message: 'OAuth blocked — Google detects automation. Use Chrome direct+CDP launch method.' };
  }

  return { authenticated: true, url: currentUrl };
}
