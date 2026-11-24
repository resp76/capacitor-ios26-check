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
  // Documented route: bridge?.registerPluginInstance(X()) / registerPluginType(X.self) in a
  // CAPBridgeViewController subclass. That subclass only runs if it is the root view controller.
  const registeredBy = new Map();
  for (const source of sources) {
    const controllers = [...source.matchAll(/\bclass\s+(\w+)\s*:\s*(?:Capacitor\.)?CAPBridgeViewController\b/g)].map(match => match[1]);
    for (const match of source.matchAll(/\bregisterPlugin(?:Instance\(\s*(\w+)\s*\(|Type\(\s*(\w+)\.self\b)/g)) {
      registeredBy.set(match[1] ?? match[2], controllers);
    }
  }
  const plainRoot = sources.some(source => /\brootViewController\s*=\s*(?:Capacitor\.)?CAPBridgeViewController\s*\(/.test(source));
  const created = name => sources.some(source => new RegExp(`\\b${name}\\s*\\(`).test(source));
  const unused = [];
  const missing = [];
  for (const name of plugins) {
    if (registered.includes(name)) continue;
    const controllers = registeredBy.get(name);
    if (!controllers) missing.push(name);
    else if (controllers.length && plainRoot && !controllers.some(created)) unused.push(`${name} (${controllers.join(', ')})`);
  }
  if (!results.some(result => result.check === 'plugins')) {
    const problems = [];
    if (missing.length) problems.push(`No registration for ${missing.join(', ')}; JS object will be undefined. Call bridge?.registerPluginInstance(...) in capacitorDidLoad() of a CAPBridgeViewController subclass (packageClassList entries are removed by cap sync).`);
    if (unused.length) problems.push(`Registered in a view controller that is never created: ${unused.join(', ')}. The scene delegate sets rootViewController = CAPBridgeViewController(); create the subclass there instead.`);
    add('plugins', problems.length ? 'FAIL' : 'PASS', problems.length ? problems.join(' ')
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
