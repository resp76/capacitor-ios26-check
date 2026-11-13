import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function checkProject(directory = '.') {
  const root = path.resolve(directory);
  const app = path.join(root, 'ios/App/App');
  const results = [];
  const add = (check, status, message) => results.push({ check, status, message });
  const plist = await readOptional(path.join(app, 'Info.plist'));
  let files;
  try { files = await readdir(app); }
  catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
  const swift = await Promise.all(files.filter(file => file.endsWith('.swift')).map(file => readFile(path.join(app, file), 'utf8')));
  const sources = swift.map(source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));
  const manifest = /<key>\s*UIApplicationSceneManifest\s*<\/key>/.test((plist ?? '').replace(/<!--[\s\S]*?-->/g, ''));
  const delegate = sources.some(source => /\bclass\s+\w+\s*:\s*[^\{]*\bUIWindowSceneDelegate\b/.test(source));
  add('uiscene', manifest && delegate ? 'PASS' : 'FAIL', manifest && delegate
    ? 'Scene manifest and UIWindowSceneDelegate found'
    : 'apps built with iOS 26 SDK crash at launch ("UIScene life cycle is required") — add scene manifest + SceneDelegate');

  let nativeConfig = {};
  const nativeText = await readOptional(path.join(app, 'capacitor.config.json'));
  try { if (nativeText !== null) nativeConfig = JSON.parse(nativeText); }
  catch { add('plugins', 'FAIL', 'Invalid ios/App/App/capacitor.config.json'); }
  const plugins = [...new Set(sources.flatMap(source => [...source.matchAll(/\bclass\s+(\w+)\s*:\s*(?:Capacitor\.)?CAPPlugin\b/g)].map(match => match[1])))];
  const registered = Array.isArray(nativeConfig?.packageClassList) ? nativeConfig.packageClassList : [];
  const missing = plugins.filter(name => !registered.includes(name));
  if (!results.some(result => result.check === 'plugins')) {
    add('plugins', missing.length ? 'FAIL' : 'PASS', missing.length
      ? `Missing packageClassList entries: ${missing.join(', ')}; cap sync regenerates packageClassList from node_modules and drops app-target plugins; JS object becomes undefined. Re-add after every sync.`
      : 'All app-target CAPPlugin classes are registered');
  }

  let webDir = 'www';
  // Read static config only: auditing must never execute project code.
  for (const extension of ['ts', 'js', 'mjs', 'cjs', 'json']) {
    const config = await readOptional(path.join(root, `capacitor.config.${extension}`));
    if (config === null) continue;
    if (extension === 'json') webDir = JSON.parse(config).webDir ?? 'www';
    else webDir = config.replace(/\/\*[\s\S]*?\*\//g, '').match(/\bwebDir\s*:\s*(['"`])([^'"`]+)\1/)?.[2] ?? nativeConfig?.webDir ?? 'www';
    break;
  }
  if (typeof webDir !== 'string' || !webDir) throw new Error('webDir must be a nonempty string');
  const nativeHtml = await readOptional(path.join(app, 'public/index.html'));
  const sourceHtml = await readOptional(path.resolve(root, webDir, 'index.html'));
  add('bundle-parity', nativeHtml !== null && sourceHtml !== null && nativeHtml !== sourceHtml ? 'WARN' : 'PASS',
    nativeHtml === null || sourceHtml === null ? 'Bundle parity not applicable: one or both index.html files are absent'
      : nativeHtml === sourceHtml ? 'Native and source index.html match' : 'stale native web bundle; run sync');

  try {
    const publicPath = path.join(app, 'public');
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', publicPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let ignored = false;
    try {
      execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', publicPath], { stdio: 'pipe' });
      ignored = true;
    } catch (error) { if (error.status !== 1) throw error; }
    add('gitignore', ignored && tracked.length ? 'WARN' : 'PASS', ignored && tracked.length
      ? "Native public is gitignored but contains tracked files; sync won't be committed without git add -f"
      : 'No ignored native public directory with tracked files');
  } catch {
    add('gitignore', 'WARN', 'Could not inspect gitignore trap (Git unavailable or project is not a Git repository)');
  }
  return results;
}
