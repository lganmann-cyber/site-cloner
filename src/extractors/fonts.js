/**
 * Font extraction - @font-face, Google Fonts
 */

const cheerio = require('cheerio');
const { fetchUrl, fetchBuffer } = require('../fetcher');
const { URL } = require('url');
const { resolveUrl, isFetchableUrl } = require('../utils/url');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');

const FONT_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];

/**
 * Extract font URLs from CSS
 */
function extractFontUrlsFromCss(css, baseUrl) {
  const urls = new Set();
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
  const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g;

  let match;
  while ((match = fontFaceRegex.exec(css)) !== null) {
    const block = match[1];
    let urlMatch;
    while ((urlMatch = urlRegex.exec(block)) !== null) {
      const u = urlMatch[1].trim();
      if (u.startsWith('data:')) continue;
      const resolved = resolveUrl(u, baseUrl);
      if (resolved && isFetchableUrl(resolved) && FONT_EXTENSIONS.some(ext => resolved.toLowerCase().includes(ext))) {
        urls.add(resolved);
      }
    }
  }

  return [...urls];
}

/**
 * Extract Google Fonts from HTML
 */
function extractGoogleFontsFromHtml(html) {
  const urls = new Set();
  const linkRegex = /<link[^>]+href=["']([^"']*fonts\.googleapis\.com[^"']*)["']/gi;
  const importRegex = /@import\s+["']([^"']*fonts\.googleapis\.com[^"']*)["']/g;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const u = match[1].startsWith('http') ? match[1] : 'https://' + match[1].replace(/^\/+/, '');
    if (isFetchableUrl(u)) urls.add(u);
  }
  while ((match = importRegex.exec(html)) !== null) {
    const u = match[1].startsWith('http') ? match[1] : 'https://' + match[1].replace(/^\/+/, '');
    if (isFetchableUrl(u)) urls.add(u);
  }

  return [...urls];
}

/**
 * Fetch Google Font CSS and extract font file URLs
 */
async function resolveGoogleFonts(googleUrls) {
  const fontUrls = new Set();
  for (const url of googleUrls) {
    try {
      const { data } = await fetchUrl(url, { responseType: 'text', rejectUnauthorized: false });
      const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g;
      let m;
      while ((m = urlRegex.exec(data)) !== null) {
        const u = m[1].trim();
        if (u.startsWith('http') && FONT_EXTENSIONS.some(ext => u.toLowerCase().includes(ext))) {
          fontUrls.add(u);
        }
      }
    } catch (_) {}
  }
  return [...fontUrls];
}

/**
 * Generate safe filename for font URL
 */
function urlToFontFilename(url) {
  try {
    const u = new URL(url);
    let name = u.pathname.split('/').pop() || 'font';
    const ext = path.extname(name) || '.woff2';
    if (!name.endsWith(ext)) name += ext;
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return name || 'font' + ext;
  } catch {
    return 'font_' + Math.random().toString(36).slice(2) + '.woff2';
  }
}

/**
 * Download and save fonts
 */
async function downloadFonts(urls, outputDir, logger) {
  const saved = new Map();
  fs.ensureDirSync(outputDir);

  for (const url of urls) {
    if (!isFetchableUrl(url)) continue;
    try {
      const filename = urlToFontFilename(url);
      const filepath = path.join(outputDir, filename);

      if (fs.existsSync(filepath)) {
        saved.set(url, `./assets/fonts/${filename}`);
        continue;
      }

      const buffer = await fetchBuffer(url, { rejectUnauthorized: false });
      fs.writeFileSync(filepath, buffer);
      saved.set(url, `./assets/fonts/${filename}`);
      if (logger) logger.info(`Downloaded font: ${filename}`);
    } catch (err) {
      if (logger) logger.error(`Failed to download font ${url}: ${err.message}`);
    }
  }

  return saved;
}

/**
 * Extract and download all fonts
 */
async function extractFonts(pages, cssContent, baseUrl, outputDir, logger) {
  const allUrls = new Set();

  extractFontUrlsFromCss(cssContent || '', baseUrl).forEach(u => allUrls.add(u));

  for (const page of pages) {
    const googleUrls = extractGoogleFontsFromHtml(page.html);
    const resolved = await resolveGoogleFonts(googleUrls);
    resolved.forEach(u => allUrls.add(u));
  }

  const urlMap = await downloadFonts([...allUrls], outputDir, logger);
  return urlMap;
}

module.exports = {
  extractFontUrlsFromCss,
  extractFonts,
  urlToFontFilename,
  resolveGoogleFonts
};
