#!/usr/bin/env node
import { checkProject } from '../src/checks.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: capacitor-ios26-check [projectDir] [--json]');
} else {
  try {
    const directories = args.filter(arg => arg !== '--json');
    if (directories.length > 1 || directories.some(arg => arg.startsWith('-'))) {
      throw new Error('Usage: capacitor-ios26-check [projectDir] [--json]');
    }
    const results = await checkProject(directories[0]);
    console.log(json ? JSON.stringify(results, null, 2) : results.map(({ status, check, message }) => `${status} ${check}: ${message}`).join('\n'));
    process.exitCode = results.some(result => result.status === 'FAIL') ? 1 : 0;
  } catch (error) {
    const result = { check: 'project', status: 'FAIL', message: error.message };
    console.log(json ? JSON.stringify([result], null, 2) : `FAIL project: ${error.message}`);
    process.exitCode = 1;
  }
}
