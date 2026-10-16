import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_HOME = path.resolve(__dirname, '..', '..');

const configPath = path.join(FLOW_HOME, 'config', 'flow.config.json');
let config;

try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw);
} catch (err) {
  console.error(`[CONFIG] Failed to load config from ${configPath}: ${err.message}`);
  config = {};
}

export default config;

export function get(key, fallback = undefined) {
  return config[key] !== undefined ? config[key] : fallback;
}

/**
 * Корень форка. `flowHome: "."` в конфиге раньше означал «текущая папка
 * процесса»: MCP-сервер запускают из произвольного каталога, и outputs
 * с логами разъезжались по диску. Относительные значения теперь
 * разрешаются от папки форка, а не от cwd.
 */
export function getFlowHome() {
  const configured = config.flowHome;
  if (!configured || configured === '.') return FLOW_HOME;
  return path.isAbsolute(configured) ? configured : path.resolve(FLOW_HOME, configured);
}
