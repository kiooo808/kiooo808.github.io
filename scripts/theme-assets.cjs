const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// A changed palette or custom stylesheet must also invalidate browser/CDN caches.
let version;
hexo.extend.filter.register('before_generate', function () {
  version = createHash('sha256')
    .update(JSON.stringify(hexo.theme.config))
    .update(fs.readFileSync(path.join(hexo.source_dir, 'css', 'custom.css')))
    .digest('hex').slice(0, 12);
});

hexo.extend.filter.register('after_render:html', function (html) {
  return html.replace(
    /(<link\b[^>]*\bhref=["'])([^"']*\/css\/(?:main|custom)\.css)(["'])/g,
    (_, prefix, url, quote) => `${prefix}${url}?v=${version}${quote}`
  );
});
