/* Homepage navigation progressively enhances real, independently usable URLs. */
(() => {
  'use strict';
  const navigation = document.getElementById('home-navigation');
  const view = document.getElementById('space-content');
  if (!navigation || !view) return;
  const labels = { home: '首页', projects: '项目', knowledge: '知识库', blog: '博客', diary: '日记', about: '关于', search: '搜索' };
  const controls = [...navigation.querySelectorAll('[data-section]')];
  const home = view.firstElementChild.cloneNode(true);
  const status = document.querySelector('.space-navigation-status');
  const cache = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let generation = 0;
  let currentRoute = '';
  let searchIndex;

  function routeOf(url) {
    if (url.origin !== location.origin) return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return { key: 'home', route: '', anchor: '' };
    const key = path.split('/')[0];
    if (!labels[key] || ['home', 'search'].includes(key)) return null;
    return { key, route: path, anchor: url.hash.slice(1) };
  }

  function fromHash() {
    const hash = location.hash.slice(1);
    if (hash === 'search') return { key: 'search', route: 'search' };
    return routeOf(new URL('/' + hash, location.origin)) || { key: 'home', route: '' };
  }

  function select(key) {
    for (const control of controls) {
      const selected = control.dataset.section === key;
      control.classList.toggle('is-current', selected);
      if (selected) control.setAttribute('aria-current', 'page');
      else control.removeAttribute('aria-current');
    }
  }

  async function load(route) {
    if (!cache.has(route)) {
      const promise = (async () => {
        const response = await fetch('/' + route + '/', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Page unavailable');
        const document = new DOMParser().parseFromString(await response.text(), 'text/html');
        const source = document.querySelector('.personal-site.site-hub') || (route === 'about' && document.querySelector('#board .page-content, #board .markdown-body, #board .about-content'));
        if (!source) throw new Error('Page content unavailable');
        const content = source.cloneNode(true);
        content.querySelectorAll('script, h1.sr-only').forEach(element => element.remove());
        content.querySelectorAll('img[data-src]').forEach(image => {
          image.src = image.dataset.src;
          image.removeAttribute('data-src');
        });
        const title = document.querySelector('.personal-site.site-hub h1')?.textContent || labels[route];
        const heading = window.document.createElement('div');
        heading.className = 'space-panel-heading';
        const h2 = window.document.createElement('h2');
        h2.textContent = title;
        heading.append(h2);
        content.prepend(heading);
        return content;
      })();
      cache.set(route, promise);
      promise.catch(() => cache.delete(route));
    }
    return (await cache.get(route)).cloneNode(true);
  }

  async function show(selection, { remember = true, animate = true } = {}) {
    const { key, route, anchor } = selection;
    const request = ++generation;
    status.classList.add('sr-only');
    controls.forEach(control => control.classList.remove('is-pending'));
    if (currentRoute === route && !anchor && view.dataset.ready) {
      view.getAnimations().forEach(animation => animation.cancel());
      view.firstElementChild.getAnimations().forEach(animation => animation.cancel());
      view.removeAttribute('aria-busy');
      status.textContent = '';
      return;
    }
    view.setAttribute('aria-busy', 'true');
    status.textContent = '正在加载' + labels[key];
    const control = controls.find(item => item.dataset.section === key);
    control?.classList.add('is-pending');
    try {
      let incoming;
      if (key === 'home') incoming = home.cloneNode(true);
      else if (key === 'search') incoming = document.getElementById('space-search-template').content.firstElementChild.cloneNode(true);
      else incoming = await load(route);
      if (request !== generation) return;

      view.getAnimations().forEach(animation => animation.cancel());
      view.firstElementChild.getAnimations().forEach(animation => animation.cancel());
      const oldHeight = view.getBoundingClientRect().height;
      const shouldAnimate = animate && !reducedMotion.matches;
      if (shouldAnimate) {
        await view.firstElementChild.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-5px)' }], { duration: 110, easing: 'ease-out' }).finished.catch(() => {});
        if (request !== generation) return;
      }

      const inner = key === 'home' ? incoming : document.createElement('div');
      inner.className = 'space-view-inner';
      inner.dataset.section = key;
      if (key !== 'home') inner.append(incoming);
      view.replaceChildren(inner);
      currentRoute = route;
      view.dataset.ready = 'true';
      select(key);
      if (remember) history.pushState(null, '', location.pathname + location.search + (route ? '#' + route : ''));
      document.title = key === 'home' ? '个人空间 - kiooo808' : labels[key] + ' - kiooo808';
      if (shouldAnimate) {
        const newHeight = inner.getBoundingClientRect().height;
        view.animate([{ height: oldHeight + 'px', overflow: 'clip' }, { height: newHeight + 'px', overflow: 'clip' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
        inner.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
      }
      if (key === 'search') setupSearch(inner);
      if (anchor) {
        const target = [...inner.querySelectorAll('[id]')].find(element => element.id === anchor);
        target?.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
      }
      status.textContent = '已切换至' + labels[key];
    } catch (_) {
      if (request !== generation) return;
      status.classList.remove('sr-only');
      status.replaceChildren(document.createTextNode('暂时无法加载，'));
      const link = document.createElement('a');
      link.href = '/' + route + '/';
      link.textContent = '打开完整页面';
      status.append(link);
    } finally {
      if (request === generation) {
        controls.forEach(control => control.classList.remove('is-pending'));
        view.removeAttribute('aria-busy');
      }
    }
  }

  async function getSearchIndex() {
    if (!searchIndex) {
      searchIndex = fetch(view.dataset.searchIndex).then(async response => {
        if (!response.ok) throw new Error('Search unavailable');
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
        return [...xml.querySelectorAll('entry')].map(entry => {
          const title = entry.querySelector('title')?.textContent || '';
          const body = new DOMParser().parseFromString(entry.querySelector('content')?.textContent || '', 'text/html').body.textContent || '';
          return { title, body, url: entry.querySelector('url')?.textContent || '/' };
        });
      });
      searchIndex.catch(() => { searchIndex = undefined; });
    }
    return searchIndex;
  }

  function setupSearch(inner) {
    const input = inner.querySelector('input');
    const results = inner.querySelector('.space-search-results');
    const message = inner.querySelector('.space-search-status');
    let version = 0;
    input.addEventListener('input', async () => {
      const request = ++version;
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      results.replaceChildren();
      if (!words.length) { message.textContent = '输入关键词，查找站内内容。'; return; }
      message.textContent = '正在查找…';
      try {
        const index = await getSearchIndex();
        if (request !== version || !inner.isConnected) return;
        const matches = index.filter(item => words.every(word => (item.title + '\n' + item.body).toLowerCase().includes(word)));
        message.textContent = matches.length ? '找到 ' + matches.length + ' 条记录' : '没有找到相关内容，试试其他关键词。';
        for (const item of matches) {
          const article = document.createElement('article');
          article.className = 'space-search-result';
          const link = document.createElement('a');
          link.href = item.url;
          link.textContent = item.title;
          const excerpt = document.createElement('p');
          excerpt.textContent = item.body.replace(/\s+/g, ' ').trim().slice(0, 130);
          article.append(link, excerpt);
          results.append(article);
        }
      } catch (_) {
        if (request === version && inner.isConnected) message.textContent = '搜索暂时不可用，请稍后再试。';
      }
    });
  }

  navigation.addEventListener('click', event => {
    const control = event.target.closest('[data-section]');
    if (!control || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const key = control.dataset.section;
    show({ key, route: key === 'home' ? '' : key });
  });
  view.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (href.startsWith('#')) {
      const target = [...view.querySelectorAll('[id]')].find(element => element.id === href.slice(1));
      if (target) { event.preventDefault(); target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' }); }
      return;
    }
    const selection = routeOf(new URL(link.href));
    if (selection) { event.preventDefault(); show(selection); }
  });
  window.addEventListener('popstate', () => show(fromHash(), { remember: false }));
  const initial = fromHash();
  if (initial.key !== 'home') show(initial, { remember: false, animate: false });
  else view.dataset.ready = 'true';
})();
