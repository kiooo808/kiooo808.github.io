/* Insert the clock default before Fluid's synchronous color initialization. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

hexo.extend.filter.register('after_render:html', function (html) {
  if (!hexo.theme.config.dark_mode.enable) return html;
  const file = path.join(hexo.source_dir, 'js/time-color-scheme.js');
  const version = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  const source = hexo.config.root + 'js/time-color-scheme.js?v=' + version;
  return html.replace(/(<script\b[^>]*\bsrc=(["'])[^"']*\/color-schema\.js[^"']*\2[^>]*><\/script>)/,
    '<script src="' + source + '"></script>\n$1');
});
