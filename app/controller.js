'use strict';

import fs from 'fs-extra';
import sharp from 'sharp';
import { join } from 'path';

import { createSignature, verifySignature } from '../auth/index.js'
import { logger, consoleTransport, fileTransport, errorLogger, log_levels } from '../log.js';

const packagejson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

import {
  findBooks, countBooks, findBooksWithTags, countBooksWithTags, findBooksWithCC, countBooksWithCC, findBooksBySerie, countBooksBySerie,
  findBooksByAuthor, countBooksByAuthor, getSeriesOfBooks, getAuthorsOfBooks, getFormatsOfBooks, getPublisherOfBooks, getTagsOfBooks, getBook,
  getCoverData, getFileData, getStatistics, connectDb, unconnectDb, getCustomColumnOfBooks, getTags, getCustomColumns, getTagsStatistics,
  getAuthorsStatistics, getSeriesStatistics, getPublishersStatistics
} from './model.js';

const appInfo = {
  "version": packagejson.name.toUpperCase() + ", Version " + packagejson.version,
  "author": packagejson.author + " (License " + packagejson.license + ")"
};

const CASSIS_BOOKS = process.env.CASSIS_BOOKS || process.env.HOME + "/Documents/Calibre"
const CASSIS_CACHE = process.env.CASSIS_CACHE || "./CACHE";
const PAGE_LIMIT = parseInt(process.env.PAGE_LIMIT) || 48;

// Bookdir einrichten:
logger.info("Calibre e-book directory found at " + CASSIS_BOOKS);
fs.existsSync(CASSIS_BOOKS, (error, exists) => {
  if (error) { errorLogger(error); process.exit(1) }
})

// Image-Cache einrichten:
logger.info("Cache for bookcovers found at " + CASSIS_CACHE);
fs.ensureDirSync(CASSIS_CACHE, (error, exists) => {
  if (error) { errorLogger(error); process.exit(1) }
})

// Base functions ***********************

function getPageNavigation(page, count) {
  if (count <= PAGE_LIMIT) return { size: count };

  const lastpage = Math.ceil(count / PAGE_LIMIT) - 1;  // Nummerierung beginnt mit 0
  if (page < 0) { page = 0 }
  else if (page > lastpage) { page = lastpage }

  return {
    size: count,
    currentpage: page,
    firstpage: (0 < page) ? "0" : null,
    prevpage: (page > 0) ? (page - 1) : null,
    nextpage: (page < lastpage) ? (page + 1) : null,
    lastpage: (page <= lastpage) ? lastpage : null
  }
}

function addFields(books) {

  if (books.length > 0) {
    const bookIdString = books.map((book) => book.bookId).toString();

    const authors = getAuthorsOfBooks(bookIdString);
    books.map((book) => {
      book.authors = authors.filter((author) => author.bookId == book.bookId).map((author) => {
        author.authorsName = decode(author.authorsName); return author
      });
    })

    const formats = getFormatsOfBooks(bookIdString);
    books.map((book) => {
      book.formats = formats.filter((format) => format.bookId == book.bookId).map((format) => decode(format.name));
    })

    const series = getSeriesOfBooks(bookIdString);
    books.map((book) => {
      let serie = series.find((serie) => serie.bookId == book.bookId);
      if (serie) { serie.seriesName = decode(serie.seriesName); book.serie = serie; }
    })

    const tags = getTagsOfBooks(bookIdString);
    books.map((book) => {
      book.tags = tags.filter((tag) => tag.bookId == book.bookId).map((tag) => decode(tag.tagName));
    })

    books.map((book) => { book.signature = createSignature(book.bookId, 1800); });

  }
  return (books);
}

// Actions **************************

export async function startAction(request, response) {
  logger.debug("*** startAction: request.params=" + JSON.stringify(request.params));
  logger.debug("*** startAction: request.query=" + JSON.stringify(request.query));
  try {
    const type = request.params.type;
    const id = request.params.id;
    response.render(join(import.meta.dirname, 'views', 'start'), { "type": type, "id": id, "signature": request.query.signature, "expires": request.query.expires });
  }
  catch (error) { errorHandler(error, response, 'startAction') }
}

export async function listAction(request, response) {
  try {
    const options = request.body;
    logger.debug("*** listAction: request.params=" + JSON.stringify(request.params));
    logger.debug("*** listAction: options=" + JSON.stringify(options));

    const page = (!options.page || isNaN(options.page)) ? 0 : parseInt(options.page, 10);
    const sortString = options.sortString || "";
    const type = options.type || request.params.type;

    let books = {};
    let count = 0;

    switch (type) {
      case "serie":
        const seriesId = parseInt(options.serieId, 10) || 0;
        count = countBooksBySerie(seriesId);
        if (count !== 0)
          books = findBooksBySerie(seriesId, sortString, PAGE_LIMIT, page * PAGE_LIMIT);
        break;

      case "author":
        const authorsId = parseInt(options.authorsId, 10) || 0;
        count = countBooksByAuthor(authorsId);
        if (count !== 0)
          books = findBooksByAuthor(authorsId, sortString, PAGE_LIMIT, page * PAGE_LIMIT);
        break;

      default:
        const tagId = parseInt(options.tagId, 10) || 0;
        const ccNum = parseInt(options.ccNum, 10) || 0;
        const ccId = parseInt(options.ccId, 10) || 0;

        if (tagId > 0) {
          logger.debug("listAction: tagId: " + tagId);
          count = countBooksWithTags(options.searchString, tagId);
          if (count !== 0) books = findBooksWithTags(options.searchString, sortString, tagId, PAGE_LIMIT, page * PAGE_LIMIT);
        } else if (ccNum > 0) {
          logger.debug("listAction: ccNum: " + ccNum + ", ccId: " + ccId);
          count = countBooksWithCC(ccNum, options.searchString, ccId);
          if (count !== 0) books = findBooksWithCC(ccNum, options.searchString, sortString, ccId, PAGE_LIMIT, page * PAGE_LIMIT);
        } else {
          count = countBooks(options.searchString);
          if (count !== 0) books = findBooks(options.searchString, sortString, PAGE_LIMIT, page * PAGE_LIMIT);
        }
        break;
    }

    response.locals.searchString = options.searchString || "";

    if (count <= 0 || books.length === 0) {
      const message = (count === 0) ? "Keine Bücher/Zeitschriften gefunden!" : "Fehler beim Zugriff auf die Datenbank!";
      response.send({ searchString: response.locals.searchString, "html": "<div id='main_message'>" + message + "</div>" });
      return;
    }

    books = addFields(books);
    const pageNav = getPageNavigation(page, count);

    logger.silly("listAction: books=" + JSON.stringify(books));
    logger.silly("listAction: pageNav=" + JSON.stringify(pageNav));

    response.render(join(import.meta.dirname, 'views', 'booklist'), { books, pageNav }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render booklist page');
      } else {
        response.send({ searchString: response.locals.searchString, html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'listAction') }
}

export async function bookAction(request, response) {
  try {
    const options = request.body;
    logger.debug("*** bookAction: options=" + JSON.stringify(options));

    const bookId = parseInt(options.bookId, 10);
    const book = getBook(bookId);
    //logger.debug("*** bookAction: book=" + JSON.stringify(book))

    const formats = getFormatsOfBooks(bookId);
    book.formats = formats.map((format) => decode(format.name));

    const authors = getAuthorsOfBooks(bookId);
    book.authors = authors.map((author) => {
      author.authorsName = decode(author.authorsName); return author
    });

    const publisher = getPublisherOfBooks(bookId);
    if (publisher) { publisher.name = decode(publisher.name); book.publisher = publisher }

    const tags = getTagsOfBooks(bookId);
    for (let t in tags) {
      tags[t].tagName = decode(tags[t].tagName);
      if (tags[t].colId) {
        tags[t].subTags = getCustomColumnOfBooks(tags[t].colId, bookId);
      };
    }
    book.tags = tags

    const series = getSeriesOfBooks(bookId);
    if (series[0]) { series[0].seriesName = decode(series[0].seriesName); book.serie = series[0] }
    if (book.pubdate.substr(0, 1) == "0") { book.pubdate = null };

    book.signature = createSignature(book.bookId, 1800);

    response.render(join(import.meta.dirname, 'views', 'book'), { book }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render book page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'bookAction') }
}

export async function tagsAction(request, response) {
  try {
    logger.debug("*** tagsAction: request.params=" + JSON.stringify(request.params));
    const selectedId = (!request.params.tagId || isNaN(request.params.tagId)) ? 0 : parseInt(request.params.tagId, 10);
    const tags =
      getTags()
        .map(tag => { tag.class = (tag.tagId === selectedId) ? "selected" : ""; return tag });

    const options = { tags };
    response.render(join(import.meta.dirname, 'views', 'stats'), { appInfo, options }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats page');
      } else {
        response.send({ html });
      }
    });
  } catch (error) { errorHandler(error, response, 'tagsAction') }
}

export async function ccAction(request, response) {
  try {
    logger.debug("*** ccAction: request.params=" + JSON.stringify(request.params));
    const ccNum = (!request.params.ccNum || isNaN(request.params.ccNum)) ? 0 : parseInt(request.params.ccNum, 10);
    const selectedId = (!request.params.ccId || isNaN(request.params.ccId)) ? 0 : parseInt(request.params.ccId, 10);

    const custCols =
      getCustomColumns(ccNum)
        .map(cc => { cc.class = (cc.id === selectedId) ? "selected" : ""; return cc });

    const options = { ccNum, custCols };
    response.render(join(import.meta.dirname, 'views', 'stats'), { appInfo, options }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats page');
      } else {
        response.send({ html });
      }
    });
  } catch (error) { errorHandler(error, response, 'ccAction') }
}

async function newer(file1_path, file2_path) {
  try {
    // Stat-Objekte beider Dateien abrufen (mit Fehlerbehandlung)
    const [stats1, stats2] = await Promise.all([
      fs.stat(file1_path),
      fs.stat(file2_path).catch(() => null) // Falls file2 nicht existiert
    ]);

    // Wenn file2 nicht existiert, ist file1 automatisch neuer
    if (!stats2) return true;

    // Vergleich der mtime-Werte (Modifikationszeit)
    return stats1.mtimeMs > stats2.mtimeMs;

  } catch (error) {
    if (error.code === 'ENOENT' && error.path === file1_path) {
      // Wenn file1 nicht existiert, kann es nicht neuer sein
      return false;
    }
    throw error; // Andere Fehler weiterwerfen
  }
}

async function sendResizedCover(response, source, targetDir, targetFile, resizeOptions) {
  try {
    const target = targetDir + "/" + targetFile;

    const isNewer = await newer(source, target);

    if (isNewer) {
      await sharp(source)
        .resize(resizeOptions)
        .toFile(target);
    }
    const options = { root: targetDir, headers: { 'Content-Type': 'image/jpeg' } }
    response.sendFile(targetFile, options);
  } catch (error) { errorHandler(error, response, 'sendResizedCover') }
}


export async function coverListAction(request, response) {
  try {
    if (verifySignature(request)) {
      let fileData = getCoverData(parseInt(request.params.id, 10));
      if (fileData) {
        const source = CASSIS_BOOKS + "/" + fileData.path + "/cover.jpg";
        const targetDir = CASSIS_CACHE + "/1" + ("0000" + fileData.bookId).slice(-5).substring(0, 2);
        fs.ensureDirSync(targetDir);
        sendResizedCover(response, source, targetDir, fileData.bookId + ".jpg", { height: 250 });
      }
    } else {
      response.sendFile("Not authorized");
    }
  } catch (error) { errorHandler(error, response, 'coverListAction') }
}

export async function coverBookAction(request, response) {
  try {
    if (verifySignature(request)) {
      let fileData = getCoverData(parseInt(request.params.id, 10));
      logger.debug("*** coverBookAction: fileData=" + JSON.stringify(fileData));
      const source = CASSIS_BOOKS + "/" + fileData.path + "/cover.jpg";
      const targetDir = CASSIS_CACHE + "/0" + ("0000" + fileData.bookId).slice(-5).substring(0, 2);
      fs.ensureDirSync(targetDir);
      sendResizedCover(response, source, targetDir, fileData.bookId + ".jpg", { width: 320 });
    }
    else {
      response.send("Not authorized");
    }
  } catch (error) { errorHandler(error, response, 'coverBookAction') }
}

export async function fileAction(request, response) {
  try {
    if (verifySignature(request)) {
      let fileData = getFileData(parseInt(request.params.id, 10), request.params.format);
      logger.debug("*** fileAction: fileData=" + JSON.stringify(fileData));
      const options = {
        root: CASSIS_BOOKS + "/" + fileData.path,
        dotfiles: 'deny',
        headers: {
          'x-timestamp': Date.now(),
          'x-sent': true
        }
      }
      response.sendFile(fileData.filename, options, function (error) {
        if (error) {
          errorHandler(error, null, 'response.sendFile');
        } else
          logger.debug('response.sendFile: filename=' + fileData.filename);
      })
    } else {
      response.send("Not authorized");
    }
  } catch (error) { errorHandler(error, 'fileAction') }
}

export async function bookLinkAction(request, response) {
  logger.debug("bookLinkAction: " + JSON.stringify(request.body))

  const { to, authors, title, bookId, tagName, protocol, cc, bcc } = request.body;
  const sign = createSignature(bookId, 3600 * 72);

  const subject = '"' + title + ((tagName === 'Zeitschrift') ? '"' : '" von ' + authors);
  const bookLink = protocol + "/app/book/" + bookId + sign;
  const coverLink = protocol + "/app/cover/book/" + bookId + sign;

  const body = '...mit besten Empfehlungen aus der Cassis-Bibliothek: \n\n'
    + subject + '\n\n' + bookLink + '\n\n' + coverLink + '\n\n'
    + 'Der Link zum Herunterladen ist 3 Tage gültig.';

  let mailtoLink = 'mailto:';

  if (to) {
    mailtoLink += encodeURIComponent(to);
  }

  const params = [];

  if (cc) {
    params.push(`cc=${encodeURIComponent(cc)}`);
  }

  if (bcc) {
    params.push(`bcc=${encodeURIComponent(bcc)}`);
  }

  if (subject) {
    params.push(`subject=${encodeURIComponent(subject)}`);
  }

  if (body) {
    params.push(`body=${encodeURIComponent(body)}`);
  }

  if (params.length > 0) {
    mailtoLink += '?' + params.join('&');
  }

  logger.silly(mailtoLink);

  response.send({ content: mailtoLink });
}


export async function settingsAction(request, response) {
  try {
    const options = { logger: { level: logger.level, levels: log_levels, consoleOn: !consoleTransport.silent, fileOn: !fileTransport.silent } };
    logger.debug("*** settingsAction: appInfo=" + JSON.stringify(appInfo) + ", " + "options=" + JSON.stringify(options));
    response.render(join(import.meta.dirname, 'views', 'settings'), { appInfo, options }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render settings page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'settingsAction') }
}


export async function statsAction(request, response) {
  try {
    const stats = getStatistics();
    const options = { stats };
    logger.debug("*** statsAction: options=" + JSON.stringify(options));
    response.render(join(import.meta.dirname, 'views', 'stats'), { appInfo, options }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'statsAction') }
}
export async function tagsCountAction(request, response) {
  try {
    logger.debug("*** tagsCountAction");
    const popup = { "type": "tag", "head_name": "Genres", "head_count": "Medien", "content": getTagsStatistics() };
    response.render(join(import.meta.dirname, 'views', 'stats_popup'), { popup }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats_popup page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'tagsCountAction') }
}


export async function authorsCountAction(request, response) {
  try {
    logger.debug("*** authorsCountAction");
    const popup = { "type": "author", "head_name": "Autoren", "head_count": "Bücher", "content": getAuthorsStatistics() };
    response.render(join(import.meta.dirname, 'views', 'stats_popup'), { popup }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats_popup page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'tagsCountAction') }
}

export async function seriesCountAction(request, response) {
  try {
    logger.debug("*** seriesCountAction");
    const popup = { "type": "serie", "head_name": "Serie", "head_count": "Bücher", "content": getSeriesStatistics() };
    response.render(join(import.meta.dirname, 'views', 'stats_popup'), { popup }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats_popup page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'tagsCountAction') }
}

export async function publishersCountAction(request, response) {
  try {
    logger.debug("*** publishersCountAction");
    const popup = { "type": "publisher", "head_name": "Verlag", "head_count": "Medien", "content": getPublishersStatistics() };
    response.render(join(import.meta.dirname, 'views', 'stats_popup'), { popup }, function (error, html) {
      if (error) {
        errorHandler(error, response, 'render stats_popup page');
      } else {
        response.send({ html });
      }
    });
  }
  catch (error) { errorHandler(error, response, 'tagsCountAction') }
}

export async function logAction(request, response) {
  try {
    logger.info("*** logAction: request.params=" + JSON.stringify(request.params));
    const key = request.params.key;
    switch (key) {
      case 'level':
        const level = request.params.value;
        if (log_levels.indexOf(level) && logger.level !== level) logger.level = level;
        response.send({ level: logger.level });
        break;
      case 'con':
        consoleTransport.silent = (request.params.value === "1") ? false : true;
        response.send({ consoleOn: !consoleTransport.silent });
        break;
      case 'fil':
        fileTransport.silent = (request.params.value === "1") ? false : true;
        response.send({ fileOn: !fileTransport.silent });
        break;
    }
    logger.debug("Logging level: " + logger.level + ", logging to console: " + !consoleTransport.silent + ", logging to file: " + !fileTransport.silent);
  }
  catch (error) { errorHandler(error, response, 'logLevelAction') }
}

// Helper functions ***********************

function decode(str) {
  return (str) ? str.toString().replaceAll('|', ',') : "";
}

// Actions end =============

function errorHandler(error, response, actionName) {
  const message = "CASSIS: Fehler in '" + actionName + "': " + error.message;
  errorLogger(error, message);
  if (response) { // 500 Internal Server Error
    response.status(500).json({ message: message });
  }
}
