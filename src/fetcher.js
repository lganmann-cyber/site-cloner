/**
 * HTTP fetcher with retry logic and timeout
 */

const axios = require('axios');
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Create axios instance with retry and timeout
 */
function createFetcher(options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const maxRetries = options.maxRetries || MAX_RETRIES;
  const validateStatus = options.validateStatus || (status => status < 500);

  const instance = axios.create({
    timeout,
    maxRedirects: 5,
    validateStatus,
    httpsAgent: new https.Agent({
      rejectUnauthorized: options.rejectUnauthorized !== false
    }),
    httpAgent: new http.Agent({ keepAlive: false }),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    responseType: options.responseType || 'text'
  });

  instance.interceptors.response.use(
    response => response,
    async error => {
      const config = error.config;
      if (!config || !config.__retryCount) config.__retryCount = 0;

      const code = error.code || error.errno || (error.cause && error.cause.code);
      const isRetryable = ['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH'].includes(code) ||
        (error.response && error.response.status >= 500) ||
        /ECONNREFUSED|EPIPE|ECONNRESET/.test(String(error.message));

      if (config.__retryCount < maxRetries && isRetryable) {
        config.__retryCount++;
        await new Promise(r => setTimeout(r, RETRY_DELAY * config.__retryCount));
        return instance(config);
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

/**
 * Fetch URL with retries
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<{data: any, status: number, headers: object}>}
 */
async function fetchUrl(url, options = {}) {
  const fetcher = createFetcher({
    timeout: options.timeout || DEFAULT_TIMEOUT,
    responseType: options.responseType || 'text',
    rejectUnauthorized: options.rejectUnauthorized !== false
  });

  const response = await fetcher.get(url, {
    responseType: options.responseType || 'text',
    headers: options.headers || {}
  });

  return {
    data: response.data,
    status: response.status,
    headers: response.headers
  };
}

/**
 * Fetch URL and return buffer (for binary assets)
 */
async function fetchBuffer(url, options = {}) {
  const result = await fetchUrl(url, {
    ...options,
    responseType: 'arraybuffer'
  });
  return Buffer.from(result.data);
}

module.exports = {
  createFetcher,
  fetchUrl,
  fetchBuffer,
  DEFAULT_TIMEOUT
};
