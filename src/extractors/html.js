/**
 * HTML extraction and processing
 */

const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs-extra');
const { URL } = require('url');

/**
 * Generate URL slug for filename (about, contact, blog-post-1)
 */
function urlToSlug(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/$/, '') || 'index';
    p = p.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return p || 'index';
  } catch {
    return 'page';
  }
}

/**
 * Extract and save HTML pages with slug-based filenames
 * Returns urlToLocalPath map for link rewriting
 */
function extractHtml(pages, outputDir) {
  const saved = [];
  const htmlDir = outputDir;
  const usedSlugs = new Set();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let slug = urlToSlug(page.url);
    if (usedSlugs.has(slug)) {
      let n = 1;
      while (usedSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);

    const filename = slug === 'index' ? 'index.html' : `${slug}.html`;
    const filepath = path.join(htmlDir, filename);
    fs.ensureDirSync(path.dirname(filepath));
    fs.writeFileSync(filepath, page.html, 'utf8');
    saved.push({ path: filepath, url: page.url, filename });
  }

  return saved;
}

/**
 * Build URL to local path mapping (for link rewriting)
 */
function buildUrlToLocalPath(htmlFiles, baseOrigin) {
  const map = new Map();
  for (const f of htmlFiles) {
    try {
      const variants = getUrlVariants(f.url, baseOrigin);
      for (const v of variants) {
        map.set(v, f.filename);
      }
    } catch (_) {}
  }
  return map;
}

function getUrlVariants(url, baseOrigin) {
  const variants = new Set([url]);
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let p = u.pathname;
    if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
    const pathOnly = p || '/';
    const origins = [baseOrigin];
    const altOrigin = baseOrigin.includes('www.') ? baseOrigin.replace('www.', '') : baseOrigin.replace(/^(https?:\/\/)/, '$1www.');
    origins.push(altOrigin);
    for (const orig of origins) {
      variants.add(orig + pathOnly);
      variants.add(orig + pathOnly + (pathOnly === '/' ? '' : '/'));
    }
  } catch (_) {}
  return [...variants];
}

/**
 * Parse HTML with Cheerio
 */
function parseHtml(html) {
  return cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false
  });
}

/**
 * Extract head content (for header.php)
 */
function extractHead($) {
  const head = $('head');
  return head.length ? head.html() || '' : '';
}

/**
 * Extract body content
 */
function extractBody($) {
  const body = $('body');
  return body.length ? body.html() || '' : '';
}

/**
 * Extract header section (first header or first 20% of body)
 */
function extractHeaderSection($) {
  const header = $('header').first();
  if (header.length) return header.parent().html() ? header.prop('outerHTML') : '';
  const nav = $('nav').first();
  if (nav.length) return nav.prop('outerHTML') || '';
  return '';
}

/**
 * Extract footer section
 */
function extractFooterSection($) {
  const footer = $('footer').last();
  if (footer.length) return footer.prop('outerHTML') || '';
  return '';
}

module.exports = {
  extractHtml,
  buildUrlToLocalPath,
  urlToSlug,
  parseHtml,
  extractHead,
  extractBody,
  extractHeaderSection,
  extractFooterSection
};
