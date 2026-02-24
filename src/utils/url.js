/**
 * Safe URL resolution - prevents malformed URLs (e.g. domain in path)
 */

const { URL } = require('url');

/**
 * Safely resolve a URL against a base. Fixes common issues:
 * - www.domain.com/path (no protocol) -> https://www.domain.com/path
 * - //domain.com/path (protocol-relative) -> https://domain.com/path
 * - Prevents domain being treated as relative path
 */
function resolveUrl(href, baseUrl) {
  if (!href || typeof href !== 'string') return null;
  href = href.trim();
  if (!href) return null;

  try {
    if (href.startsWith('//')) {
      href = 'https:' + href;
    } else if (href.startsWith('www.') || /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(href.split('/')[0])) {
      href = 'https://' + href.replace(/^\/+/, '');
    } else if (!href.startsWith('/') && !href.startsWith('http') && !href.startsWith('#')) {
      const base = new URL(baseUrl);
      if (!base.pathname.endsWith('/')) {
        base.pathname = base.pathname.replace(/\/[^/]*$/, '/') || '/';
      }
      baseUrl = base.href;
    }

    const resolved = new URL(href, baseUrl);
    if (!resolved.protocol || !resolved.hostname) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Validate URL - must be same origin, no malformed paths (hostname in path)
 */
function isValidInternalUrl(url, baseOrigin) {
  try {
    const u = new URL(url);
    const base = new URL(baseOrigin);
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return false;
    if (u.pathname.includes(u.hostname)) return false;
    if (u.pathname.includes(base.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if URL is safe to fetch (not malformed)
 */
function isFetchableUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname.includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  resolveUrl,
  isValidInternalUrl,
  isFetchableUrl
};
