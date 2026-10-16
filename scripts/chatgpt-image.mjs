/**
 * ГЕНЕРАЦИЯ КАРТИНКИ В CHATGPT — детерминированный скрипт, без модели в цикле.
 *
 *   node scripts/chatgpt-image.mjs --prompt "..." --out "D:/path/scene_001.png"
 *   node scripts/chatgpt-image.mjs --jsonl prompts.jsonl --dir "D:/out/dir"
 *   node scripts/chatgpt-image.mjs --url <project-url> ...
 *
 * Работает в профиле агента: там уже выполнен вход в ChatGPT. Если окно с
 * отладочным портом уже открыто — скрипт ПОДКЛЮЧАЕТСЯ к нему, а не поднимает
 * второй Chrome: два экземпляра на одной папке профиля не живут, второй
 * просто передаёт команду первому и выходит.
 *
 * Картинка забирается не «кнопкой Скачать», а запросом из самой страницы:
 * `fetch` с куками вкладки возвращает байты, они уходят в base64 и пишутся
 * на диск. Так системное окно «Сохранить как» вообще не участвует — а оно
 * включено у владельца и остановило бы любую пакетную загрузку.
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { launchChromeDirect, getPage, getContext, setPage } from '../src/browser/connect.js';
import { cdpAlive } from '../src/utils/platform.js';

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const PROJECT_URL = arg(
  'url',
  process.env.CHATGPT_PROJECT_URL || 'https://chatgpt.com/'
);
const TIMEOUT_MS = Number(arg('timeout', 60000));

/** Подключиться к уже открытому окну агента, иначе поднять своё. */
async function connect() {
  for (let port = 9222; port <= 9240; port += 1) {
    const url = `http://127.0.0.1:${port}`;
    if (!(await cdpAlive(url, 700))) continue;
    try {
      const browser = await chromium.connectOverCDP(url);
      const ctx = browser.contexts()[0];
      const pages = ctx?.pages() ?? [];
      console.log(`  подключился к открытому окну, порт ${port}, вкладок ${pages.length}`);
      return { browser, ctx, page: pages[0] ?? (await ctx.newPage()) };
    } catch { /* порт занят чем-то другим */ }
  }
  console.log('  открытого окна нет — поднимаю своё');
  await launchChromeDirect({ profileMode: 'agent', headless: false });
  return { browser: null, ctx: getContext(), page: getPage() };
}

/** Поле ввода промпта. Селекторы перечислены по убыванию надёжности. */
async function composer(page) {
  const candidates = [
    '#prompt-textarea',
    'div#prompt-textarea',
    'div[contenteditable="true"]',
    'p[data-placeholder]',
    'form textarea',
    'textarea',
    '[contenteditable="true"]',
  ];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const sel of candidates) {
      const el = page.locator(sel).last();
      if (await el.count().catch(() => 0)) {
        if (await el.isVisible().catch(() => false)) return el;
      }
    }
    const newChatBtn = page.locator('button:has-text("New chat"), a:has-text("New chat"), button:has-text("Start chat"), button[aria-label="New chat"]').first();
    if ((await newChatBtn.count().catch(() => 0)) && (await newChatBtn.isVisible().catch(() => false))) {
      await newChatBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(1500);
    }
  }
  return null;
}

/** Ждём картинку в ответе: у сгенерированных src ведёт на хранилище OpenAI. */
/** Ждём картинку в ответе: у сгенерированных src ведёт на хранилище OpenAI. */
/** Ждём картинку в ответе: у сгенерированных src ведёт на хранилище OpenAI. */
async function waitForImage(page, beforeSet, timeout = 60000) {
  const started = Date.now();
  let lastCount = -1;
  while (Date.now() - started < timeout) {
    const urls = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('img')) {
        const s = img.currentSrc || img.src || '';
        if (/oaiusercontent|\/backend-api\/[^"']*content|^blob:https:\/\/chatgpt\.com\//.test(s)) {
          // Сгенерированный кадр DALL-E имеет размер > 600px
          if (img.naturalWidth > 600 || img.naturalHeight > 600) {
            out.push({ src: s, w: img.naturalWidth, h: img.naturalHeight });
          }
        }
      }
      return out;
    });

    const newImgs = urls.filter((u) => !beforeSet || !beforeSet.has(u.src));
    if (newImgs.length > 0) return newImgs[newImgs.length - 1];

    if (urls.length !== lastCount) {
      lastCount = urls.length;
      process.stdout.write(`\r  жду новую картинку… ${Math.round((Date.now() - started) / 1000)}с`);
    }
    await page.waitForTimeout(2500);
  }

  // Если за 60с картинка не прилетела в стрим — обновляем страницу (часто она уже отрендерена сервером)
  console.log(`\n  ⏳ Картинка не пришла за ${Math.round(timeout / 1000)}с — обновляю страницу для проверки...`);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const reloadedUrls = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('img')) {
        const s = img.currentSrc || img.src || '';
        if (/oaiusercontent|\/backend-api\/[^"']*content|^blob:https:\/\/chatgpt\.com\//.test(s)) {
          if (img.naturalWidth > 600 || img.naturalHeight > 600) {
            out.push({ src: s, w: img.naturalWidth, h: img.naturalHeight });
          }
        }
      }
      return out;
    });
    const reloadedImgs = reloadedUrls.filter((u) => !beforeSet || !beforeSet.has(u.src));
    if (reloadedImgs.length > 0) {
      console.log('  ✓ Найдена картинка после обновления страницы!');
      return reloadedImgs[reloadedImgs.length - 1];
    }
  } catch (err) {
    console.error(`  ⚠ Ошибка при обновлении страницы: ${err.message}`);
  }

  return null;
}

/** Скачиваем байты изнутри страницы: куки вкладки уже приложены. */
async function download(page, url, outPath) {
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, url);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return fs.statSync(outPath).size;
}

/** Забрать последнюю картинку из открытого чата, ничего не отправляя. */
async function grabLast(page, outPath) {
  const img = await waitForImage(page, null, 20000);
  process.stdout.write('\n');
  if (!img) throw new Error('в открытом чате картинки нет');
  const bytes = await download(page, img.src, outPath);
  console.log(`  ✓ ${path.basename(outPath)} — ${img.w}×${img.h}, ${Math.round(bytes / 1024)} КБ`);
  return { path: outPath, width: img.w, height: img.h, bytes };
}

async function generateOne(page, prompt, outPath, refFile = null) {
  const beforeList = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .map((i) => i.currentSrc || i.src || '')
      .filter((s) => /oaiusercontent|\/backend-api\/[^"']*content|^blob:https:\/\/chatgpt\.com\//.test(s))
  );
  const beforeSet = new Set(beforeList);

  // Резолвим путь к референсу персонажа
  let resolvedRef = null;
  const refCandidate = typeof refFile === 'string' ? refFile : (arg('ref') || null);
  if (refCandidate) {
    const candidates = [
      refCandidate,
      path.resolve(process.cwd(), refCandidate),
      path.resolve(process.cwd(), '..', refCandidate),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        resolvedRef = c;
        break;
      }
    }
  }

  if (resolvedRef && fs.existsSync(resolvedRef)) {
    const fileInput = page.locator('input[type="file"][data-testid="upload-photos-input"], input[type="file"][accept*="image"], input[type="file"]').first();
    if (await fileInput.count().catch(() => 0)) {
      await fileInput.setInputFiles(resolvedRef);
      console.log(`  📎 прикрепил файл референса: ${path.basename(resolvedRef)}`);
      await page.waitForTimeout(4000);
    }
  }

  const box = await composer(page);
  if (!box) throw new Error('поле ввода не найдено — вёрстка ChatGPT изменилась');

  await box.click();
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log('  промпт отправлен');

  const img = await waitForImage(page, beforeSet, TIMEOUT_MS);
  process.stdout.write('\n');
  if (!img) throw new Error(`картинка не появилась за ${TIMEOUT_MS / 1000}с (включая проверку после обновления)`);

  const bytes = await download(page, img.src, outPath);
  console.log(`  ✓ ${path.basename(outPath)} — ${img.w}×${img.h}, ${Math.round(bytes / 1024)} КБ`);
  return { path: outPath, width: img.w, height: img.h, bytes };
}

// ── main ────────────────────────────────────────────────────────────────────
const { page } = await connect();

/*
  ⚠️ ВСЕГДА начинаем со страницы ПРОЕКТА, а не с того, что было открыто.
  Первая версия переиспользовала уже открытый чат, если вкладка была на
  chatgpt.com, — и генерация уходила в обычный чат МИМО проекта. А проект и
  есть источник стиля: там инструкции и файлы (STYLE.md, CHARACTERS.md,
  SHOT_RULES.md, референсы). Кадр, сделанный вне проекта, стиль не держит.

  Новый чат на ролик создаётся сам: первое сообщение, отправленное со
  страницы проекта, заводит чат ВНУТРИ него. Дальше кадры одного ролика идут
  в этот же чат — так держится консистентность внутри ролика.
*/
if (!process.argv.includes('--grab-last')) {
  console.log(`  открываю проект: ${PROJECT_URL}`);
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  const inProject = page.url().includes('/project') || page.url().includes('/g/g-p-');
  console.log(`  страница проекта: ${inProject ? 'да' : 'НЕТ — ' + page.url().slice(0, 70)}`);
}
setPage(page);

const jobs = [];
if (arg('jsonl')) {
  const dir = arg('dir') || '.';
  for (const line of fs.readFileSync(arg('jsonl'), 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    const item = JSON.parse(t);
    jobs.push({ prompt: item.prompt, out: path.join(dir, `${item.id}.png`), ref: item.ref });
  }
} else {
  jobs.push({ prompt: arg('prompt'), out: arg('out'), ref: arg('ref') });
}

if (!jobs.length || !jobs[0].prompt || !jobs[0].out) {
  console.error('нужны --prompt и --out, либо --jsonl и --dir');
  process.exit(1);
}

let ok = 0;
for (const [i, job] of jobs.entries()) {
  console.log(`\n[${i + 1}/${jobs.length}] ${job.prompt.slice(0, 70)}…`);
  if (fs.existsSync(job.out) && fs.statSync(job.out).size > 40000) {
    console.log('  уже есть — пропускаю');
    ok += 1;
    continue;
  }
  try {
    if (process.argv.includes('--grab-last')) await grabLast(page, job.out);
    else await generateOne(page, job.prompt, job.out, job.ref || arg('ref'));
    ok += 1;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
  }
}

console.log(`\nГОТОВО: ${ok} из ${jobs.length}`);
process.exit(ok === jobs.length ? 0 : 1);
