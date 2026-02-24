/**
 * Multi-page crawler - follows all internal links until complete
 * Uses Puppeteer by default (hero images, sliders). HTTP fallback if Puppeteer fails.
 */

const { URL } = require('url');
const { fetchUrl } = require('./fetcher');
const { JobLogger } = require('./utils/logger');
const { resolveUrl, isValidInternalUrl, isFetchableUrl } = require('./utils/url');
const cheerio = require('cheerio');

// Lazy-load Puppeteer only when needed
let puppeteer = null;
function getPuppeteer() {
  if (!puppeteer) puppeteer = require('puppeteer');
  return puppeteer;
}

/**
 * Normalize origin for comparison (www.example.com and example.com = same)
 */
function normalizeOrigin(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return `${u.protocol}//${host}`;
  } catch {
    return url;
  }
}

/**
 * Check if URL is internal (same origin, including www variant)
 */
function isInternalUrl(baseUrl, targetUrl) {
  try {
    return normalizeOrigin(baseUrl) === normalizeOrigin(targetUrl);
  } catch {
    return false;
  }
}

/**
 * Normalize URL (remove hash, trailing slash variations)
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
    u.pathname = path || '/';
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Extract links from HTML using Cheerio (more reliable)
 */
function extractLinks(html, baseUrl) {
  const links = new Set();
  const baseOrigin = new URL(baseUrl).origin;
  const $ = cheerio.load(html, { decodeEntities: false });

  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const resolved = resolveUrl(href, baseUrl);
    if (resolved && isInternalUrl(baseUrl, resolved) && isValidInternalUrl(resolved, baseOrigin)) {
      links.add(normalizeUrl(resolved));
    }
  });

  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const resolved = resolveUrl(match[1], baseUrl);
    if (resolved && isInternalUrl(baseUrl, resolved) && isValidInternalUrl(resolved, baseOrigin)) {
      links.add(normalizeUrl(resolved));
    }
  }

  return [...links];
}

/**
 * Parse a single sitemap XML and return URLs + sub-sitemap URLs
 */
async function parseSitemap(sitemapUrl, baseOrigin, logger) {
  const urls = new Set();
  const subs = [];
  try {
    const { data, status } = await fetchUrl(sitemapUrl, { timeout: 10000, rejectUnauthorized: false });
    if (status !== 200) return urls;

    const $ = cheerio.load(data, { xmlMode: true });
    $('url loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (!loc || !isInternalUrl(baseOrigin, loc)) return;
      const lower = loc.toLowerCase();
      if (lower.endsWith('.rss') || lower.endsWith('.xml') || lower.includes('/rss') || lower.includes('/feed')) return;
      urls.add(normalizeUrl(loc));
    });
    $('sitemap loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc && isInternalUrl(baseOrigin, loc)) subs.push(loc);
    });
    if ($('loc').length && $('url loc').length === 0) {
      $('loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (!loc || !isInternalUrl(baseOrigin, loc)) return;
        const lower = loc.toLowerCase();
        if (lower.endsWith('.rss') || lower.endsWith('.xml') || lower.includes('/rss') || lower.includes('/feed')) return;
        urls.add(normalizeUrl(loc));
      });
    }
    for (const sub of subs.slice(0, 100)) {
      const subUrls = await parseSitemap(sub, baseOrigin, logger);
      subUrls.forEach(u => urls.add(u));
    }
  } catch (_) {}
  return urls;
}

/**
 * Fetch sitemap.xml to discover URLs
 */
async function fetchSitemapUrls(baseUrl, logger) {
  const urls = new Set();
  const baseOrigin = new URL(baseUrl).origin;
  const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap/index.xml'];

  for (const path of sitemapPaths) {
    try {
      const url = new URL(path, baseUrl).href;
      const found = await parseSitemap(url, baseOrigin, logger);
      found.forEach(u => urls.add(u));
      if (urls.size > 0) {
        logger.info(`Found ${urls.size} URLs in sitemap`);
        break;
      }
    } catch (_) {}
  }

  return [...urls];
}

/**
 * Crawl using Puppeteer
 */
async function crawlSitePuppeteer(startUrl, options = {}) {
  const logger = options.logger || new JobLogger('crawl');
  const baseOrigin = new URL(startUrl).origin;
  const normOrigin = normalizeOrigin(startUrl);

  const visited = new Set();
  const toVisit = [normalizeUrl(startUrl)];
  const pages = [];
  const maxPages = options.maxPages || 2000;

  const pptr = getPuppeteer();
  const browser = await pptr.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ignoreHTTPSErrors: true,
    timeout: 15000
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    while (toVisit.length > 0 && pages.length < maxPages) {
      const url = toVisit.shift();
      if (visited.has(url)) continue;

      visited.add(url);
      logger.info(`Fetching: ${url}`);

      try {
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        if (!response || response.status() >= 400) {
          if (response?.status() === 404) continue;
          logger.error(`Failed to load ${url}: ${response?.status() || 'no response'}`);
          continue;
        }

        // Homepage gets extra wait - hero carousels often load last
        const isHomepage = pages.length === 0;
        const heroWait = isHomepage ? 5000 : 3000;
        await new Promise(r => setTimeout(r, heroWait));

        // Wait for ALL carousel/slider images (Slick, Swiper, Owl, Bootstrap, Flexslider, custom)
        const carouselSelectors = [
          '.flexslider img', '.slideshow img', '.slides img', '.slide img',
          '[class*="hero"] img', '[class*="carousel"] img', '[class*="slider"] img',
          '[class*="banner"] img', '[class*="gallery"] img',
          '.slick-slide img', '.slick-slider img', '.swiper-slide img', '.swiper-wrapper img',
          '.owl-carousel img', '.owl-item img', '.carousel-item img', '.carousel-inner img',
          '[class*="slide"] img', '[class*="slider"] img'
        ].join(', ');
        await page.evaluate((sel) => {
          const imgs = document.querySelectorAll(sel);
          return Promise.all(Array.from(imgs).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 8000); });
          }));
        }, carouselSelectors).catch(() => {});

        // Reveal hidden slides so their images load (carousels often hide non-active slides)
        await page.evaluate(() => {
          const slideSelectors = '.owl-item, .slick-slide, .swiper-slide, .carousel-item, .slides li, .slide, [class*="slide"]';
          document.querySelectorAll(slideSelectors).forEach(el => {
            if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.style.opacity === '0') {
              el.style.setProperty('display', 'block', 'important');
              el.style.setProperty('visibility', 'visible', 'important');
              el.style.setProperty('opacity', '1', 'important');
            }
            el.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => {
              const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
              if (src && (!img.src || img.src.includes('data:') || img.src.includes('blank'))) {
                img.src = src;
              }
            });
          });
        }).catch(() => {});

        await new Promise(r => setTimeout(r, 1500));

        // Simulate clicking through carousel next buttons to load all slide images
        await page.evaluate(async () => {
          const nextSelectors = [
            '.slick-next', '.slick-prev', '.owl-next', '.owl-prev',
            '.carousel-control-next', '.carousel-control-prev',
            '[data-slide="next"]', '[data-slide="prev"]', '[data-bs-slide="next"]',
            '.flex-direction-nav .next', '.flex-direction-nav .prev',
            '.slider-next', '.slider-prev', '.carousel-next', '.carousel-prev',
            'button[aria-label*="next"]', 'button[aria-label*="Next"]',
            'a[href="#next"]', '.next', '.prev'
          ];
          for (let round = 0; round < 15; round++) {
            let clicked = false;
            for (const sel of nextSelectors) {
              const btn = document.querySelector(sel);
              if (btn && btn.offsetParent !== null) {
                btn.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 400));
                break;
              }
            }
            if (!clicked) break;
          }
        }).catch(() => {});

        await new Promise(r => setTimeout(r, 2000));

        await page.evaluate(async () => {
          await new Promise(resolve => {
            let totalHeight = 0;
            const timer = setInterval(() => {
              window.scrollBy(0, 300);
              totalHeight += 300;
              if (totalHeight >= document.body.scrollHeight) {
                clearInterval(timer);
                window.scrollTo(0, 0);
                resolve();
              }
            }, 150);
          });
        }).catch(() => {});

        // Wait for lazy-loaded images to populate after scroll
        await new Promise(r => setTimeout(r, 2500));

        await page.evaluate(() => {
          return Promise.all(
            Array.from(document.images)
              .filter(img => !img.complete)
              .map(img => new Promise(resolve => {
                img.onload = img.onerror = resolve;
                setTimeout(resolve, 5000);
              }))
          );
        }).catch(() => {});

        // Final settle so hero/carousel images fully render
        await new Promise(r => setTimeout(r, 1500));

        const html = await page.content();
        const title = await page.title();
        pages.push({ url, html, title });

        const links = extractLinks(html, url);
        for (const link of links) {
          const normalized = normalizeUrl(link);
          if (!visited.has(normalized) && !toVisit.includes(normalized) && normalizeOrigin(link) === normOrigin && isFetchableUrl(normalized)) {
            toVisit.push(normalized);
          }
        }
      } catch (err) {
        logger.error(`Error fetching ${url}: ${err.message}`);
      }
    }

    logger.info(`Crawled ${pages.length} pages`);
  } finally {
    await browser.close();
  }

  return { pages, baseUrl: baseOrigin, sitemap: pages.map(p => ({ url: p.url, title: p.title })) };
}

/**
 * Crawl using HTTP only - fetches sitemap first for full discovery
 */
async function crawlSiteSimple(startUrl, options = {}) {
  const logger = options.logger || new JobLogger('crawl');
  const baseOrigin = new URL(startUrl).origin;
  const normOrigin = normalizeOrigin(startUrl);

  const visited = new Set();
  let toVisit = [normalizeUrl(startUrl)];

  // Try sitemap first for more complete discovery
  const sitemapUrls = await fetchSitemapUrls(baseOrigin + '/', logger);
  for (const u of sitemapUrls) {
    if (!visited.has(u) && !toVisit.includes(u) && isFetchableUrl(u)) {
      toVisit.push(u);
    }
  }

  const pages = [];
  const maxPages = options.maxPages || 2000;

  while (toVisit.length > 0 && pages.length < maxPages) {
    const url = toVisit.shift();
    if (visited.has(url)) continue;

    visited.add(url);
    logger.info(`Fetching: ${url}`);

    try {
      const { data: html, status } = await fetchUrl(url, { timeout: 25000, rejectUnauthorized: false });
      if (status >= 400) {
        if (status === 404) continue;
        logger.error(`Failed to load ${url}: ${status}`);
        continue;
      }

      const $ = cheerio.load(html);
      const title = $('title').text().trim() || '';

      pages.push({ url, html, title });

      const links = extractLinks(html, url);
      for (const link of links) {
        const normalized = normalizeUrl(link);
        if (!visited.has(normalized) && !toVisit.includes(normalized) && normalizeOrigin(link) === normOrigin && isFetchableUrl(normalized)) {
          toVisit.push(normalized);
        }
      }
    } catch (err) {
      logger.error(`Error fetching ${url}: ${err.message}`);
    }
  }

  logger.info(`Crawled ${pages.length} pages`);
  return {
    pages,
    baseUrl: baseOrigin,
    sitemap: pages.map(p => ({ url: p.url, title: p.title }))
  };
}

/**
 * Crawl - Puppeteer by default (for hero images, sliders), HTTP fallback
 */
async function crawlSite(startUrl, options = {}) {
  const logger = options.logger || new JobLogger('crawl');
  const usePuppeteer = options.usePuppeteer !== false && process.env.PUPPETEER_DISABLE !== '1';

  if (usePuppeteer) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        logger.info(attempt === 1 ? 'Starting crawl (Puppeteer - waiting for images)...' : `Retry ${attempt}...`);
        return await crawlSitePuppeteer(startUrl, options);
      } catch (err) {
        logger.info(`Puppeteer failed (${err.message}), falling back to HTTP...`);
        if (attempt === 2) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  logger.info('Using HTTP mode');
  return await crawlSiteSimple(startUrl, options);
}

module.exports = {
  crawlSite,
  crawlSiteSimple,
  crawlSitePuppeteer,
  fetchSitemapUrls,
  isInternalUrl,
  normalizeUrl,
  extractLinks
};
