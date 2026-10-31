/* global hexo */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
// Resolve through the existing generator's dependency, including nested installs.
const pagination = createRequire(require.resolve('hexo-generator-index'))('hexo-pagination');
const { sectionOf } = require('../lib/content.cjs');

hexo.extend.helper.register('content_section', sectionOf);
hexo.extend.helper.register('section_label', post => ({ blog: '博客', knowledge: '知识库', diary: '日记' })[sectionOf(post)]);

// Register after Fluid loads so npm upgrades never overwrite our templates/generator.
hexo.extend.filter.register('before_generate', function () {
  const directory = path.join(hexo.base_dir, 'views');
  for (const name of fs.readdirSync(directory)) {
    hexo.theme.setView(name, fs.readFileSync(path.join(directory, name), 'utf8'));
  }
  hexo.extend.generator.register('index', function (locals) {
    const personal = locals.data.personal;
    const posts = locals.posts.sort('-date');
    const all = posts.toArray();
    const grouped = Object.fromEntries(['blog', 'knowledge', 'diary'].map(section => [section, posts.filter(post => sectionOf(post) === section)]));
    const common = { personal, grouped, personal_site: true, banner_img_height: 32 };
    const page = (route, title, layout, extra = {}) => ({
      path: route + 'index.html', layout, data: { ...common, title, ...extra }
    });
    const routes = [page('', '个人空间', 'personal-home', {
      recent: all.filter(post => !post.archive && post.home !== false && !(personal.home_exclude || []).includes(post.source.replace(/^_posts\//, ''))).slice(0, 4)
    }), page('projects/', '项目', 'personal-projects'), page('knowledge/', '知识库', 'personal-knowledge')];
    for (const [section, title] of [['blog', '博客'], ['diary', '日记']]) {
      const pages = pagination(section + '/', grouped[section], {
        perPage: 10, layout: 'personal-list', format: 'page/%d/',
        data: { ...common, title, section }
      });
      routes.push(...(pages.length ? pages : [page(section + '/', title, 'personal-list', {
        section, posts: grouped[section], total: 1
      })]));
    }
    for (const project of personal.projects) {
      routes.push(page('projects/' + project.slug + '/', project.title, 'personal-project', {
        project, logs: all.filter(post => post.categories.toArray().some(category => category.name === project.category))
      }));
    }
    // Retain legacy /page/2/ etc. with their original list and page size.
    const legacyPosts = locals.index_posts.sort(hexo.config.index_generator.order_by);
    legacyPosts.data.sort((a, b) => (b.sticky || 0) - (a.sticky || 0));
    routes.push(...pagination('', legacyPosts, {
      perPage: hexo.config.index_generator.per_page, layout: 'index', format: 'page/%d/',
      data: { __index: true }
    }).slice(1));
    return routes;
  });
});
