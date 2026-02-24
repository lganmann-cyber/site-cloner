/**
 * URL path rewriting - replace remote URLs with local paths
 */

const cheerio = require('cheerio');
const path = require('path');
const { resolveUrl } = require('./utils/url');

/**
 * Rewrite internal navigation links (a href) to local HTML files
 */
function rewriteHtmlLinks(html, urlToLocalPath, baseOrigin) {
  if (!urlToLocalPath || urlToLocalPath.size === 0) return html;

  const $ = cheerio.load(html, { decodeEntities: false });

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    try {
      const resolved = new URL(href, baseOrigin + '/').href;
      const targetOrigin = new URL(resolved).origin;
      if (targetOrigin !== baseOrigin) return; // external link, keep as-is

      const normalized = resolved.replace(/#.*$/, '').replace(/\?.*$/, '');
      let pathname = new URL(normalized).pathname;
      if (pathname.endsWith('/') && pathname.length > 1) pathname = pathname.slice(0, -1);
      const lookupUrl = baseOrigin + (pathname || '/');

      const localPath = urlToLocalPath.get(lookupUrl) || urlToLocalPath.get(normalized) || urlToLocalPath.get(resolved);
      if (localPath) {
        $(el).attr('href', localPath);
      }
    } catch (_) {}
  });

  return $.html();
}

/**
 * Rewrite image URLs in HTML
 * @param {string} html
 * @param {Map} imageMap - URL -> local path
 * @param {string} [baseUrl] - For resolving relative URLs in style attributes
 */
function rewriteHtmlImages(html, imageMap, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const getLocalPath = (url) => {
    if (imageMap.has(url)) return imageMap.get(url);
    const resolved = baseUrl && !url.startsWith('http') && !url.startsWith('data:') ? resolveUrl(url, baseUrl) : url;
    if (resolved && imageMap.has(resolved)) return imageMap.get(resolved);
    try {
      const u = new URL(url);
      u.search = '';
      u.hash = '';
      const normalized = u.href;
      if (imageMap.has(normalized)) return imageMap.get(normalized);
    } catch (_) {}
    return null;
  };

  $('img').each((_, el) => {
    let src = $(el).attr('src');
    const srcset = $(el).attr('srcset');
    const dataSrc = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') ||
      $(el).attr('data-image') || $(el).attr('data-img') || $(el).attr('data-slide-src');

    // Promote lazy src to src when src is placeholder (1x1, loading.gif, blank, etc.)
    const placeholderPattern = /(1x1|transparent|loading|spacer|blank|placeholder|data:image|\.gif\?|pixel|dummy)/i;
    let promoted = false;
    if ((!src || placeholderPattern.test(src)) && dataSrc) {
      const local = getLocalPath(dataSrc);
      if (local) {
        $(el).attr('src', local);
        $(el).removeAttr('data-src').removeAttr('data-lazy-src').removeAttr('data-original')
          .removeAttr('data-image').removeAttr('data-img').removeAttr('data-slide-src');
        promoted = true;
      }
    } else if (src) {
      const local = getLocalPath(src);
      if (local) $(el).attr('src', local);
    }
    if (srcset) {
      const newSrcset = srcset.split(',').map(part => {
        const trimmed = part.trim();
        const url = trimmed.split(/\s+/)[0];
        const local = getLocalPath(url);
        return local ? local + (trimmed.includes(' ') ? ' ' + trimmed.split(/\s+/).slice(1).join(' ') : '') : trimmed;
      }).join(', ');
      $(el).attr('srcset', newSrcset);
    }
    if (!promoted && dataSrc) {
      const local = getLocalPath(dataSrc);
      if (local) {
        for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-img', 'data-slide-src']) {
          if ($(el).attr(attr)) $(el).attr(attr, local);
        }
      }
    }
    const dataLazySrcset = $(el).attr('data-srcset') || $(el).attr('data-lazy-srcset');
    if (dataLazySrcset) {
      const newSrcset = dataLazySrcset.split(',').map(part => {
        const trimmed = part.trim();
        const url = trimmed.split(/\s+/)[0];
        const local = getLocalPath(url);
        return local ? local + (trimmed.includes(' ') ? ' ' + trimmed.split(/\s+/).slice(1).join(' ') : '') : trimmed;
      }).join(', ');
      $(el).attr('data-srcset', newSrcset);
    }
  });

  $('link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const local = getLocalPath(href);
      if (local) $(el).attr('href', local);
    }
  });

  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      const local = getLocalPath(content);
      if (local) $(el).attr('content', local);
    }
  });

  $('source[src], source[srcset]').each((_, el) => {
    const src = $(el).attr('src');
    const srcset = $(el).attr('srcset');
    if (src) {
      const local = getLocalPath(src);
      if (local) $(el).attr('src', local);
    }
    if (srcset) {
      const newSrcset = srcset.split(',').map(part => {
        const trimmed = part.trim();
        const url = trimmed.split(/\s+/)[0];
        const local = getLocalPath(url);
        return local ? local + (trimmed.includes(' ') ? ' ' + trimmed.split(/\s+/).slice(1).join(' ') : '') : trimmed;
      }).join(', ');
      $(el).attr('srcset', newSrcset);
    }
  });

  $('[style*="url("], [style*="url(\'"]').each((_, el) => {
    let style = $(el).attr('style');
    if (!style) return;
    style = style.replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (match, url) => {
      const local = getLocalPath(url.trim());
      return local ? `url("${local}")` : match;
    });
    $(el).attr('style', style);
  });

  const bgAttrs = ['data-background', 'data-bg', 'data-bg-src', 'data-background-image', 'data-src', 'data-image', 'data-img'];
  $('[data-background], [data-bg], [data-bg-src], [data-background-image]').each((_, el) => {
    for (const attr of bgAttrs) {
      const val = $(el).attr(attr);
      if (!val) continue;
      const local = getLocalPath(val);
      if (local) {
        $(el).attr(attr, local);
        const existingStyle = $(el).attr('style') || '';
        if (!existingStyle.includes('background-image')) {
          const bgStyle = `background-image: url("${local}"); background-size: cover; background-position: center;`;
          $(el).attr('style', existingStyle + (existingStyle ? ' ' : '') + bgStyle);
        }
      }
    }
  });

  const lazyBgAttrs = ['data-src', 'data-image', 'data-img', 'data-slide-src'];
  $('[data-src], [data-image], [data-img], [data-slide-src]').not('img').each((_, el) => {
    for (const attr of lazyBgAttrs) {
      const val = $(el).attr(attr);
      if (!val) continue;
      const local = getLocalPath(val);
      if (local && /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)/i.test(val)) {
        $(el).attr(attr, local);
        const existingStyle = $(el).attr('style') || '';
        if (!existingStyle.includes('background-image')) {
          const bgStyle = `background-image: url("${local}"); background-size: cover; background-position: center;`;
          $(el).attr('style', existingStyle + (existingStyle ? ' ' : '') + bgStyle);
        }
        break;
      }
    }
  });

  $('[data-thumb]').each((_, el) => {
    const val = $(el).attr('data-thumb');
    if (!val) return;
    const local = getLocalPath(val);
    if (local) $(el).attr('data-thumb', local);
  });

  return $.html();
}

/**
 * Rewrite image URLs in CSS - resolves relative URLs with baseUrl before lookup
 */
function rewriteCssImages(css, imageMap, baseUrl) {
  const getLocalPath = (url) => {
    const trimmed = url.trim();
    if (imageMap.has(trimmed)) return imageMap.get(trimmed);
    const toResolve = !trimmed.startsWith('http') && !trimmed.startsWith('data:') && baseUrl
      ? resolveUrl(trimmed, baseUrl) : trimmed;
    if (toResolve && imageMap.has(toResolve)) return imageMap.get(toResolve);
    try {
      const u = new URL(trimmed, baseUrl || 'http://localhost/');
      u.search = '';
      u.hash = '';
      if (imageMap.has(u.href)) return imageMap.get(u.href);
    } catch (_) {}
    return null;
  };

  return css.replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (match, url) => {
    const local = getLocalPath(url);
    return local ? `url("${local}")` : match;
  });
}

/**
 * Rewrite font URLs in CSS - resolves relative URLs with baseUrl
 */
function rewriteCssFonts(css, fontMap, baseUrl) {
  return css.replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (match, url) => {
    const trimmed = url.trim();
    if (fontMap.has(trimmed)) return `url("${fontMap.get(trimmed)}")`;
    const toResolve = !trimmed.startsWith('http') && !trimmed.startsWith('data:') && baseUrl
      ? resolveUrl(trimmed, baseUrl) : trimmed;
    if (toResolve && fontMap.has(toResolve)) return `url("${fontMap.get(toResolve)}")`;
    try {
      const u = new URL(trimmed, baseUrl || 'http://localhost/');
      u.search = '';
      if (fontMap.has(u.href)) return `url("${fontMap.get(u.href)}")`;
    } catch (_) {}
    return match;
  });
}

/**
 * Rewrite all asset URLs in CSS (images + fonts)
 */
function rewriteCss(css, imageMap, fontMap, baseUrl) {
  let result = css;
  if (imageMap && imageMap.size > 0) result = rewriteCssImages(result, imageMap, baseUrl);
  if (fontMap && fontMap.size > 0) result = rewriteCssFonts(result, fontMap, baseUrl);
  return result;
}

/**
 * Rewrite HTML with images, links, and stylesheet
 * @param {string} baseOrigin - Site base URL for link resolution
 * @param {string} [pageUrl] - Current page URL for resolving relative URLs in style attributes
 */
function rewriteHtml(html, imageMap, cssLocalPath, urlToLocalPath, baseOrigin, pageUrl) {
  let result = rewriteHtmlImages(html, imageMap || new Map(), pageUrl || baseOrigin);
  if (urlToLocalPath && baseOrigin) {
    result = rewriteHtmlLinks(result, urlToLocalPath, baseOrigin);
  }
  if (cssLocalPath) {
    const $ = cheerio.load(result, { decodeEntities: false });
    $('link[rel="stylesheet"]').attr('href', cssLocalPath);
    result = $.html();
  }
  return result;
}

module.exports = {
  rewriteHtmlLinks,
  rewriteHtmlImages,
  rewriteCssImages,
  rewriteCssFonts,
  rewriteCss,
  rewriteHtml
};
