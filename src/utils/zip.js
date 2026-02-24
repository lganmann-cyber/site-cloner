/**
 * ZIP archive creation for download packages
 */

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

/**
 * Create a ZIP archive from a directory
 * @param {string} sourceDir - Directory to zip
 * @param {string} outputPath - Path for the output ZIP file
 * @param {object} options - { stripLevel: number } to strip directory levels
 * @returns {Promise<string>} Path to created ZIP
 */
function createZipFromDir(sourceDir, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(outputPath));
    archive.on('error', reject);

    archive.pipe(output);

    const stripLevel = options.stripLevel || 0;
    archive.directory(sourceDir, stripLevel > 0 ? false : '.', (entry) => {
      if (stripLevel > 0 && entry.name) {
        const parts = entry.name.split('/');
        if (parts.length > stripLevel) {
          entry.name = parts.slice(stripLevel).join('/');
        }
      }
      return entry;
    });

    archive.finalize();
  });
}

/**
 * Create ZIP with specific files/folders
 * @param {Array<{path: string, name: string}>} items - Items to include
 * @param {string} outputPath - Output ZIP path
 */
function createZipFromItems(items, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(outputPath));
    archive.on('error', reject);

    archive.pipe(output);

    for (const item of items) {
      const stat = fs.statSync(item.path);
      if (stat.isDirectory()) {
        archive.directory(item.path, item.name || path.basename(item.path));
      } else {
        archive.file(item.path, { name: item.name || path.basename(item.path) });
      }
    }

    archive.finalize();
  });
}

module.exports = {
  createZipFromDir,
  createZipFromItems
};
