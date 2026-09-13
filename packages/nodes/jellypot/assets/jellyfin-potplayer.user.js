// ==UserScript==
// @name         Jellyfin with Potplayer
// @version      0.6
// @description  Play video with PotPlayer (fixed for Jellyfin 10.10+ / 10.11)
// @author       Tccoin Damocles
// @match        http://localhost:8096/*
// @match        http://127.0.0.1:8096/*
// @match        http://*:8096/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // API 访问层。
  // 10.10+ 的 Web 端不再暴露 window.ApiClient 全局变量，改为从
  // localStorage 读取 apiclient 保存的凭据（jellyfin_credentials），
  // 用 X-Emby-Token 直接 fetch。若存在旧版全局 ApiClient 则优先使用。
  // ------------------------------------------------------------------
  function readCredentials() {
    try {
      const parsed = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      const servers = Array.isArray(parsed.Servers) ? parsed.Servers : [];
      return servers.find(s => s && s.AccessToken) || null;
    } catch (err) {
      return null;
    }
  }

  function currentUserId() {
    const api = window.ApiClient;
    if (api && typeof api.getCurrentUserId === 'function') {
      const id = api.getCurrentUserId();
      if (id) return id;
    }
    const cred = readCredentials();
    return cred ? cred.UserId : null;
  }

  async function apiGetJson(path, params) {
    const api = window.ApiClient;
    if (api && typeof api.getJSON === 'function') {
      return api.getJSON(api.getUrl(path, params));
    }

    const cred = readCredentials();
    if (!cred) {
      throw new Error('Not logged in: no jellyfin_credentials in localStorage');
    }
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const base = (location.origin || '').replace(/\/+$/, '');
    const res = await fetch(base + '/' + path.replace(/^\/+/, '') + qs, {
      headers: { 'X-Emby-Token': cred.AccessToken }
    });
    if (!res.ok) {
      throw new Error('API request failed: ' + res.status + ' ' + path);
    }
    return res.json();
  }

  // ------------------------------------------------------------------
  // 从当前 URL hash 中取 item id（详情页：#/details?id=xxx&serverId=yyy）
  // ------------------------------------------------------------------
  function itemIdFromHash() {
    const m = /[?&]id=([^&]+)/.exec(window.location.hash || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ------------------------------------------------------------------
  // 解析出服务器本地文件路径。
  // 10.10+ 的 DTO 只在客户端显式请求 Fields=Path 时才返回 Path。
  // ------------------------------------------------------------------
  async function resolveItemPath(itemId) {
    const userId = currentUserId();
    if (!userId) throw new Error('Not logged in: no jellyfin_credentials in localStorage');

    const item = await apiGetJson('Users/' + userId + '/Items/' + itemId, { Fields: 'Path' });
    if (item && item.Path) return item.Path;

    // 文件夹 / 合集：递归取第一个带真实路径的子项
    const list = await apiGetJson('Users/' + userId + '/Items', {
      ParentId: itemId,
      Recursive: true,
      Limit: 50,
      Fields: 'Path'
    });
    const child = ((list && list.Items) || []).find(i => i && i.Path);
    if (child) return child.Path;

    throw new Error('No local path found for item ' + itemId);
  }

  // ------------------------------------------------------------------
  // 通过已注册的 potplayer:// 协议唤起 PotPlayer。
  // 保留 / 与盘符冒号，其余（#、?、%、空格、CJK 等）做百分号编码，
  // 避免文件名特殊字符在 potplayer:// URL 中被浏览器吞掉。
  // 用新标签页承载外部协议导航：location.href 会把当前 Jellyfin 页
  // 导航走（返回后可能丢图片），_blank 则完全不触碰当前页面。
  // ------------------------------------------------------------------
  function launchPotPlayer(path) {
    const encoded = encodeURIComponent(path.replace(/\\/g, '/'))
      .replace(/%2F/gi, '/')
      .replace(/%3A/gi, ':');
    const uri = 'potplayer://' + encoded;
    console.log('[PotPlayer] opening:', path, '=>', uri);
    const win = window.open(uri, '_blank');
    if (!win) {
      // 弹窗被拦截时的兜底：退化为当前页导航（极少发生）
      window.location.href = uri;
    }
  }

  function playWithPotPlayer(itemId) {
    resolveItemPath(itemId)
      .then(launchPotPlayer)
      .catch(err => console.error('[PotPlayer] failed:', err));
  }

  // ------------------------------------------------------------------
  // 按钮绑定：用捕获阶段 + stopImmediatePropagation 抢占点击，
  // 让 Jellyfin 自己的播放逻辑不再执行（无需克隆/替换 DOM）。
  // ------------------------------------------------------------------
  const bound = new WeakSet();

  function bindButton(button, idProvider) {
    if (!button || bound.has(button)) return;
    bound.add(button);
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const itemId = idProvider(button) || itemIdFromHash();
      if (itemId) playWithPotPlayer(itemId);
    }, true);
  }

  // 向上查找 data-id（列表卡片上 id 在卡片元素，按钮上没有）
  function idFromAncestor(button) {
    let el = button;
    while (el && el !== document.documentElement) {
      if (el.hasAttribute && el.hasAttribute('data-id')) {
        return el.getAttribute('data-id');
      }
      el = el.parentNode;
    }
    return null;
  }

  // 详情页：data-action="resume"/"play" 按钮 + play_arrow 图标
  function bindDetailPage() {
    const itemId = itemIdFromHash();
    if (!itemId) return;

    const page = document.getElementById('itemDetailPage') || document;
    page.querySelectorAll('button[data-action="resume"], button[data-action="play"]')
      .forEach(btn => bindButton(btn, () => itemId));

    page.querySelectorAll('.detailButton-icon.play_arrow')
      .forEach(icon => {
        const btn = icon.closest('button');
        if (btn) bindButton(btn, () => itemId);
      });
  }

  // 列表页：卡片悬浮播放按钮（data-id 在卡片上）+ 旧版 data-mode 兼容
  function bindListButtons() {
    document.querySelectorAll(
      'button[data-action="play"][data-id],' +
      'button[data-action="resume"][data-id],' +
      '[data-mode="play"][data-id]'
    ).forEach(btn => bindButton(btn, idFromAncestor));

    document.querySelectorAll('.card button[data-action="play"], .card button[data-action="resume"]')
      .forEach(btn => bindButton(btn, idFromAncestor));
  }

  function bindAll() {
    bindDetailPage();
    bindListButtons();
    rescueLazyImages();
  }

  // ------------------------------------------------------------------
  // 图片救援：Jellyfin 在播放开始/页面返回等场景会重渲染卡片，
  // 新卡片是 .lazy[data-src] 占位（blurhash），若 IntersectionObserver
  // 没有重新观察，图片就停在占位状态（表现为“图片消失”）。
  // 与 Jellyfin 自身的 lazyImage 加载方式对齐，把视口内的占位直接填充，
  // 并移除 data-src 标记为已加载，避免重复处理。
  // ------------------------------------------------------------------
  function rescueLazyImages() {
    const items = document.querySelectorAll('.lazy[data-src]');
    if (!items.length) return;

    const margin = Math.round(window.innerHeight * 0.5);
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -margin || rect.top > window.innerHeight + margin) continue;

      const src = el.getAttribute('data-src');
      if (!src) continue;

      if (el.tagName === 'IMG') {
        el.setAttribute('src', src);
      } else {
        el.style.setProperty('background-image', `url("${src}")`);
      }
      // 与 Jellyfin fillImage 一致：移除 data-src 与 lazy 标记为已加载
      el.removeAttribute('data-src');
      el.classList.remove('lazy');
      el.classList.add('lazy-image-fadein');
    }
  }

  // 回到本标签页时立即救援一次（播放/切走再返回是最常见的触发场景）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) rescueLazyImages();
  });

  // ------------------------------------------------------------------
  // 触发时机：viewshow（10.10+ 会在 window 上触发，已验证）、
  // hashchange，以及一个轻量轮询兜底（详情页刷新/继续观看渲染较晚）。
  // ------------------------------------------------------------------
  window.addEventListener('viewshow', bindAll);
  window.addEventListener('hashchange', bindAll);
  setInterval(bindAll, 2000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }
})();
