# Site Cloner

Clone any website completely—HTML, CSS, images, fonts, content—and package it for WordPress.

## Quick Start

```bash
npm install
npm start
```

Opens at **http://localhost:3000**

**Default is HTTP-only** (no Chrome, no EPIPE). For JS-rendered sites:
```bash
npm run start:puppeteer
```

## Usage

1. Enter any website URL
2. Select what to extract (CSS, Images, Fonts, Content)
3. Click **Clone Entire Website**
4. Watch real-time progress
5. Download **WordPress Theme** or **All Files**

## WordPress Installation

1. Download the WordPress Theme ZIP
2. In WordPress: **Appearance → Themes → Add New → Upload Theme**
3. Upload the ZIP and activate

## API

- `POST /api/clone` — Start clone job (returns `jobId`)
- `GET /api/status/:jobId` — Poll progress
- `GET /api/download/:jobId/wordpress` — Download WP theme ZIP
- `GET /api/download/:jobId/all` — Download full clone ZIP

## Project Structure

```
site-cloner/
├── index.html          # Frontend dashboard
├── server.js           # Express API server
├── package.json
└── src/
    ├── cloner.js       # Main orchestration
    ├── crawler.js      # Multi-page crawling (Puppeteer)
    ├── fetcher.js      # HTTP with retry
    ├── extractors/     # HTML, CSS, images, fonts, content
    ├── rewriter.js     # URL path rewriting
    ├── wordpress.js    # WP theme generation
    └── utils/          # Logger, ZIP
```
