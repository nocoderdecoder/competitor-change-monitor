#!/usr/bin/env node
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {comparePage, digest, validatePage} from './core.mjs';
import {fetchPage} from './fetch-page.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.includes('--help')) {
    console.log('Usage: node src/cli.mjs config.json [--state snapshots.json] [--out digest.md]');
    return;
  }
  const configPath = args.shift();
  let statePath = '.monitor/snapshots.json', outPath = '.monitor/digest.md';
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!value || !['--state', '--out'].includes(flag)) throw new Error('Unknown option or missing value');
    if (flag === '--state') statePath = value; else outPath = value;
  }
  const resolved = [configPath, statePath, outPath].map(p => path.resolve(p));
  if (new Set(resolved).size !== 3) throw new Error('Config, state, and output paths must differ');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!Array.isArray(config.pages) || !config.pages.length || config.pages.length > 25) throw new Error('Configure between 1 and 25 pages');
  const pages = config.pages.map(validatePage);
  if (new Set(pages.map(p => p.url)).size !== pages.length) throw new Error('Configure each URL once');
  let state = {};
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid state file');
  for (const entry of Object.values(state)) {
    if (!entry || !Array.isArray(entry.lines) || entry.lines.some(line => typeof line !== 'string')) throw new Error('Invalid snapshot entry');
  }
  const results = [];
  for (const page of pages) {
    const checkedAt = new Date().toISOString();
    try { results.push(comparePage(state, page, await fetchPage(page.url), checkedAt)); }
    catch (error) { results.push({...page, status: 'error', error: error.message, checkedAt}); }
  }
  await mkdir(path.dirname(statePath), {recursive: true});
  await mkdir(path.dirname(outPath), {recursive: true});
  const temporary = statePath + '.tmp-' + process.pid;
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
  await rename(temporary, statePath);
  await writeFile(outPath, digest(results));
  console.log(results.map(r => r.name + ': ' + r.status).join('\n'));
  console.log('Digest: ' + outPath);
  if (results.some(r => r.status === 'error')) process.exitCode = 1;
}
main().catch(error => { console.error('Error: ' + error.message); process.exitCode = 2; });
