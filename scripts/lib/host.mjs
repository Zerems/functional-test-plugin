import fs from 'node:fs';
import path from 'node:path';

const CONFIG_REL = path.join('.claude', 'functional-test', 'config.json');

/**
 * Walk up from startDir to the filesystem root and return the nearest
 * directory holding `.claude/functional-test/config.json`, or null.
 */
export function findHostRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Absolute paths of every host-project file the plugin reads or writes. */
export function hostPaths(root) {
  const configDir = path.join(root, '.claude', 'functional-test');
  return {
    root,
    configDir,
    config: path.join(configDir, 'config.json'),
    pitfallsDefault: path.join(configDir, 'pitfalls.md'),
    excludedDefault: path.join(configDir, 'excluded.json'),
    authDir: path.join(root, '.auth'),
    env: path.join(root, '.env'),
    envExample: path.join(root, '.env.example'),
    mcp: path.join(root, '.mcp.json'),
    gitignore: path.join(root, '.gitignore'),
  };
}
