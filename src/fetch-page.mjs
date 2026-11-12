import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {validatePage} from './core.mjs';

export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (net.isIP(address) === 6) {
    const first = parseInt(address.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith('2001:db8:') && !address.toLowerCase().startsWith('2001:0:') && !address.toLowerCase().startsWith('2002:');
  }
  return false;
}

export async function fetchPage(rawUrl, redirects = 0) {
  const url = validatePage({url: rawUrl}).url;
  const target = new URL(url);
  const addresses = await dns.lookup(target.hostname, {all: true});
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error('Hostname resolves to a non-public address');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(target, {
      headers: {'User-Agent': 'competitor-change-monitor/0.1 (+https://github.com/nocoderdecoder/competitor-change-monitor)', 'Accept': 'text/html,text/plain', 'Accept-Encoding': 'identity'},
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) return reject(new Error('Redirect limit or missing location'));
        let next;
        try { next = new URL(response.headers.location, target).href; } catch (error) { return reject(error); }
        return fetchPage(next, redirects + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error('HTTP ' + response.statusCode)); }
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(response.headers['content-type'] || '')) { response.resume(); return reject(new Error('Response is not HTML or plain text')); }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) request.destroy(new Error('Response exceeds 2 MB')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Response aborted')));
    });
    const timer = setTimeout(() => request.destroy(new Error('Request exceeded 20 seconds')), 20000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
