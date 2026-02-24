/**
 * CSS extraction and consolidation
 * Extracts: <style> blocks, <link rel="stylesheet">, inline styles, @import
 */

const cheerio = require('cheerio');
const { fetchUrl, fetchBuffer } = require('../fetcher');
const { URL } = require('url');
const { resolveUrl, isFetchableUrl } = require('../utils/url');
const path = require('path');
const fs = require('fs-extra');

/**
 * Extract all CSS from HTML
 * @param {string} html - Page HTML
 * @param {string} baseUrl - Base URL for resolving
 * @param {object} options - { fetchExternal: boolean }
 * @returns {Promise<Array<{content: string, order: number, source: string}>>}
 */
async function extractCssFromHtml(html, baseUrl, options = {}) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const cssBlocks = [];
  let order = 0;

  // 1. Inline <style> blocks
  $('style').each((i, el) => {
    const content = $(el).html();
    if (content) {
      cssBlocks.push({ content: content.trim(), order: order++, source: 'inline-style' });
    }
  });

  // 2. <link rel="stylesheet">
  const linkPromises = [];
  $('link[rel="stylesheet"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved && isFetchableUrl(resolved)) {
        linkPromises.push(
          fetchUrl(resolved, { responseType: 'text', rejectUnauthorized: false })
            .then(({ data }) => ({
              content: data,
              order: order++,
              source: resolved
            }))
            .catch(() => null)
        );
      }
    }
  });

  const linkResults = await Promise.all(linkPromises);
  for (const r of linkResults) {
    if (r && r.content) cssBlocks.push(r);
  }

  // Inline style attributes are preserved in HTML - no need to duplicate in CSS

  return cssBlocks.sort((a, b) => a.order - b.order);
}

/**
 * Resolve @import in CSS
 */
async function resolveImports(css, baseUrl, seen = new Set()) {
  const importRegex = /@import\s+(?:url\s*\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*[^;]*;/g;
  let match;
  const imports = [];
  while ((match = importRegex.exec(css)) !== null) {
    const url = match[1] || match[2];
    const resolved = resolveUrl(url, baseUrl);
    if (resolved && !seen.has(resolved) && isFetchableUrl(resolved)) {
      seen.add(resolved);
      try {
        const { data } = await fetchUrl(resolved, { responseType: 'text', rejectUnauthorized: false });
        imports.push({ content: await resolveImports(data, resolved, seen), order: 0, source: resolved });
      } catch (_) {}
    }
  }

  let result = css;
  result = result.replace(importRegex, '/* @import resolved */');
  for (const imp of imports) {
    result = imp.content + '\n' + result;
  }
  return result;
}

/**
 * Consolidate all CSS into one file
 */
async function consolidateCss(cssBlocks, baseUrl) {
  const parts = [];
  for (const block of cssBlocks) {
    let content = block.content;
    if (block.source.startsWith('http')) {
      content = await resolveImports(content, block.source);
    }
    parts.push(`/* From: ${block.source} */\n${content}`);
  }
  return parts.join('\n\n');
}

/**
 * Extract and consolidate CSS from pages
 */
async function extractCss(pages, baseUrl, outputPath) {
  const allBlocks = [];
  const seen = new Set();

  for (const page of pages) {
    const blocks = await extractCssFromHtml(page.html, page.url);
    for (const block of blocks) {
      const key = block.source + block.content.slice(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        allBlocks.push(block);
      }
    }
  }

  const consolidated = await consolidateCss(allBlocks, baseUrl);
  fs.ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, consolidated, 'utf8');
  return outputPath;
}

module.exports = {
  extractCssFromHtml,
  consolidateCss,
  extractCss,
  resolveImports
};
