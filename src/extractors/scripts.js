/**
 * JavaScript extraction - script src, inline scripts
 * Downloads external scripts and consolidates for WordPress theme
 */

const cheerio = require('cheerio');
const { fetchUrl } = require('../fetcher');
const { resolveUrl, isFetchableUrl } = require('../utils/url');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

/**
 * Extract all scripts from HTML (external + inline)
 * @param {string} html - Page HTML
 * @param {string} baseUrl - Base URL for resolving
 * @returns {Promise<Array<{content: string, order: number, source: string, isInline: boolean}>>}
 */
async function extractScriptsFromHtml(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const scripts = [];
  let order = 0;

  $('script').each((i, el) => {
    const src = $(el).attr('src');
    const content = $(el).html();
    const type = ($(el).attr('type') || '').toLowerCase();

    // Skip non-JS (e.g. type="application/ld+json")
    if (type && type !== 'text/javascript' && type !== 'application/javascript' && !type.includes('javascript')) {
      return;
    }

    if (src) {
      const resolved = resolveUrl(src, baseUrl);
      if (resolved && isFetchableUrl(resolved)) {
        scripts.push({
          src: resolved,
          order: order++,
          source: resolved,
          isInline: false
        });
      }
    } else if (content && content.trim()) {
      scripts.push({
        content: content.trim(),
        order: order++,
        source: 'inline',
        isInline: true
      });
    }
  });

  return scripts.sort((a, b) => a.order - b.order);
}

/**
 * Download external script and return content
 */
async function fetchScript(url) {
  try {
    const { data } = await fetchUrl(url, { responseType: 'text', rejectUnauthorized: false });
    return data || '';
  } catch {
    return '';
  }
}

/**
 * Generate safe filename for script URL
 */
function urlToScriptFilename(url) {
  try {
    const u = new URL(url);
    let name = u.pathname.replace(/\//g, '_').replace(/^_/, '') || 'script';
    const ext = path.extname(name) || '.js';
    if (!name.endsWith(ext)) name += ext;
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return name || 'script' + ext;
  } catch {
    return 'script_' + crypto.randomBytes(4).toString('hex') + '.js';
  }
}

/**
 * Extract and save all scripts from pages
 * @param {Array} pages - Array of {url, html}
 * @param {string} baseUrl - Base URL
 * @param {string} outputDir - Output directory (assets/js)
 * @returns {Promise<{scripts: Array, scriptMap: Map}>} - scriptMap: url -> local path
 */
async function extractScripts(pages, baseUrl, outputDir, logger) {
  const allScripts = [];
  const seen = new Set();
  const scriptMap = new Map();
  fs.ensureDirSync(outputDir);

  for (const page of pages) {
    const scripts = await extractScriptsFromHtml(page.html, page.url);
    for (const script of scripts) {
      if (script.isInline) {
        const key = 'inline:' + script.content.slice(0, 100);
        if (!seen.has(key)) {
          seen.add(key);
          allScripts.push(script);
        }
      } else {
        const url = script.src;
        if (!seen.has(url)) {
          seen.add(url);
          try {
            const content = await fetchScript(url);
            if (content) {
              const filename = urlToScriptFilename(url);
              const filepath = path.join(outputDir, filename);
              fs.writeFileSync(filepath, content, 'utf8');
              const localPath = `./assets/js/${filename}`;
              scriptMap.set(url, localPath);
              allScripts.push({
                ...script,
                content,
                localPath,
                filename
              });
              if (logger) logger.info(`Downloaded script: ${filename}`);
            }
          } catch (err) {
            if (logger) logger.error(`Failed to download script ${url}: ${err.message}`);
          }
        }
      }
    }
  }

  // Build consolidated script content (inline scripts in order)
  const inlineScripts = allScripts.filter(s => s.isInline).sort((a, b) => a.order - b.order);
  const externalScripts = allScripts.filter(s => !s.isInline).sort((a, b) => a.order - b.order);

  return {
    scripts: allScripts,
    inlineScripts,
    externalScripts,
    scriptMap,
    externalPaths: externalScripts.map(s => s.localPath).filter(Boolean)
  };
}

module.exports = {
  extractScriptsFromHtml,
  extractScripts,
  urlToScriptFilename
};
