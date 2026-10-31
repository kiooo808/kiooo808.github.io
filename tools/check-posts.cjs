const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Use the same parser and text normalization as the installed Hexo version.
const hexoRequire = createRequire(require.resolve('hexo'));
const { parse, split } = hexoRequire('hexo-front-matter');
const { readFileSync } = hexoRequire('hexo-fs');

function validatePost(content) {
  const parts = split(content);
  if (/^(?:-{3,}|;{3,})\n/.test(content) && parts.data === undefined) {
    throw new Error('文章头部缺少结束分隔线（--- 或 ;;;）。');
  }
  parse(content);
}

function checkDirectory(directory) {
  let count = 0;
  let errors = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const result = checkDirectory(filename);
      count += result.count;
      errors += result.errors;
    } else if (entry.isFile() && path.extname(entry.name) === '.md') {
      count++;
      try {
        validatePost(readFileSync(filename));
      } catch (error) {
        errors++;
        console.error(`文章格式错误：${path.relative(process.cwd(), filename)}\n${error.message}\n`);
      }
    }
  }
  return { count, errors };
}

if (require.main === module) {
  const result = checkDirectory(path.join(__dirname, '..', 'source', '_posts'));
  if (result.errors) {
    console.error(`${result.errors} 篇文章格式错误，已停止构建。请检查文章开头 --- 之间的 YAML。`);
    process.exitCode = 1;
  } else {
    console.log(`文章格式检查通过，共 ${result.count} 篇。`);
  }
}

module.exports = { validatePost, checkDirectory };
