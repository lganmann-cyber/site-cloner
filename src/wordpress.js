/**
 * WordPress theme generation - fully editable content via page importer
 */

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const { urlToSlug } = require('./extractors/html');

/**
 * Generate WordPress theme with editable content
 */
function generateWordPressTheme(outputDir, options = {}) {
  const {
    domain = 'cloned-site',
    originalUrl = '',
    htmlPages = [],
    consolidatedCss = '',
    imageMap = new Map(),
    fontMap = new Map(),
    urlToLocalPath = new Map(),
    contentData = null,
    scriptResult = null
  } = options;

  const themeDir = path.join(outputDir, 'wordpress-theme');
  const incDir = path.join(themeDir, 'inc');
  const assetsDir = path.join(themeDir, 'assets');
  const imagesDir = path.join(assetsDir, 'images');
  const fontsDir = path.join(assetsDir, 'fonts');
  const jsDir = path.join(assetsDir, 'js');

  fs.ensureDirSync(incDir);
  fs.ensureDirSync(imagesDir);
  fs.ensureDirSync(fontsDir);
  fs.ensureDirSync(jsDir);

  const srcImages = path.join(outputDir, 'assets', 'images');
  const srcFonts = path.join(outputDir, 'assets', 'fonts');
  const srcJs = path.join(outputDir, 'assets', 'js');
  if (fs.existsSync(srcImages)) fs.copySync(srcImages, imagesDir);
  if (fs.existsSync(srcFonts)) fs.copySync(srcFonts, fontsDir);
  if (fs.existsSync(srcJs)) fs.copySync(srcJs, jsDir);

  const wpCss = rewriteCssForWp(consolidatedCss, imageMap, fontMap);
  const styleCss = `/*
Theme Name: ${domain} Clone
Theme URI: ${originalUrl}
Description: Cloned from ${originalUrl} - All content editable in WordPress
Version: 1.0
Author: Site Cloner
*/

${wpCss}
`;
  fs.writeFileSync(path.join(themeDir, 'style.css'), styleCss, 'utf8');

  const baseOrigin = originalUrl ? new URL(originalUrl).origin : '';
  let firstHtml = htmlPages[0]?.html || '';
  firstHtml = rewriteLinksForWordPress(firstHtml, urlToLocalPath, baseOrigin);
  const $ = cheerio.load(firstHtml, { decodeEntities: false });
  const headContent = $('head').html() || '';
  const bodyContent = $('body').html() || '';

  let cleanHead = headContent
    .replace(/<meta charset[^>]*>/gi, '')
    .replace(/<meta name="viewport"[^>]*>/gi, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  fs.writeFileSync(path.join(incDir, 'head-content.html'), cleanHead, 'utf8');
  const headerPhp = `<?php
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <?php wp_head(); ?>
  <?php echo cloned_site_fix_asset_urls(file_get_contents(get_template_directory() . '/inc/head-content.html')); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
`;
  fs.writeFileSync(path.join(themeDir, 'header.php'), headerPhp, 'utf8');

  const footerPhp = `<?php
wp_footer();
?>
</body>
</html>
`;
  fs.writeFileSync(path.join(themeDir, 'footer.php'), footerPhp, 'utf8');

  const indexPhp = `<?php
/**
 * Main template - shows page content (editable in WP Admin > Pages)
 */
get_header();
if (have_posts()) {
  while (have_posts()) {
    the_post();
    the_content();
  }
} else {
  get_template_part('template-parts/content', 'none');
}
get_footer();
`;
  fs.writeFileSync(path.join(themeDir, 'index.php'), indexPhp, 'utf8');

  const frontPagePhp = `<?php
/**
 * Front page template - for static homepage
 */
get_header();
if (have_posts()) {
  while (have_posts()) {
    the_post();
    the_content();
  }
}
get_footer();
`;
  fs.writeFileSync(path.join(themeDir, 'front-page.php'), frontPagePhp, 'utf8');

  fs.ensureDirSync(path.join(themeDir, 'template-parts'));
  fs.writeFileSync(path.join(themeDir, 'template-parts/content-none.php'), `<?php
_e('No content found. Activate theme to import cloned pages, or add content in Pages.', 'cloned-theme');
`, 'utf8');

  const pagePhp = `<?php
/**
 * Default page template - displays editable content
 */
get_header();
if (have_posts()) {
  while (have_posts()) {
    the_post();
    the_content();
  }
}
get_footer();
`;
  fs.writeFileSync(path.join(themeDir, 'page.php'), pagePhp, 'utf8');

  const pagesForImport = [];
  for (let i = 0; i < htmlPages.length; i++) {
    const page = htmlPages[i];
    const slug = urlToSlug(page.url);
    let bodyHtml = page.html;
    bodyHtml = rewriteLinksForWordPress(bodyHtml, urlToLocalPath, baseOrigin);
    const $p = cheerio.load(bodyHtml, { decodeEntities: false });
    $p('script').remove();
    bodyHtml = $p('body').html() || '';
    // Keep full body - no stripping. Each page preserves exact structure (header, main, footer).

    pagesForImport.push({
      slug: slug === 'index' ? 'home' : slug,
      title: page.title || slug,
      content: bodyHtml
    });
  }

  fs.writeFileSync(path.join(incDir, 'cloned-pages.json'), JSON.stringify(pagesForImport, null, 2), 'utf8');

  if (contentData) {
    fs.writeFileSync(path.join(incDir, 'content.json'), JSON.stringify(contentData, null, 2), 'utf8');
  }

  const importerPhp = `<?php
/**
 * Imports cloned pages - runs on theme load (including Customizer preview)
 * Creates or UPDATES pages so content is always fresh
 */
define('CLONED_SITE_VERSION', '4.1');
function cloned_site_import_pages() {
  $option_key = 'cloned_site_imported_' . get_stylesheet() . '_' . CLONED_SITE_VERSION;
  if (get_option($option_key)) return;

  $json_file = get_template_directory() . '/inc/cloned-pages.json';
  if (!file_exists($json_file)) return;

  $pages = json_decode(file_get_contents($json_file), true);
  if (!is_array($pages) || empty($pages)) return;

  $author_id = get_current_user_id();
  if (!$author_id) $author_id = 1;

  $home_id = 0;
  foreach ($pages as $page_data) {
    $slug = sanitize_title($page_data['slug']);
    $existing = get_page_by_path($slug);
    $content = $page_data['content'] ?? '';

    if ($existing) {
      $home_id = ($slug === 'home') ? $existing->ID : $home_id;
      wp_update_post(array(
        'ID'           => $existing->ID,
        'post_content' => $content,
        'post_title'   => wp_strip_all_tags($page_data['title'] ?? $slug),
        'post_status'  => 'publish'
      ));
    } else {
      $post_id = wp_insert_post(array(
        'post_title'   => wp_strip_all_tags($page_data['title'] ?? $slug),
        'post_name'    => $slug,
        'post_content' => $content,
        'post_status'  => 'publish',
        'post_type'    => 'page',
        'post_author'  => $author_id,
        'menu_order'   => 0
      ));
      if ($slug === 'home' && $post_id && !is_wp_error($post_id)) {
        $home_id = $post_id;
      }
    }
  }

  if ($home_id) {
    update_option('page_on_front', $home_id);
    update_option('show_on_front', 'page');
  }

  update_option($option_key, true);
}
add_action('after_switch_theme', 'cloned_site_import_pages');
add_action('init', 'cloned_site_import_pages', 5);
`;
  fs.writeFileSync(path.join(incDir, 'importer.php'), importerPhp, 'utf8');

  const scriptPaths = scriptResult?.externalPaths || [];
  const inlineScripts = scriptResult?.inlineScripts || [];
  const scriptEnqueues = scriptPaths.map((p, i) => {
    const handle = `${domain}-script-${i}`;
    const uri = `get_template_directory_uri() . '/${p.replace(/^\.\//, '')}'`;
    return `  wp_enqueue_script('${handle}', ${uri}, array('jquery'), '1.0', true);`;
  }).join('\n');

  if (inlineScripts.length) {
    const inlineContent = inlineScripts.map(s => (s.content || '').trim()).filter(Boolean).join('\n\n');
    fs.writeFileSync(path.join(incDir, 'inline-scripts.js'), inlineContent, 'utf8');
  }
  const hasInlineScripts = inlineScripts.length > 0;

  const functionsPhp = `<?php
/**
 * Theme functions - pages auto-import on first load (including Customizer preview)
 */
require_once get_template_directory() . '/inc/importer.php';

function ${domain.replace(/[^a-zA-Z0-9]/g, '_')}_setup() {
  add_theme_support('title-tag');
  add_theme_support('post-thumbnails');
  add_theme_support('html5', array('search-form', 'comment-form', 'comment-list', 'gallery', 'caption'));
  add_theme_support('wp-block-styles');
  add_theme_support('align-wide');
}
add_action('after_setup_theme', '${domain.replace(/[^a-zA-Z0-9]/g, '_')}_setup');

// Prevent WordPress from modifying cloned HTML - wpautop breaks layout
remove_filter('the_content', 'wpautop');
remove_filter('the_content', 'wptexturize');

// Dequeue WordPress block styles that conflict with cloned layout
function ${domain.replace(/[^a-zA-Z0-9]/g, '_')}_dequeue_conflicts() {
  wp_dequeue_style('wp-block-library');
  wp_dequeue_style('wp-block-library-theme');
}
add_action('wp_enqueue_scripts', '${domain.replace(/[^a-zA-Z0-9]/g, '_')}_dequeue_conflicts', 100);

function ${domain.replace(/[^a-zA-Z0-9]/g, '_')}_scripts() {
  wp_enqueue_style('${domain}-style', get_stylesheet_uri(), array(), '1.0');
${scriptEnqueues}
}
add_action('wp_enqueue_scripts', '${domain.replace(/[^a-zA-Z0-9]/g, '_')}_scripts');
${hasInlineScripts ? `
function ${domain.replace(/[^a-zA-Z0-9]/g, '_')}_inline_scripts() {
  $js = file_get_contents(get_template_directory() . '/inc/inline-scripts.js');
  if ($js) echo '<script>' . $js . '</script>';
}
add_action('wp_footer', '${domain.replace(/[^a-zA-Z0-9]/g, '_')}_inline_scripts', 5);
` : ''}

function cloned_site_fix_asset_urls(\$content) {
  if (!\$content) return '';
  \$theme_uri = get_template_directory_uri();
  \$content = preg_replace('#https?://[^"\\'\\s]+/assets/(images|fonts|js)/#', \$theme_uri . '/assets/\$1/', \$content);
  \$content = preg_replace('#(\\./)?assets/(images|fonts|js)/#', \$theme_uri . '/assets/\$2/', \$content);
  return \$content;
}
function ${domain.replace(/[^a-zA-Z0-9]/g, '_')}_fix_asset_urls(\$content) {
  return cloned_site_fix_asset_urls(\$content);
}
add_filter('the_content', '${domain.replace(/[^a-zA-Z0-9]/g, '_')}_fix_asset_urls', 1);
`;
  fs.writeFileSync(path.join(themeDir, 'functions.php'), functionsPhp, 'utf8');

  return themeDir;
}

function escapeForPhpFile(str) {
  if (!str) return '';
  return str
    .replace(/<\?/g, '<?php echo "<"; ?>?')
    .replace(/\?>/g, '?<?php echo ">"; ?>');
}

function rewriteLinksForWordPress(html, urlToLocalPath, baseOrigin) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const hash = (href.match(/#.*$/) || [])[0] || '';
    const queryMatch = href.match(/\?[^#]*/);
    const query = queryMatch ? queryMatch[0] : '';
    let wpPath = null;
    if (href.startsWith('http')) {
      if (baseOrigin && href.startsWith(baseOrigin)) {
        try {
          const pathname = new URL(href).pathname.replace(/\/$/, '') || '';
          const slug = pathname.replace(/^\//, '').replace(/\//g, '-') || 'index';
          wpPath = slug === 'index' ? '/' : `/${slug}/`;
        } catch (_) {}
      }
    } else {
      const filename = href.replace(/^\.\//, '').split('?')[0].split('#')[0];
      if (filename.endsWith('.html') || filename === 'index' || filename === '') {
        const slug = filename.replace('.html', '') || 'index';
        wpPath = slug === 'index' ? '/' : `/${slug}/`;
      } else if (urlToLocalPath && baseOrigin) {
        try {
          const resolved = new URL(href, baseOrigin + '/').href;
          const localPath = urlToLocalPath.get(resolved) || urlToLocalPath.get(new URL(resolved).origin + new URL(resolved).pathname);
          if (localPath) {
            const slug = localPath.replace('.html', '') || 'home';
            wpPath = slug === 'index' || slug === 'home' ? '/' : `/${slug}/`;
          }
        } catch (_) {}
      }
    }
    if (wpPath) $(el).attr('href', wpPath + query + hash);
  });
  return $.html();
}

function rewriteCssForWp(css, imageMap, fontMap) {
  let result = css || '';
  result = result.replace(/\.\/assets\/images\//g, 'assets/images/');
  result = result.replace(/\.\/assets\/fonts\//g, 'assets/fonts/');
  return result;
}

module.exports = {
  generateWordPressTheme
};
