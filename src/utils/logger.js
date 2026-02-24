/**
 * Logger utility for cloning jobs
 * Provides structured logging that can be consumed by the status API
 */

class JobLogger {
  constructor(jobId) {
    this.jobId = jobId;
    this.logs = [];
    this.maxLogs = 200;
  }

  info(message) {
    this.add(message, 'info');
  }

  success(message) {
    this.add(message, 'success');
  }

  error(message) {
    this.add(message, 'error');
  }

  add(message, type = 'info') {
    const entry = {
      message: String(message),
      type: type,
      timestamp: new Date().toISOString()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    return entry;
  }

  getLogs() {
    return this.logs.map(l => l.message);
  }

  getLastMessage() {
    return this.logs.length > 0 ? this.logs[this.logs.length - 1].message : '';
  }

  clear() {
    this.logs = [];
  }
}

module.exports = { JobLogger };
