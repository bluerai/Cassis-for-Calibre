'use strict'

import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs-extra';

export const log_levels = ['error', 'warn', 'info', 'debug', 'silly'];

const { combine, timestamp, printf, colorize } = winston.format;

const logdir = process.env.LOGDIR || "./dev_data/logs";
const consoleSilent = (process.env.LOG_TO_CONSOLE === "false") ? true : false;
const fileSilent = (process.env.LOG_TO_FILE === "true") ? false : true;

fs.ensureDirSync(logdir, (error, exists) => {
  if (error) {
    logger.error(message);
    if (error.stack) logger.debug(error.stack);
    process.exit(1)
  }
})

export const consoleTransport = new winston.transports.Console({
  format: colorize({ all: true }),
  silent: consoleSilent,
});

export const fileTransport = new winston.transports.DailyRotateFile({
  filename: logdir + '/full_%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  lazy: true,
  silent: fileSilent,
});

export const logger = winston.createLogger({
  level: process.env.LOGLEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  transports: [
    consoleTransport,
    fileTransport
  ],
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

logger.info(
  `Logging at level '${logger.level}'`,
  (consoleTransport.silent) ? "" : "to console",
  (!consoleTransport.silent && !fileTransport.silent) ? "and" : "",
  (fileTransport.silent) ? "" : "to file"
);