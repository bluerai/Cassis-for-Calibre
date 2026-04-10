'use strict'

import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs-extra';
import stringLength from 'string-length';

export const log_levels = ['error', 'warn', 'info', 'debug', 'silly'];

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const logdir = process.env.LOGDIR || "./dev_data/logs";
const consoleSilent = (process.env.LOG_TO_CONSOLE === "false") ? true : false;
const fileSilent = (process.env.LOG_TO_FILE === "true") ? false : true;

fs.ensureDirSync(logdir, (error, exists) => {
  if (error) {
    log.error(message);
    if (error.stack) logger.debug(error.stack);
    process.exit(1)
  }
})


/* const colorCodes = {
  error: '\x1b[31m',  //rot
  info: '\x1b[32m',   //green
  warn: '\x1b[33m',   //gelb
  debug: '\x1b[34m',  //blsu
  silly: '\x1b[35m',  //margenta
  cyan: '\x1b[36m',   //cyan
  white: '\x1b[37m'  //white
} */

const messageColorCodes = {
  info: '',
  debug: '',
  silly: '',
  warn: '\x1b[33m',   //gelb
  error: '\x1b[31m',  //rot
}

const resetCode = '\x1b[0m';

const removeColors = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

const consoleFormat = combine(
  colorize({
    level: true, message: false
  }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  printf((info) => {
    const message = messageColorCodes[removeColors(info.level)] + `${info.message}` + resetCode;
    return `[${info.timestamp}] ${info.level}${' '.repeat(6 - stringLength(info.level))}${message}`
  })
);

export const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  silent: consoleSilent,
});

const fileFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  json()
);

export const fileTransport = new winston.transports.DailyRotateFile({
  filename: `${logdir}/full_%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  lazy: true,
  silent: fileSilent,
  format: fileFormat,
});

export const logger = winston.createLogger({
  level: process.env.LOGLEVEL || 'info',
  transports: [
    consoleTransport,
    fileTransport
  ]
});

log_levels.forEach(level => {
  const original = logger[level].bind(logger);

  logger[level] = (...args) => {
    /* const message = util.format(...args); */
    const message = args.map(arg =>
      typeof arg === 'object'
        ? util.inspect(arg, { depth: null, colors: true })
        : arg
    ).join(' ');
    original(message);
  };
});

export function log(...args) { logger.info(...args); }
log.info = (...args) => logger.info(...args);
log.warn = (...args) => logger.warn(...args);
log.error = (...args) => logger.error(...args);
log.debug = (...args) => logger.debug(...args);
log.silly = (...args) => logger.silly(...args);
log.http = (...args) => logger.http(...args);

log.isLevelEnabled = (...args) => logger.isLevelEnabled(...args);

log(
  `Logging at level '${logger.level}'`,
  (consoleTransport.silent) ? "" : "to console",
  (!consoleTransport.silent && !fileTransport.silent) ? "and" : "",
  (fileTransport.silent) ? "" : "to file"
);
