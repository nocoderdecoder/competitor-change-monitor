import {readFile, writeFile} from 'node:fs/promises';
const core = (await readFile(new URL('../src/core.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
const pages = core + `
const pages = [
  {name: 'Example page', url: 'https://example.com/', include: [], ignore: []},
];
if (!pages.length || pages.length > 10) throw new Error('Configure between 1 and 10 public pages');
const validated = pages.map(validatePage);
if (new Set(validated.map(p => p.url)).size !== validated.length) throw new Error('Configure each URL once');
return validated.map(page => ({json: page}));
`;
const compare = core + `
const page = $('Pages').item.json;
const response = $json;
const checkedAt = new Date().toISOString();
const store = $getWorkflowStaticData('global');
store.snapshots = store.snapshots || {};
try {
  if (response.error) throw new Error(typeof response.error === 'string' ? response.error : response.error.message || 'Request failed');
  if (response.statusCode !== 200) throw new Error('HTTP ' + response.statusCode + '; use the final URL for redirects');
  const type = response.headers?.['content-type'] || '';
  if (!/^(text\\/html|text\\/plain|application\\/xhtml\\+xml)\\b/i.test(type)) throw new Error('Response is not HTML or plain text');
  const body = response.body ?? response.data;
  const lines = extractLines(body, page);
  if (lines.join('\\n').length > 20000) throw new Error('Selected text exceeds 20 KB; narrow the include filters');
  return {json: comparePage(store.snapshots, page, body, checkedAt)};
} catch (error) {
  return {json: {name: page.name, url: page.url, status: 'error', checkedAt, error: error.message}};
}
`;
const render = core + `
const results = $input.all().map(item => item.json);
return [{json: {markdown: digest(results), changed: results.filter(r => r.status === 'changed').length, errors: results.filter(r => r.status === 'error').length, results}}];
`;
const workflow = {
  name: 'Competitor page changes', active: false,
  nodes: [
    {parameters: {content: '## Setup\nEdit Pages with approved public URLs. Manual runs preview the output. Publish the workflow to retain snapshots between scheduled runs. The first successful run establishes a baseline. The final node returns Markdown; connect a destination if needed. See README for limits.', height: 220, width: 540}, id: 'setup', name: 'Setup', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [120,-280]},
    {parameters: {}, id: 'manual', name: 'Manual run', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0,0]},
    {parameters: {rule: {interval: [{field: 'cronExpression', expression: '0 9 * * 1'}]}}, id: 'weekly', name: 'Weekly', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0,180]},
    {parameters: {mode: 'runOnceForAllItems', jsCode: pages}, id: 'pages', name: 'Pages', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240,0]},
    {parameters: {method: 'GET', url: '={{ $json.url }}', sendHeaders: true, headerParameters: {parameters: [{name: 'User-Agent', value: 'competitor-change-monitor/0.1'},{name: 'Accept', value: 'text/html,text/plain'}]}, options: {timeout: 20000, redirect: {redirect: {followRedirects: false}}, batching: {batch: {batchSize: 1, batchInterval: 1000}}, response: {response: {responseFormat: 'text', outputPropertyName: 'body', fullResponse: true, neverError: true}}}}, onError: 'continueRegularOutput', id: 'fetch', name: 'Fetch page', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [480,0]},
    {parameters: {mode: 'runOnceForEachItem', jsCode: compare}, id: 'compare', name: 'Compare snapshots', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720,0]},
    {parameters: {mode: 'runOnceForAllItems', jsCode: render}, id: 'digest', name: 'Build digest', type: 'n8n-nodes-base.code', typeVersion: 2, position: [960,0]},
  ],
  connections: {'Manual run': {main: [[{node: 'Pages', type: 'main', index: 0}]]}, Weekly: {main: [[{node: 'Pages', type: 'main', index: 0}]]}, Pages: {main: [[{node: 'Fetch page', type: 'main', index: 0}]]}, 'Fetch page': {main: [[{node: 'Compare snapshots', type: 'main', index: 0}]]}, 'Compare snapshots': {main: [[{node: 'Build digest', type: 'main', index: 0}]]}},
  settings: {executionOrder: 'v1', timezone: 'UTC'}, pinData: {}, tags: [],
};
await writeFile(new URL('./competitor-page-changes.json', import.meta.url), JSON.stringify(workflow, null, 2) + '\n');
console.log('Built n8n/competitor-page-changes.json');
