import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkProject } from '../src/checks.mjs';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ios26-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, text) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };
  await put('ios/App/App/Info.plist', '<plist><dict><key>UIApplicationSceneManifest</key><dict/></dict></plist>');
  await put('ios/App/App/AppDelegate.swift', 'class SceneDelegate: UIResponder, UIWindowSceneDelegate {}');
  await put('ios/App/App/LocalPlugin.swift', '@objc(LocalPlugin)\npublic class LocalPlugin: CAPPlugin, CAPBridgedPlugin {}');
  await put('ios/App/App/capacitor.config.json', JSON.stringify({ packageClassList: ['LocalPlugin'] }));
  await put('www/index.html', '<html>current</html>');
  await put('ios/App/App/public/index.html', '<html>current</html>');
  execFileSync('git', ['init', '-q', root]);
  return { root, put };
}
const result = (results, check) => results.find(row => row.check === check);

test('good project passes every check and CLI emits JSON', async t => {
  const { root } = await fixture(t);
  const results = await checkProject(root);
  assert.equal(results.length, 4);
  assert.ok(results.every(row => row.status === 'PASS'));
  const run = spawnSync(process.execPath, [cli, root, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), results);
});

test('missing manifest fails and CLI exits 1', async t => {
  const { root, put } = await fixture(t);
  await put('ios/App/App/Info.plist', '<plist><dict/></plist>');
  assert.equal(result(await checkProject(root), 'uiscene').status, 'FAIL');
  const run = spawnSync(process.execPath, [cli, root], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /FAIL uiscene:.*UIScene life cycle is required/);
});

test('comment mentioning scene delegate does not satisfy conformance', async t => {
  const { root, put } = await fixture(t);
  await put('ios/App/App/AppDelegate.swift', '// class SceneDelegate: UIWindowSceneDelegate {}');
  assert.equal(result(await checkProject(root), 'uiscene').status, 'FAIL');
});

test('missing app-target plugin registration fails', async t => {
  const { root, put } = await fixture(t);
  await put('ios/App/App/capacitor.config.json', '{"packageClassList":[]}');
  const row = result(await checkProject(root), 'plugins');
  assert.equal(row.status, 'FAIL');
  assert.match(row.message, /LocalPlugin.*cap sync.*undefined/);
});

test('malformed native config fails cleanly', async t => {
  const { root, put } = await fixture(t);
  await put('ios/App/App/capacitor.config.json', '{');
  assert.equal(result(await checkProject(root), 'plugins').status, 'FAIL');
});

test('stale native bundle warns without failing CLI', async t => {
  const { root, put } = await fixture(t);
  await put('www/index.html', '<html>new</html>');
  assert.equal(result(await checkProject(root), 'bundle-parity').status, 'WARN');
  assert.equal(spawnSync(process.execPath, [cli, root]).status, 0);
});

for (const extension of ['json', 'ts', 'js', 'mjs', 'cjs']) {
  test(`webDir in ${extension} config selects the source bundle`, async t => {
    const { root, put } = await fixture(t);
    await put(`capacitor.config.${extension}`, extension === 'json' ? '{"webDir":"dist"}' : "export default { webDir: 'dist' };");
    await put('dist/index.html', 'changed');
    assert.equal(result(await checkProject(root), 'bundle-parity').status, 'WARN');
  });
}

test('absent web bundles are nonfatal', async t => {
  const { root } = await fixture(t);
  await rm(path.join(root, 'www/index.html'));
  assert.equal(result(await checkProject(root), 'bundle-parity').status, 'PASS');
});

test('ignored public directory with tracked files warns', async t => {
  const { root, put } = await fixture(t);
  execFileSync('git', ['-C', root, 'add', 'ios/App/App/public/index.html']);
  await put('.gitignore', 'ios/App/App/public/\n');
  const row = result(await checkProject(root), 'gitignore');
  assert.equal(row.status, 'WARN');
  assert.match(row.message, /git add -f/);
});

test('ignored public directory without tracked files passes', async t => {
  const { root, put } = await fixture(t);
  await put('.gitignore', 'ios/App/App/public/\n');
  assert.equal(result(await checkProject(root), 'gitignore').status, 'PASS');
});

test('missing project fails and invalid flags return JSON failure', async t => {
  const { root } = await fixture(t);
  assert.equal(result(await checkProject(path.join(root, 'absent')), 'uiscene').status, 'FAIL');
  const run = spawnSync(process.execPath, [cli, '--unknown', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout)[0].status, 'FAIL');
});
