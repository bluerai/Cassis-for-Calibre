'use strict'

import express from 'express';
import https from 'https';
import morgan from 'morgan';
import os from 'os';
import fs from 'fs-extra';
import { join } from 'path';

import { verifyAction, loginAction, protect } from './auth/index.js';
import { appRouter } from './app/index.js';
import { apiRouter } from './api/index.js';
import { logger, log} from './log.js';

const app = express();
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 80;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT) || 443;

app.set('view engine', 'pug');

app.use(express.static(import.meta.dirname + '/public'));

app.use(express.urlencoded({ extended: false }));

app.use(express.json());

app.use(morgan('short', {
  stream: {
    write: (message) => {
      (!message.includes(' /app/cover/')) && log(message.trim())
    }
  }
}));

app.get('/verify', verifyAction);

app.post('/login', loginAction);

app.use('/api', apiRouter);

app.use('/app', protect, appRouter);

app.get('/', (request, response) => response.redirect('/app'));

if (HTTPS_PORT >= 0) {
  const keyfile = join(process.env.CASSIS_CONFIG, process.env.CASSIS_KEYFILE);
  const certfile = join(process.env.CASSIS_CONFIG, process.env.CASSIS_CERTFILE);
  if (fs.existsSync(keyfile) && fs.existsSync(certfile)) {

    //key + Cert vorhanden, also https, 
    const options = {
      key: fs.readFileSync(keyfile),
      cert: fs.readFileSync(certfile),
    };
    https.createServer(options, app).listen(HTTPS_PORT, () => {
      logger.info(`Https-Server is listening to https://${getLocalIp()}:${HTTPS_PORT}`)
    });
  }
}

if (HTTP_PORT >= 0) {
  app.listen(HTTP_PORT, () => {
    logger.info(`Http-Server is listening to http://${getLocalIp()}:${HTTP_PORT}`)
  })
}

//==== Helper ================================================================

const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback auf localhost
};
/* 
function lanOnly(req, res, next) {
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (isPrivateIP(clientIP)) {
    logger.debug(`lanOnly: LAN access from: ${req.protocol}://${clientIP}`);
    return next();
  } else {
    logger.warn(`lanOnly: WAN access from ip ${req.protocol}://${clientIP} blocked`);
    return res.status(403).json({ message: "No access." });
  }
};

export const isPrivateIP = (ip) => {
  if (!ip) return false;

  // IPv4 private Netzwerke
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1]))/.test(ip)) {
    return true;
  }

  // IPv6 private Netzwerke
  if (/^(::1|fc00:|fd00:|fe80:)/.test(ip)) {
    return true;
  }

  // IPv4-Mapped IPv6 (::ffff:192.168.x.x)
  if (ip.startsWith("::ffff:")) {
    const ipv4Part = ip.split(":").pop();
    return isPrivateIP(ipv4Part);
  }

  return false;
}; */