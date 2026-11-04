'use strict';

const SECTIONS = ['blog', 'knowledge', 'diary'];
function sectionOf(post) {
  if (SECTIONS.includes(post.section)) return post.section;
  const categories = post.categories.toArray().map(category => category.name);
  if (categories.includes('日记')) return 'diary';
  if (categories.some(name => ['学校课程', '证书考试', '读书笔记'].includes(name))) return 'knowledge';
  return 'blog';
}

module.exports = { SECTIONS, sectionOf };
