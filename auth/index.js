'use strict'

import jwt from 'jsonwebtoken';
import fs from 'fs-extra';
import argon2 from 'argon2';
import crypto from 'crypto';
import { join } from 'path';
import { log } from '../log.js';

const CASSIS_CONFIG = process.env.CASSIS_CONFIG || "../config";

fs.ensureDirSync(CASSIS_CONFIG, (error, exists) => {
  if (error) {
    log.error(message);
    if (error.stack) log.debug(error.stack);
    process.exit(1)
  }
})

export let JWT = {};
const authfile = join(CASSIS_CONFIG, "jwt.json");
try {
  if (fs.existsSync(authfile)) {
    JWT = fs.readJsonSync(authfile)
    log("Authorisation by jwt token");
  } else {
    JWT.key = generateSecureRandomString(32);
    JWT.duration = "30d";
    fs.writeJsonSync(authfile, JWT);
    log.warn("Authorisation by jwt token: New jwt key generated!" + authfile);
  }
} catch (error) {
  console.error(error);
  log.warn("No authorisation installed!");
}

export const JWT_KEY = JWT.key;
export const JWT_DURATION = JWT.duration;

const USERSFILE = join(CASSIS_CONFIG, "users.json");

//==== Actions ==================================================

export function verifyAction(req, res) {

  const token = req.headers.authorization?.split(' ')[1]

  if (!token || token === "null") {
    if (verifySignature(req)) {
      log.debug("/verify: signature is valid");
      return res.status(200).json({ message: 'Signature is valid' });
    };
    return res.render(join(import.meta.dirname, 'views', 'login'), { first_login: (!fs.existsSync(USERSFILE)) }, function (error, html) {
      if (error) { log.error(error); log.debug(error.stack); return }
      log.debug("/verify: No token");
      res.status(401).json({ error: 'No token', html: html });
    })
  }

  jwt.verify(token, JWT_KEY, (err, decoded) => {
    if (err) {
      res.render(join(import.meta.dirname, 'views', 'login'), { first_login: (!fs.existsSync(USERSFILE)) }, function (error, html) {
        if (error) { log.error(error); log.debug(error.stack); return }
        log.debug("/verify: Invalid token");
        res.status(401).json({ error: 'Invalid token', html: html });
      })

    } else {
      log.debug("/verify: " + decoded.username + ", expire at: " + new Date(decoded.exp * 1000).toLocaleString());
      res.status(200).json({ message: 'Token is valid', user: decoded });
    }
  })
};

export function loginAction(req, res) {
  try {

    const { username, password } = req.body;

    if (!username || username.length < 3 || !password || password.length < 12) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    let users = {};
    try {
      if (fs.existsSync(USERSFILE)) {
        users = fs.readJsonSync(USERSFILE);
      } else {
        log.warn("loginAction: No users file");
        users[username] = password;
        fs.writeJsonSync(USERSFILE, users);
        log(`User ${username}: Password saved`);
      }
    } catch (error) {
      log.error(error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!users[username]) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (users[username].startsWith("$argon2id$")) {  //bereits gehasht
      argon2.verify(users[username], username + ":" + password)
        .then(match => {
          if (match) {
            const token = jwt.sign({ username }, JWT_KEY, { expiresIn: JWT_DURATION });
            res.status(200).json({ token: token });
          } else {
            res.status(401).json({ error: 'Invalid credentials' });
          }
        })
    } else { //erstmalige Benutzung - wird geprüft und gehasht
      if (password === users[username]) {
        const token = jwt.sign({ username }, JWT_KEY, { expiresIn: JWT_DURATION });
        savePasswordAsHash(username, password, users);
        return res.status(200).json({ token: token, username: username, expiresIn: JWT_DURATION });
      }
    }

  } catch (err) {
    console.error(err);
    log.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
};

function savePasswordAsHash(username, password, users) {
  argon2.hash(username + ":" + password)
    .then(hash => {
      users[username] = hash;
      fs.writeJsonSync(USERSFILE, users);
      log(`User ${username}: Password hashed`);
      return true;
    })
}


export function protect(request, response, next) {
  //log.debug("protect: ", request.path);
  //request.ip, request.connection.remoteAddress);

  if ((request.path.startsWith('/cover/')) ||
    (request.path.startsWith('/file/')) ||
    (request.path.startsWith('/search/')) ||
    request.path === '/' ||
    (verifySignature(request))) {
    return next();
  }
  const token = request.headers.authorization?.split(' ')[1];
  log.debug("protect: path=" + request.path + "; token=" + token);

  if (!token) {
    log("protect: No Token !!!");
    return response.status(401).json({ error: 'No Authorisation' });
  }

  jwt.verify(token, JWT_KEY, (err, decoded) => {
    if (err) {
      log("protect: No Authorisation!");
      response.status(401).json({ error: 'No Authorisation' });

    } else {
      log.debug("protect: Authorisation ok! - " + decoded.username + ", expires at: " + new Date(decoded.exp * 1000).toLocaleString());
      request.userId = decoded.username;
      next();
    }
  })
}

// Funktion zum Erstellen einer Signature
export function createSignature(identifier, expiresIn) {
  const expiration = Date.now() + expiresIn * 1000; // Gültigkeitsdauer in Millisekunden

  const signature = crypto
    .createHmac('sha256', JWT_KEY)
    .update(`${identifier}:${expiration}`)
    .digest('hex');

  return `?expires=${expiration}&signature=${signature}`;
};

function isValidDate(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

// Funktion zum Überprüfen einer Signature
export function verifySignature(req) {
  try {
    const { expires, signature } = req.query;

    if (!expires || expires === 'undefined' || !signature || signature === 'undefined') { return false; }
    const expDate = new Date(Math.round((expires / 1000) * 1000));
    if (!isValidDate(expDate)) { return false; }

    const identifier = parseInt(req.path.split('/').pop(), 10);
    if (identifier.isNaN) { return false; }

    const expectedSignature = crypto
      .createHmac('sha256', JWT_KEY)
      .update(`${identifier}:${expires}`)
      .digest('hex');

    //log.debug("verifySignature: Book " + identifier + " expires at: " + expDate.toLocaleString());
    return signature === expectedSignature && Date.now() < parseInt(expires, 10);
  } catch (error) {
    log.error("verifySignature: " + error);
    return false;
  }
};

function generateSecureRandomString(length = 32) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  let result = '';
  randomValues.forEach(value => {
    result += characters.charAt(value % charactersLength);
  });

  return result;
}
