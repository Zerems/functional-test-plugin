/**
 * Writers for the host-project files created by /setup: config.json, pitfalls.md, excluded.json,
 * .mcp.json, .env.example and .gitignore. Text transformations are pure; `writeHostFiles` does the
 * file system work through an injectable `fs`. `.env` is never written (secrets stay with the user).
 */
import nodeFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, requiredEnvVars } from '../config.mjs';
import { translator } from '../i18n.mjs';
import { IGNORED } from '../preflight.mjs';
import { profileDir } from '../session.mjs';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'templates');
const DRIVER_TEMPLATES = { 'playwright-mcp': 'playwright-mcp' };
// Unverified community servers: never written to .mcp.json, their install command is printed.
const COMMUNITY_TEMPLATES = { 'cypress-mcp': 'cypress-mcp', 'robotframework-mcp': 'robotframework-mcp' };
const TEST_MCP_TEMPLATES = { playwright: 'playwright-test' };

export const ENV_BLOCK_START = '# >>> functional-test';
export const ENV_BLOCK_END = '# <<< functional-test';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toPosix = (p) => p.split(path.sep).join('/');

/** The MCP template `name` (templates are always read from the plugin, never from the host). */
function readTemplateFile(name) {
  return JSON.parse(nodeFs.readFileSync(path.join(TEMPLATES_DIR, 'mcp', `${name}.json`), 'utf8'));
}

/** `servers` of the MCP template `name`. */
const readTemplate = (name) => readTemplateFile(name).servers;

/**
 * `{ command, pin }` for a community browser driver (cypress-mcp, robotframework-mcp): the
 * install command line of its template and its pin note; null for any other driver.
 */
export function communityDriverInstall(driver) {
  if (!Object.hasOwn(COMMUNITY_TEMPLATES, driver)) return null;
  const template = readTemplateFile(COMMUNITY_TEMPLATES[driver]);
  const { command, args = [] } = template.servers.external;
  return { command: [command, ...args].join(' '), pin: template._pin };
}

/** Deep copy of an entry template with every `{{name}}` of its strings replaced from `values`. */
function fill(value, values) {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
  if (Array.isArray(value)) return value.map((item) => fill(item, values));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, values)]));
  return value;
}

/**
 * The `.mcp.json` entries the config needs, `{ [serverName]: entry }`: one per session of any
 * environment (the driver template picked by `browser.driver` and the session mode; none for a
 * custom driver, an unverified community driver or an external Playwright session), plus the
 * test MCP server of the automation
 * framework when it is known (Playwright only).
 */
export function mcpEntriesFor(config, root) {
  const entries = {};
  const templates = DRIVER_TEMPLATES[config.browser?.driver] ? readTemplate(DRIVER_TEMPLATES[config.browser.driver]) : {};
  for (const [name, session] of Object.entries(config.sessions ?? {})) {
    const template = templates[session.mode] ?? templates.external;
    if (!template || Object.hasOwn(entries, session.mcpServer)) continue;
    entries[session.mcpServer] = fill(template, {
      engine: config.browser.engine,
      viewport: config.browser.viewport,
      profileDir: toPosix(path.relative(root, profileDir(root, name))),
      storageState: session.file,
    });
  }
  const testServer = config.automation?.testMcpServer;
  const testTemplate = TEST_MCP_TEMPLATES[config.automation?.framework];
  if (testServer && testTemplate && !Object.hasOwn(entries, testServer)) entries[testServer] = readTemplate(testTemplate).test;
  return entries;
}

/**
 * New text of `.mcp.json` (`existingText` is null when the file is absent): servers missing from it
 * are added, existing keys are never replaced, unknown top-level keys are kept. The error for
 * unusable content never quotes it (it may hold tokens).
 */
export function mergeMcpJson(existingText, entries) {
  let parsed = { mcpServers: {} };
  if (existingText !== null) {
    try {
      parsed = JSON.parse(existingText);
    } catch {
      throw new ConfigError(['.mcp.json is not valid JSON']);
    }
    if (!isObject(parsed) || (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers))) {
      throw new ConfigError(['.mcp.json must be a JSON object whose "mcpServers" is an object']);
    }
  }
  parsed.mcpServers ??= {};
  for (const [name, entry] of Object.entries(entries)) {
    if (!Object.hasOwn(parsed.mcpServers, name)) parsed.mcpServers[name] = entry;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Locale key and params describing what each environment variable of the config is for. */
function purposes(config) {
  const map = new Map();
  const tracker = { JIRA_EMAIL: 'setup.purpose.JIRA_EMAIL', JIRA_API_TOKEN: 'setup.purpose.JIRA_API_TOKEN', GITHUB_TOKEN: 'setup.purpose.GITHUB_TOKEN' };
  for (const [name, key] of Object.entries(tracker)) map.set(name, { key, params: {} });
  for (const [auth, section] of Object.entries(config.auth ?? {})) {
    const params = { auth };
    if (section?.usernameEnv) map.set(section.usernameEnv, { key: 'setup.purpose.authUsername', params });
    if (section?.passwordEnv) map.set(section.passwordEnv, { key: 'setup.purpose.authPassword', params });
    if (section?.tokenEnv) map.set(section.tokenEnv, { key: 'setup.purpose.authToken', params });
  }
  return map;
}

/** The delimited `.env.example` block (no trailing newline): required variables, then optional ones. */
export function envExampleBlock(config, t) {
  const { required, optional } = requiredEnvVars(config);
  const known = purposes(config);
  const variable = (name) => {
    const { key, params } = known.get(name) ?? { key: 'setup.purpose.other', params: {} };
    return [`# ${t(key, params)}`, `${name}=`];
  };
  const lines = [ENV_BLOCK_START, ...required.flatMap(variable)];
  if (optional.length > 0) lines.push('# optional', ...optional.flatMap(variable));
  lines.push(ENV_BLOCK_END);
  return lines.join('\n');
}

/** `.env.example` text with `block` in place of its previous version, else appended after a blank line. */
export function appendEnvExample(existing, block) {
  const text = existing ?? '';
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === ENV_BLOCK_START);
  const end = lines.findIndex((line, i) => i > start && line.trim() === ENV_BLOCK_END);
  if (start !== -1 && end !== -1) return [...lines.slice(0, start), block, ...lines.slice(end + 1)].join('\n');
  if (text.trim() === '') return `${block}\n`;
  return `${text.replace(/\n*$/, '\n')}\n${block}\n`;
}

/** Lines of `['.env', '.auth/']` the `.gitignore` text (null when absent) does not already cover. */
export function gitignoreAdditions(existing) {
  const present = new Set((existing ?? '').split(/\r?\n/).map((line) => line.trim()));
  return Object.keys(IGNORED).filter((name) => !IGNORED[name].some((pattern) => present.has(pattern)));
}

function readText(fs, file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Writes the host files and returns their paths relative to `root`: `written` and `skipped` (already
 * there, or nothing to add). `config.json` is always written; the pitfalls and excluded files only
 * when absent (their location is the one the config names); `.mcp.json`, `.env.example` and
 * `.gitignore` are merged and only rewritten when their text changes. Nothing is written before
 * `.mcp.json` has been parsed, so a malformed one stops the setup untouched.
 */
export function writeHostFiles(root, config, { fs = nodeFs, t = translator(config.language ?? 'en') } = {}) {
  const written = [];
  const skipped = [];
  const rel = (file) => toPosix(path.relative(root, file));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.push(rel(file));
  };
  const writeIfChanged = (file, before, after) => {
    if (before === after) skipped.push(rel(file));
    else write(file, after);
  };
  const template = (name) => nodeFs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');

  const configDir = path.join(root, '.claude', 'functional-test');
  const files = {
    config: path.join(configDir, 'config.json'),
    pitfalls: path.resolve(root, config.pitfallsFile ?? path.join(configDir, 'pitfalls.md')),
    excluded: path.resolve(root, config.automation?.excludedFile ?? path.join(configDir, 'excluded.json')),
    mcp: path.join(root, '.mcp.json'),
    envExample: path.join(root, '.env.example'),
    gitignore: path.join(root, '.gitignore'),
  };

  const entries = mcpEntriesFor(config, root);
  const mcpBefore = readText(fs, files.mcp);
  const mcpAfter = mcpBefore === null && Object.keys(entries).length === 0 ? null : mergeMcpJson(mcpBefore, entries);
  const envBefore = readText(fs, files.envExample);
  const gitignoreBefore = readText(fs, files.gitignore);

  write(files.config, `${JSON.stringify(config, null, 2)}\n`);
  for (const [file, name] of [[files.pitfalls, 'pitfalls.md'], [files.excluded, 'excluded.json']]) {
    if (fs.existsSync(file)) skipped.push(rel(file));
    else write(file, template(name));
  }
  if (mcpAfter === null) skipped.push(rel(files.mcp));
  else writeIfChanged(files.mcp, mcpBefore, mcpAfter);
  writeIfChanged(files.envExample, envBefore, appendEnvExample(envBefore, envExampleBlock(config, t)));
  const additions = gitignoreAdditions(gitignoreBefore);
  if (additions.length === 0) skipped.push(rel(files.gitignore));
  else write(files.gitignore, `${gitignoreBefore && !gitignoreBefore.endsWith('\n') ? `${gitignoreBefore}\n` : (gitignoreBefore ?? '')}${additions.join('\n')}\n`);

  if (Object.keys(config.sessions ?? {}).length > 0) fs.mkdirSync(path.join(root, '.auth'), { recursive: true });
  return { written, skipped };
}
