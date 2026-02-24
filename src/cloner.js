/**
 * Main orchestration - coordinates crawler, extractors, rewriter, WordPress output
 */

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { JobLogger } = require('./utils/logger');
const { crawlSite } = require('./crawler');
const { extractHtml, buildUrlToLocalPath } = require('./extractors/html');
const { extractCss } = require('./extractors/css');
const { extractImages } = require('./extractors/images');
const { extractFonts } = require('./extractors/fonts');
const { extractContent, saveContent } = require('./extractors/content');
const { extractScripts } = require('./extractors/scripts');
const { rewriteHtml, rewriteCss } = require('./rewriter');
const { generateWordPressTheme } = require('./wordpress');
const { createZipFromDir } = require('./utils/zip');

const OUTPUT_BASE = path.join(process.cwd(), 'output');

/**
 * Run full clone job
 */
async function runCloneJob(jobId, url, options, progressCallback) {
  const {
    css: includeCss = true,
    images: includeImages = true,
    fonts: includeFonts = true,
    content: includeContent = true,
    usePuppeteer = true
  } = options;

  const logger = new JobLogger(jobId);
  const outputDir = path.join(OUTPUT_BASE, jobId);
  fs.ensureDirSync(outputDir);

  const stats = { pages: 0, images: 0, fonts: 0, cssFiles: 1 };
  let imageMap = new Map();
  let fontMap = new Map();
  let consolidatedCss = '';

  const reportProgress = (step, progress) => {
    if (progressCallback) {
      progressCallback({
        status: 'in_progress',
        progress,
        currentStep: step,
        log: logger.getLogs(),
        stats: { ...stats }
      });
    }
  };

  try {
    logger.info(`Connecting to ${url}`);
    reportProgress('Starting crawl...', 5);

    // 1. Crawl entire site (Puppeteer by default for hero images/sliders)
    let { pages, baseUrl, sitemap } = await crawlSite(url, { logger, usePuppeteer: options.usePuppeteer });

    // Filter to HTML pages only (exclude RSS, XML, CSS files, etc.)
    pages = pages.filter(p => {
      const h = (p.html || '').trim().toLowerCase();
      return h.includes('<html') || h.includes('<!doctype') || (h.includes('<body') && h.includes('</body>'));
    });
    stats.pages = pages.length;

    if (pages.length === 0) {
      throw new Error('No pages could be fetched');
    }

    logger.info(`Crawled ${pages.length} HTML pages`);
    reportProgress('Extracting HTML...', 15);

    // 2. Extract HTML
    const htmlFiles = extractHtml(pages, outputDir);

    // 3. Extract CSS
    if (includeCss) {
      logger.info('Extracting CSS stylesheets...');
      reportProgress('Extracting CSS...', 25);
      try {
        const cssPath = path.join(outputDir, 'style.css');
        await extractCss(pages, baseUrl, cssPath);
        consolidatedCss = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
      } catch (e) {
        logger.error(`CSS extraction: ${e.message}`);
        consolidatedCss = '';
      }
    }

    // 4. Extract images
    if (includeImages) {
      logger.info('Downloading images...');
      reportProgress('Downloading images...', 40);
      try {
        const imagesDir = path.join(outputDir, 'assets', 'images');
        imageMap = await extractImages(pages, consolidatedCss, baseUrl, imagesDir, logger);
        stats.images = imageMap.size;
      } catch (e) {
        logger.error(`Image extraction: ${e.message}`);
      }
    }

    // 5. Extract fonts
    if (includeFonts) {
      logger.info('Downloading fonts...');
      reportProgress('Downloading fonts...', 55);
      try {
        const fontsDir = path.join(outputDir, 'assets', 'fonts');
        fontMap = await extractFonts(pages, consolidatedCss, baseUrl, fontsDir, logger);
        stats.fonts = fontMap.size;
      } catch (e) {
        logger.error(`Font extraction: ${e.message}`);
      }
    }

    // 5b. Extract JavaScript
    let scriptResult = { externalPaths: [], inlineScripts: [] };
    try {
      logger.info('Extracting JavaScript...');
      reportProgress('Extracting JavaScript...', 60);
      const jsDir = path.join(outputDir, 'assets', 'js');
      scriptResult = await extractScripts(pages, baseUrl, jsDir, logger);
    } catch (e) {
      logger.error(`Script extraction: ${e.message}`);
    }

    // 6. Rewrite URLs in HTML and CSS
    logger.info('Rewriting asset paths...');
    reportProgress('Rewriting paths...', 70);

    const heroFallbackCss = `
/* Carousel/slider fallback - ensure first slide visible even before JS loads */
.flexslider .slides > li:first-child, .slideshow .slides > li:first-child,
.slick-slider .slick-slide:first-child, .owl-carousel .owl-item:first-child,
.carousel .carousel-item:first-child, .swiper .swiper-slide:first-child,
[class*="slider"] .slides > li:first-child, [class*="carousel"] .slides > li:first-child,
[class*="slider"] .slide:first-child, [class*="carousel"] .slide:first-child { display: block !important; }
.flexslider .slides > li:not(:first-child), .slick-slider .slick-slide:not(:first-child),
.owl-carousel .owl-item:not(:first-child), .carousel .carousel-item:not(:first-child) { display: none; }
.flexslider img, .slideshow img, .slick-slide img, .owl-item img, .carousel-item img,
[class*="hero"] img, [class*="slider"] img, [class*="carousel"] img { max-width: 100%; height: auto; display: block; }
`;
    const rewrittenCss = rewriteCss(consolidatedCss + heroFallbackCss, imageMap, fontMap, baseUrl);
    if (includeCss) {
      fs.writeFileSync(path.join(outputDir, 'style.css'), rewrittenCss, 'utf8');
    }

    const urlToLocalPath = buildUrlToLocalPath(htmlFiles, baseUrl);
    const rewrittenPages = [];
    for (let i = 0; i < htmlFiles.length; i++) {
      const file = htmlFiles[i];
      const pageUrl = pages[i]?.url || baseUrl;
      let html = fs.readFileSync(file.path, 'utf8');
      html = rewriteHtml(html, imageMap, './style.css', urlToLocalPath, baseUrl, pageUrl);
      fs.writeFileSync(file.path, html, 'utf8');
      rewrittenPages.push({ ...pages[i], html });
    }

    // 7. Extract content
    if (includeContent) {
      logger.info('Extracting text content...');
      reportProgress('Extracting content...', 80);
      try {
        const content = extractContent(pages);
        saveContent(content, path.join(outputDir, 'content.json'));
      } catch (e) {
        logger.error(`Content extraction: ${e.message}`);
      }
    }

    // 8. Generate WordPress theme
    logger.info('Generating WordPress theme...');
    reportProgress('Generating WordPress theme...', 90);

    try {
      const domain = new URL(url).hostname.replace(/\./g, '-');
      const contentData = includeContent && fs.existsSync(path.join(outputDir, 'content.json'))
        ? JSON.parse(fs.readFileSync(path.join(outputDir, 'content.json'), 'utf8'))
        : null;
      generateWordPressTheme(outputDir, {
        domain,
        originalUrl: url,
        htmlPages: rewrittenPages.length ? rewrittenPages : pages,
        consolidatedCss: rewrittenCss,
        imageMap,
        fontMap,
        urlToLocalPath,
        contentData,
        scriptResult
      });
    } catch (e) {
      logger.error(`WordPress theme: ${e.message}`);
    }

    // 9. Create manifest
    const manifest = {
      jobId,
      url,
      completedAt: new Date().toISOString(),
      stats,
      sitemap
    };
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    logger.info('Clone complete!');
    reportProgress('Done!', 100);

    return {
      status: 'completed',
      outputDir,
      stats,
      manifest
    };
  } catch (err) {
    logger.error(`Clone failed: ${err.message}`);
    if (progressCallback) {
      progressCallback({
        status: 'error',
        progress: 0,
        currentStep: `Error: ${err.message}`,
        log: logger.getLogs(),
        stats
      });
    }
    throw err;
  }
}

/**
 * Create job and return ID
 */
function createJob() {
  return crypto.randomUUID().slice(0, 8);
}

module.exports = {
  runCloneJob,
  createJob,
  OUTPUT_BASE
};
