/**
 * Image extraction - img src, srcset, data-src, data-lazy-src, background-image, favicons, SVGs
 */

const cheerio = require('cheerio');
const { fetchBuffer } = require('../fetcher');
const { URL } = require('url');
const { resolveUrl, isFetchableUrl } = require('../utils/url');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'];
const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-lazy', 'data-original', 'data-srcset', 'data-lazy-srcset', 'data-slide-src', 'data-image', 'data-img'];
const BG_ATTRS = ['data-background', 'data-bg', 'data-bg-src', 'data-background-image', 'data-src', 'data-srcset'];

/**
 * Normalize URL for consistent lookup (strip query, hash)
 */
function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Check if URL looks like an image
 */
function isImageUrl(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    if (pathname.includes('/image') || pathname.includes('/img') || pathname.includes('/photo') || pathname.includes('/media')) return true;
    return IMAGE_EXTENSIONS.some(ext => pathname.endsWith(ext) || pathname.includes(ext + '?'));
  } catch {
    return false;
  }
}

/**
 * Extract image URLs from HTML
 */
function extractImageUrlsFromHtml(html, baseUrl) {
  const urls = new Set();
  const $ = cheerio.load(html, { decodeEntities: false });

  $('img').each((_, el) => {
    const attrs = ['src', 'srcset', ...LAZY_ATTRS];
    for (const attr of attrs) {
      const val = $(el).attr(attr);
      if (!val) continue;
      if (attr === 'srcset') {
        val.split(',').forEach(part => {
          const u = resolveUrl(part.trim().split(/\s+/)[0], baseUrl);
          if (u && isFetchableUrl(u)) urls.add(u);
        });
      } else {
        const u = resolveUrl(val, baseUrl);
        if (u && isFetchableUrl(u)) urls.add(u);
      }
    }
  });

  $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
    const u = resolveUrl($(el).attr('href'), baseUrl);
    if (u && isFetchableUrl(u)) urls.add(u);
  });

  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    const u = resolveUrl($(el).attr('content'), baseUrl);
    if (u && isFetchableUrl(u)) urls.add(u);
  });

  $('source[src], source[srcset]').each((_, el) => {
    const src = resolveUrl($(el).attr('src'), baseUrl);
    if (src && isFetchableUrl(src)) urls.add(src);
    const srcset = $(el).attr('srcset');
    if (srcset) {
      srcset.split(',').forEach(part => {
        const u = resolveUrl(part.trim().split(/\s+/)[0], baseUrl);
        if (u && isFetchableUrl(u)) urls.add(u);
      });
    }
  });

  $('[style*="background-image"], [style*="background:"], [style*="url("]').each((_, el) => {
    const style = $(el).attr('style');
    if (!style) return;
    const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g;
    let m;
    while ((m = urlRegex.exec(style)) !== null) {
      const u = resolveUrl(m[1], baseUrl);
      if (u && isFetchableUrl(u)) urls.add(u);
    }
  });

  $('*').each((_, el) => {
    for (const attr of BG_ATTRS) {
      const val = $(el).attr(attr);
      if (!val) continue;
      if (attr === 'data-srcset') {
        val.split(',').forEach(part => {
          const u = resolveUrl(part.trim().split(/\s+/)[0], baseUrl);
          if (u && isFetchableUrl(u)) urls.add(u);
        });
      } else {
        const u = resolveUrl(val, baseUrl);
        if (u && isFetchableUrl(u) && (isImageUrl(u) || /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)/i.test(val))) urls.add(u);
      }
    }
    const dataThumb = $(el).attr('data-thumb');
    if (dataThumb) {
      const u = resolveUrl(dataThumb, baseUrl);
      if (u && isFetchableUrl(u) && (isImageUrl(u) || /\.(png|jpg|jpeg|gif|webp)/i.test(dataThumb))) urls.add(u);
    }
  });

  // Raw HTML scan - catch image URLs we might have missed (carousels, JSON, inline styles)
  const urlPatterns = [
    /(?:url\s*\(\s*["']?|src\s*=\s*["']|data-(?:src|background|bg|image|img|slide-src|thumb)\s*=\s*["'])([^"')>\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif)(?:\?[^"')>\s]*)?)/gi,
    /["']([^"']*(?:\/uploads\/|\/images\/|\/img\/|\/media\/|\/assets\/|\/userfiles\/)[^"']*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"']*)?)["']/gi
  ];
  for (const re of urlPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = resolveUrl(m[1], baseUrl);
      if (u && isFetchableUrl(u)) urls.add(u);
    }
  }

  return [...urls];
}

/**
 * Extract image URLs from CSS
 */
function extractImageUrlsFromCss(css, baseUrl) {
  const urls = new Set();
  const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g;
  let match;
  const imagePathPattern = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|avif)|(\/image|\/img|\/photo|\/media|\/uploads|\/userfiles|\/assets)/i;
  while ((match = urlRegex.exec(css)) !== null) {
    const u = match[1].trim();
    if (u.startsWith('data:')) continue;
    const resolved = resolveUrl(u, baseUrl);
    if (resolved && isFetchableUrl(resolved) && (isImageUrl(resolved) || imagePathPattern.test(u))) {
      urls.add(resolved);
    }
  }
  return [...urls];
}

/**
 * Generate safe filename for URL
 */
function urlToFilename(url) {
  try {
    const u = new URL(url);
    let name = u.pathname.replace(/\//g, '_').replace(/^_/, '') || 'image';
    const ext = path.extname(name) || mime.extension(mime.lookup(url)) || '.bin';
    if (!name.endsWith(ext)) name += ext;
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    return name || 'image' + ext;
  } catch {
    return 'image_' + Math.random().toString(36).slice(2) + '.bin';
  }
}

/**
 * Download and save images - stores multiple URL variants in map for lookup
 */
async function downloadImages(urls, outputDir, logger) {
  const saved = new Map();
  const seen = new Set();
  fs.ensureDirSync(outputDir);

  for (const url of urls) {
    if (!isFetchableUrl(url)) continue;
    const normalized = normalizeImageUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    try {
      const filename = urlToFilename(url);
      const filepath = path.join(outputDir, filename);

      if (fs.existsSync(filepath)) {
        const localPath = `./assets/images/${filename}`;
        saved.set(url, localPath);
        saved.set(normalized, localPath);
        continue;
      }

      const buffer = await fetchBuffer(url, { rejectUnauthorized: false });
      fs.writeFileSync(filepath, buffer);
      const localPath = `./assets/images/${filename}`;
      saved.set(url, localPath);
      saved.set(normalized, localPath);
      if (logger) logger.info(`Downloaded image: ${filename}`);
    } catch (err) {
      if (logger) logger.error(`Failed to download ${url}: ${err.message}`);
    }
  }

  return saved;
}

/**
 * Extract and download all images from pages and CSS
 */
async function extractImages(pages, cssContent, baseUrl, outputDir, logger) {
  const allUrls = new Set();

  for (const page of pages) {
    extractImageUrlsFromHtml(page.html, page.url).forEach(u => allUrls.add(u));
  }
  if (cssContent) {
    extractImageUrlsFromCss(cssContent, baseUrl).forEach(u => allUrls.add(u));
  }

  const urlMap = await downloadImages([...allUrls], outputDir, logger);
  return urlMap;
}

module.exports = {
  extractImageUrlsFromHtml,
  extractImageUrlsFromCss,
  extractImages,
  urlToFilename,
  normalizeImageUrl,
  isImageUrl
};
