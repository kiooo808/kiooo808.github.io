'use strict';
// Run after a clean build. Optional argument: original public directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..', 'public');
const pages = ['index.html', 'projects/index.html', 'projects/englishapp/index.html', 'knowledge/index.html', 'blog/index.html', 'diary/index.html', 'statistics/index.html'];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), relative) : [relative];
  });
}

let links = 0;
for (const file of pages) {
  const html = read(file);
  assert(html.includes('class="personal-site'), `${file}: missing rendered personal-site layout`);
  assert(html.indexOf('/js/time-color-scheme.js') >= 0 && html.indexOf('/js/time-color-scheme.js') < html.indexOf('/js/color-schema.js'), `${file}: time default must run before Fluid theme initialization`);
  for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const url = new URL(href, 'https://site.test/' + file);
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    assert(fs.existsSync(path.join(root, relative)), `${file}: broken internal link ${href}`);
    if (url.hash && relative.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1));
      assert(read(relative).includes(`id="${id}"`), `${file}: missing anchor ${href}`);
    }
    links++;
  }
}
const home = read('index.html');
assert((home.match(/class="space-post-row"/g) || []).length <= 4, 'homepage must show at most four recent records');
for (const file of pages) {
  for (const route of ['projects', 'knowledge', 'blog', 'diary']) assert(read(file).includes(`href="/${route}/"`), `${file}: missing navigation ${route}`);
}
const collectionHtml = files(root).filter(file => /^(?:blog|knowledge|diary)[\\/].*\.html$/.test(file)).map(read).join('\n');
const indexedUrls = [...read('local-search.xml').matchAll(/<url>([^<]+)<\/url>/g)].map(match => match[1]);
for (const url of indexedUrls) {
  assert(collectionHtml.includes(`href="${url}"`), `published record absent from content sections: ${url}`);
}
const statisticsTotal = read('statistics/index.html').match(/class="blog-stat-value">(\d+)<span>篇/);
assert(statisticsTotal, 'statistics must render the live published-post total');
assert.equal(Number(statisticsTotal[1]), indexedUrls.length, 'statistics must match the published search index');

const retainedUrls = require('./legacy-urls.json');
for (const relative of retainedUrls) assert(fs.existsSync(path.join(root, relative)), `lost original URL: ${relative}`);
let oldFiles = retainedUrls.length;
if (process.argv[2]) {
  const baseline = path.resolve(process.argv[2]);
  for (const relative of files(baseline)) {
    assert(fs.existsSync(path.join(root, relative)), `lost original URL: ${relative}`);
    if (relative.startsWith('apps' + path.sep) || !/\.(?:html|css|js|xml)$/i.test(relative)) {
      assert.equal(hash(path.join(root, relative)), hash(path.join(baseline, relative)), `original asset changed: ${relative}`);
    }
  }
}
console.log(`Site checks passed: ${pages.length} checked pages, ${links} local links/anchors, ${indexedUrls.length} records in content sections, ${oldFiles} original URLs retained.`);
