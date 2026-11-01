// Check the site's own files and links, with no dependencies or network access.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const htmlFiles = [];
const ids = new Map();
const sources = new Map();

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'tools') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else if (entry.name.endsWith('.html')) htmlFiles.push(filename);
  }
}
await collect(root);
for (const filename of htmlFiles) {
  const source = await readFile(filename, 'utf8');
  sources.set(filename, source);
  const allIds = [...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  ids.set(filename, new Set(allIds));
  const label = path.relative(root, filename);
  if (allIds.length !== ids.get(filename).size) failures.push(`${label}: duplicate IDs`);
  if ((source.match(/<h1\b/gi) ?? []).length !== 1) failures.push(`${label}: needs exactly one h1`);
  if (!/<html\s+lang="en"/.test(source)) failures.push(`${label}: missing document language`);
  if (!/<meta name="viewport"/.test(source)) failures.push(`${label}: missing viewport`);
  if (!/<title>[^<]+<\/title>/.test(source)) failures.push(`${label}: missing title`);
  if (/<script\b/i.test(source)) failures.push(`${label}: the site should work without scripts`);
  if (/name=["']generator["']/i.test(source)) failures.push(`${label}: old generator metadata`);
}
let linkCount = 0;
for (const [filename, source] of sources) {
  const label = path.relative(root, filename);
  const basePath = `/${path.relative(root, filename).split(path.sep).join('/')}`;
  for (const tag of source.matchAll(/<(a|link|img|iframe|source|video|audio)\b([^>]*)>/gi)) {
    const attributes = Object.fromEntries([...tag[2].matchAll(/([\w-]+)=["']([^"']*)["']/g)]
      .map(match => [match[1].toLowerCase(), match[2]]));
    const address = attributes.href ?? attributes.src;
    if (!address) continue;
    const url = new URL(address, `https://bohao-str.github.io${basePath}`);
    const isRemote = /^(?:[a-z][\w+.-]*:|\/\/)/i.test(address);
    if (isRemote) {
      if (tag[1].toLowerCase() !== 'a' && attributes.rel !== 'canonical') {
        failures.push(`${label}: external runtime resource ${address}`);
      }
      continue;
    }
    linkCount++;
    let target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path.relative(root, target).startsWith('..')) {
      failures.push(`${label}: link leaves the site: ${address}`);
      continue;
    }
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      await stat(target);
      if (url.hash && ids.has(target) && !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))) {
        failures.push(`${label}: missing anchor ${address}`);
      }
    } catch {
      failures.push(`${label}: missing file ${address}`);
    }
  }
  const refresh = source.match(/http-equiv="refresh" content="0; url=([^" ]+)"/i);
  if (refresh) {
    const destination = path.resolve(root, `.${refresh[1]}`, 'index.html');
    try { await stat(destination); }
    catch { failures.push(`${label}: broken redirect to ${refresh[1]}`); }
  }
}
const css = await readFile(path.join(root, 'css/site.css'), 'utf8');
if (/@import|url\s*\(/i.test(css)) failures.push('CSS should not load additional resources');
await stat(path.join(root, '.nojekyll'));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${htmlFiles.length} HTML pages and ${linkCount} local links.`);
  console.log('No missing files, broken anchors, external runtime resources, or page scripts.');
}
