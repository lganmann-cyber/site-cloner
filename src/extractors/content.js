/**
 * Content extraction - text, headings, paragraphs, meta, alt text
 */

const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

/**
 * Extract text content from element
 */
function getText($, el) {
  return $(el).text().trim();
}

/**
 * Extract all content from pages
 */
function extractContent(pages) {
  const content = {
    pages: [],
    meta: {},
    headings: [],
    paragraphs: [],
    links: [],
    images: []
  };

  for (const page of pages) {
    const $ = cheerio.load(page.html, { decodeEntities: false });
    const bodyHtml = $('body').html() || '';
    const pageContent = {
      url: page.url,
      title: page.title || $('title').text().trim(),
      bodyHtml,
      meta: {},
      headings: [],
      paragraphs: [],
      links: [],
      images: []
    };

    // Meta
    $('meta[name="description"]').each((_, el) => {
      pageContent.meta.description = $(el).attr('content') || '';
    });
    $('meta[property="og:title"]').each((_, el) => {
      pageContent.meta.ogTitle = $(el).attr('content') || '';
    });
    $('meta[property="og:description"]').each((_, el) => {
      pageContent.meta.ogDescription = $(el).attr('content') || '';
    });

    // Headings
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = getText($, el);
      if (text) {
        pageContent.headings.push({ tag: el.tagName, text });
      }
    });

    // Paragraphs
    $('p').each((_, el) => {
      const text = getText($, el);
      if (text) pageContent.paragraphs.push(text);
    });

    // Links
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = getText($, el);
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        pageContent.links.push({ href, text });
      }
    });

    // Image alt text
    $('img[alt]').each((_, el) => {
      const alt = $(el).attr('alt');
      const src = $(el).attr('src');
      if (alt) pageContent.images.push({ src, alt });
    });

    // List items, table cells
    $('li, td, th').each((_, el) => {
      const text = getText($, el);
      if (text && text.length > 10) pageContent.paragraphs.push(text);
    });

    content.pages.push(pageContent);
    content.headings.push(...pageContent.headings);
    content.paragraphs.push(...pageContent.paragraphs);
    content.links.push(...pageContent.links);
    content.images.push(...pageContent.images);
  }

  return content;
}

/**
 * Save content to JSON
 */
function saveContent(content, outputPath) {
  fs.ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(content, null, 2), 'utf8');
  return outputPath;
}

module.exports = {
  extractContent,
  saveContent
};
