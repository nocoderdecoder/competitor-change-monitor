import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {comparePage, decodeEntities, digest, extractLines, lineDiff, pageKey, validatePage} from '../src/core.mjs';
import {isPublicAddress} from '../src/fetch-page.mjs';

const page = {name: 'Plans', url: 'https://example.com/pricing', include: [], ignore: ['copyright']};
const before = await readFile(new URL('../examples/before.html', import.meta.url), 'utf8');
const after = await readFile(new URL('../examples/after.html', import.meta.url), 'utf8');
const workflow = JSON.parse(await readFile(new URL('../n8n/competitor-page-changes.json', import.meta.url), 'utf8'));

function codeNode(name, context) {
  const node = workflow.nodes.find(node => node.name === name);
  return vm.runInNewContext('(function(){' + node.parameters.jsCode + '\n})()', {...context});
}

test('first successful fetch creates a baseline', () => {
  const state = {};
  const result = comparePage(state, page, before, 't1');
  assert.equal(result.status, 'baseline');
  assert.deepEqual(result.added, []);
  assert.equal(Object.keys(state).length, 1);
});
test('pricing changes preserve source and timestamps', () => {
  const state = {};
  comparePage(state, page, before, 't1');
  const result = comparePage(state, page, after, 't2');
  assert.equal(result.status, 'changed');
  assert.equal(result.previousCheckedAt, 't1');
  assert.deepEqual(result.added, ['Team: $59 per month', 'Team includes 8 seats', 'Annual billing saves 15%']);
  assert.deepEqual(result.removed, ['Team: $49 per month', 'Team includes 5 seats']);
});
test('unchanged page has no differences', () => {
  const state = {}; comparePage(state, page, before, 't1');
  assert.equal(comparePage(state, page, before, 't2').status, 'unchanged');
});
test('formatting, script changes and line order are ignored', () => {
  const p = validatePage(page);
  assert.deepEqual(extractLines('<p>A   B</p><script>x()</script><p>C</p>', p), ['A B', 'C']);
  assert.deepEqual(lineDiff(['A B', 'C'], ['C', 'A B']), {added: [], removed: []});
});
test('duplicate lines retain multiplicity', () => {
  assert.deepEqual(lineDiff(['Seats: 5', 'Seats: 5'], ['Seats: 5']), {added: [], removed: ['Seats: 5']});
});
test('literal filters are case insensitive', () => {
  const p = validatePage({...page, include: ['TEAM'], ignore: ['seats']});
  assert.deepEqual(extractLines(after, p), ['Team: $59 per month']);
});
test('filter changes create a separate baseline', () => {
  const state = {}; comparePage(state, page, before, 't1');
  assert.equal(comparePage(state, {...page, include: ['Team']}, after, 't2').status, 'baseline');
});
test('filter order does not reset baseline', () => {
  assert.equal(pageKey({...page, include: ['a','b']}), pageKey({...page, include: ['b','a']}));
});
test('empty or oversized extraction retains previous state', () => {
  const state = {}; comparePage(state, page, before, 't1');
  const saved = JSON.stringify(state);
  assert.throws(() => comparePage(state, page, '<script>nothing()</script>', 't2'));
  assert.throws(() => comparePage(state, page, 'x'.repeat(2_000_001), 't2'));
  assert.equal(JSON.stringify(state), saved);
});
test('entities cannot crash parsing or introduce tags', () => {
  assert.equal(decodeEntities('A &amp; B &#36;19 &#x20AC;9 &#99999999;'), 'A & B $19 €9 &#99999999;');
  assert.deepEqual(extractLines('<p>&lt;note&gt; &pound;5</p>', validatePage(page)), ['<note> £5']);
});
test('URL validation rejects local hosts, credentials and non-HTTPS schemes', () => {
  for (const url of ['http://example.com','file:///tmp/x','https://127.0.0.1','https://localhost','https://x.internal','https://user:pass@example.com','https://example.com:8080','https://[::1]']) assert.throws(() => validatePage({url}), url);
  assert.equal(validatePage({url:'https://example.com/#top'}).url, 'https://example.com/');
});
test('resolved private and special IP addresses are blocked', () => {
  for (const ip of ['10.1.2.3','127.0.0.1','169.254.169.254','172.16.1.1','192.168.0.1','100.64.1.1','198.18.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('digest escapes markup in page text', () => {
  const text = digest([{name:'Plans',url:page.url,status:'changed',checkedAt:'t',added:['<script> [link](x)'],removed:[]}]);
  assert.ok(text.includes('\\<script\\> \\[link\\](x)'));
});
test('generated workflow has valid node connections and is inactive', () => {
  assert.equal(workflow.active, false);
  const names = new Set(workflow.nodes.map(n => n.name));
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source));
    for (const branch of outputs.main) for (const edge of branch) assert.ok(names.has(edge.node));
  }
  const http = workflow.nodes.find(n => n.name === 'Fetch page');
  assert.equal(http.parameters.options.redirect.redirect.followRedirects, false);
  assert.equal(http.parameters.options.response.response.fullResponse, true);
  assert.equal(http.onError, 'continueRegularOutput');
});
test('n8n Pages node emits valid items', () => {
  const output = codeNode('Pages', {});
  assert.equal(output[0].json.url, 'https://example.com/');
});
test('n8n comparison and digest execute against fixture responses', () => {
  const store = {};
  const context = {$: name => {assert.equal(name,'Pages'); return {item:{json:page}};}, $getWorkflowStaticData: scope => {assert.equal(scope,'global'); return store;}};
  const baseline = codeNode('Compare snapshots', {...context, $json: {statusCode:200,headers:{'content-type':'text/html'},body:before}});
  assert.equal(baseline.json.status, 'baseline');
  const change = codeNode('Compare snapshots', {...context, $json: {statusCode:200,headers:{'content-type':'text/html'},body:after}});
  assert.equal(change.json.status, 'changed');
  const output = codeNode('Build digest', {$input:{all:()=>[change]}});
  assert.equal(output[0].json.changed, 1);
  assert.ok(output[0].json.markdown.includes('$59'));
});
test('n8n errors do not overwrite the last good snapshot', () => {
  const store = {};
  const context = {$:()=>({item:{json:page}}), $getWorkflowStaticData:()=>store};
  codeNode('Compare snapshots', {...context,$json:{statusCode:200,headers:{'content-type':'text/html'},body:before}});
  const saved = JSON.stringify(store);
  for (const response of [{statusCode:403,body:'Denied'}, {error:'Timeout'}, {statusCode:200,headers:{'content-type':'application/json'},body:'{}'}, {statusCode:200,headers:{'content-type':'text/html'},body:''}]) {
    const output = codeNode('Compare snapshots', {...context,$json:response});
    assert.equal(output.json.status,'error');
    assert.equal(JSON.stringify(store),saved);
  }
});
