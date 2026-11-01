const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Site-owned styles and navigation scripts must invalidate browser/CDN caches.
let version;
hexo.extend.filter.register('before_generate', function () {
  version = createHash('sha256')
    .update(JSON.stringify(hexo.theme.config))
    .update(fs.readFileSync(path.join(hexo.source_dir, 'css', 'custom.css')))
    .update(fs.readFileSync(path.join(hexo.source_dir, 'js', 'personal-navigation.js')))
    .digest('hex').slice(0, 12);
});

hexo.extend.filter.register('after_render:html', function (html) {
  // Fluid declares its default touch icon as 76px; this site supplies a 180px icon.
  return html.replace(
    /(<link\b(?=[^>]*\brel=["']apple-touch-icon["'])[^>]*\bsizes=["'])76x76(["'])/g,
    (_, prefix, quote) => `${prefix}180x180${quote}`
  ).replace(
    /(<link\b[^>]*\bhref=["'])([^"']*\/css\/(?:main|custom)\.css)(["'])/g,
    (_, prefix, url, quote) => `${prefix}${url}?v=${version}${quote}`
  ).replace(
    /(<script\b[^>]*\bsrc=["'])([^"']*\/js\/personal-navigation\.js)(["'])/g,
    (_, prefix, url, quote) => `${prefix}${url}?v=${version}${quote}`
  );
});
