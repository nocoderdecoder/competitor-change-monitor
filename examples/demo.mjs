import {readFile} from 'node:fs/promises';
import {comparePage, digest} from '../src/core.mjs';
const page = {name: 'Harbor pricing (synthetic example)', url: 'https://example.com/pricing', ignore: ['copyright'], include: []};
const state = {};
comparePage(state, page, await readFile(new URL('./before.html', import.meta.url), 'utf8'), '2026-10-01T09:00:00Z');
const result = comparePage(state, page, await readFile(new URL('./after.html', import.meta.url), 'utf8'), '2026-10-08T09:00:00Z');
console.log(digest([result]));
