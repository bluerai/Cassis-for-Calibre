'use strict';

import Database from 'better-sqlite3';
import fs from 'fs-extra';
import { logger, errorLogger } from '../log.js';

const CASSIS_METADATA = process.env.CASSIS_METADATA || process.env.HOME + "/Documents/Calibre/metadata.db"

if (!fs.existsSync(CASSIS_METADATA)) {
  logger.error("Calibre-Datenbank nicht gefunden im Pfad: " + CASSIS_METADATA);
  process.exit(1);
}

let METADATA_DB;
let COVERDATA_STMT;

function initDb() {
  if (!METADATA_DB) {
    METADATA_DB = new Database(CASSIS_METADATA, { readonly: true });
    logger.info("Connected to Calibre Database at " + CASSIS_METADATA);
  }
}

// SQL 
const bookColumns = ' b.id as bookId, b.title, b.sort, b.timestamp, b.pubdate, b.timestamp, b.series_index as seriesIndex, b.path ';

const queryBook = `
SELECT ` + bookColumns + `, (SELECT c.text FROM comments c WHERE c.book = b.id LIMIT 1) AS comment
FROM books b
WHERE b.id = ?`;

function queryAuthorsOfBooks(bookIdString) {
  return `
SELECT bsl.book AS bookId, a.name AS authorsName, a.id AS authorsId
FROM books_authors_link bsl
JOIN authors a ON bsl.author = a.id
WHERE bsl.book IN (` + bookIdString + `);`;
};

function querySeriesOfBooks(bookIdString) {
  return `
SELECT b.id AS bookId, s.id AS seriesId, s.name AS seriesName
FROM books b
JOIN books_series_link bsl ON b.id = bsl.book
JOIN series s ON bsl.series = s.id
WHERE b.id IN (` + bookIdString + `)`;
};

function queryPublisherOfBook(bookIdString) {
  return `
SELECT p.id, p.name
FROM publishers p
JOIN books_publishers_link bpl ON p.id = bpl.publisher
WHERE bpl.book IN (` + bookIdString + `);
`;
}

function queryTagsOfBook(bookIdString) {
  return `
SELECT b.id AS bookId, t.name AS tagName, cc.id AS colId
FROM books b
JOIN books_tags_link btl ON b.id = btl.book
JOIN tags t ON btl.tag = t.id
LEFT JOIN custom_columns cc ON cc.name = t.name
WHERE b.id IN (` + bookIdString + `)`;
}

function queryFormatsOfBooks(bookIdString) {
  return `
SELECT b.id AS bookId, LOWER(d.format) AS name
FROM books b
JOIN data d ON d.book = b.id
WHERE b.id IN (` + bookIdString + `);`
};

const queryCustomColumnsIds = 'select id as colId, label, name from custom_columns';

function queryCustomColumns(colId) {
  return 'SELECT id, value FROM custom_column_' + colId;
}

function queryCustomColumnsOfBooks(colId, bookIdString) {
  return `
SELECT b.id AS bookId, cc.value
FROM books b
JOIN books_custom_column_` + colId + `_link bccl ON b.id = bccl.book
JOIN custom_column_` + colId + ` cc ON cc.id = bccl.value
WHERE b.id IN(` + bookIdString + `)`;
}

const queryCoverData = `
SELECT b.id AS bookId, b.path, 'cover.jpg' AS filename
FROM books b
JOIN data d ON b.id = d.book
WHERE b.id = ?;`

const queryFileData = `
SELECT b.path, d.name || '.' || LOWER(d.format) AS filename
FROM books b
JOIN data d ON b.id = d.book
WHERE b.id = ? AND d.format = ?;`

const queryTags = 'SELECT id AS tagId, name AS tagName FROM tags';

const queryCounts = `
SELECT
    (SELECT COUNT(*) FROM books) AS books,
    (SELECT COUNT(*) FROM series) AS series,
    (SELECT COUNT(*) FROM authors) AS authors,
    (SELECT COUNT(*) FROM publishers) AS publishers,
    (SELECT COUNT(*) FROM tags) AS tags;`

const queryTagsCounts = `
SELECT
  ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT btl.book) DESC, t.name ASC) AS num,
  t.id, t.name, 
  COUNT(DISTINCT btl.book) AS count
FROM books_tags_link btl
JOIN tags t ON btl.tag = t.id
GROUP BY t.name
ORDER BY count DESC`;

const queryAuthorsCounts = `
SELECT
    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT bal.book) DESC, a.name ASC) AS num,
    a.id, a.name,
    COUNT(DISTINCT bal.book) AS count
FROM books_authors_link bal
JOIN authors a ON bal.author = a.id
WHERE NOT (a.name like '%20%')
GROUP BY a.id, a.name
ORDER BY count DESC
LIMIT 100;` //Hack: Authors without year in name (= without ePapers and eMagazines)

const querySeriesCounts = `
SELECT
    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT bsl.book) DESC) AS num,
    s.id, s.name,
    COUNT(DISTINCT bsl.book) AS count
FROM books_series_link bsl
JOIN series s ON bsl.series = s.id
WHERE NOT (s.name like '%20%')
GROUP BY s.name
ORDER BY count DESC
LIMIT 100;` //Hack: Series without year in name (= without ePapers and eMagazines)

const queryPublisherCounts = `
SELECT
    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT bpl.book) DESC) AS num,
    p.id, p.name,
    COUNT(DISTINCT bpl.book) AS count
FROM books_publishers_link bpl
JOIN publishers p ON bpl.publisher = p.id
GROUP BY p.name
ORDER BY count DESC
LIMIT 100;`
const whitespace_chars = /[\/\,\.\|\ \*\?\!\:\;\(\)\[\]\&\"\+\-\_\%]+/g;  // ohne _ und %
//whitespace_char01: In der Onleihe Zeichen zur Abtrennung des Artikels am Anfang von Titeln (für die Sortierung):
const whitespace_char01 = String.fromCharCode(172);

function searchStringToArray(searchString) {
  if (!searchString) return null;
  return (searchString.trim()
    .replaceAll(whitespace_char01, " ")
    .replaceAll(whitespace_chars, " ")
    .replaceAll("'", "''").split(" ")
    .sort((a, b) => { return b.length - a.length }));
}

function searchClause(searchString) {
  const searchArray = searchStringToArray(searchString);
  logger.silly("searchClause: searchString=" + searchString + ", searchArray=" + searchArray);

  if (searchArray && searchArray.length > 0) {
    let clause = "";
    searchArray.forEach(element => { clause += " and search like '%" + element + "%'"; });
    return " where " + clause.substring(4);
  }
  return "";
}

const sortArray = [];
sortArray["timestamp.asc"] = "ORDER BY b.timestamp ASC";
sortArray["timestamp.desc"] = "ORDER BY  b.timestamp DESC";
sortArray["author.asc"] = "ORDER BY b.author_sort ASC, b.sort ASC";
sortArray["author.desc"] = "ORDER BY b.author_sort DESC, b.sort DESC";
sortArray["title.asc"] = "ORDER BY b.sort ASC";
sortArray["title.desc"] = "ORDER BY b.sort DESC";
sortArray["serie.asc"] = "ORDER BY b.series_index ASC";
sortArray["serie.desc"] = "ORDER BY b.series_index DESC";

function findBooksQuery(searchString, sortString) {
  return `
 WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.sort
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
)
SELECT ROW_NUMBER() OVER (ORDER BY b.timestamp DESC) AS num,
       b.id AS bookId,
       b.title,
       b.sort,
       b.timestamp,
       b.pubdate,
       b.series_index AS seriesIndex,
       b.path,
       (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' || 
       COALESCE(s.sort, '') || ' ' || SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search
FROM books b
LEFT JOIN AuthorNames a ON b.id = a.bookId
LEFT JOIN SeriesInfo  s ON b.id = s.bookId 
` + searchClause(searchString) + `
` + (sortArray[sortString] || sortArray['timestamp.desc']) + `
limit ? offset ?`;
};


function searchForBooksQuery(searchString, sortString) {
  return `
  WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.sort
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
)
SELECT
    b.id AS bookId,
    b.timestamp,
    (COALESCE(a.name, '') || '; ' || b.title) AS search_string,
    (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' || 
     COALESCE(s.sort, '') || ' ' ||  SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search,
     s.sort as series_name,
     series_index,
     b.title as title
FROM books b
LEFT JOIN AuthorNames a ON b.id = a.bookId
LEFT JOIN SeriesInfo s ON b.id = s.bookId
${searchClause(searchString)} 
order by bookId desc 
LIMIT ?
  `;
};

function countBooksQuery(searchString) {
  return `
WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.name AS series_name
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
)
SELECT COUNT(*) AS count
FROM (
    SELECT (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' ||
      COALESCE(s.series_name, '') || ' ' ||  SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search
    FROM books b
    LEFT JOIN AuthorNames a ON b.id = a.bookId
    LEFT JOIN SeriesInfo s ON b.id = s.bookId
    ` + searchClause(searchString) + `
)`;
};

function findBooksWithTagsQuery(searchString, sortString, tagIdString) {
  return `
WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.name AS series_name
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
),
FilteredBooks AS (
    SELECT books.*
    FROM books
    JOIN books_tags_link ON books.id = books_tags_link.book
    WHERE books_tags_link.tag = ` + tagIdString + `
)
SELECT ROW_NUMBER() OVER (ORDER BY b.timestamp DESC) AS num,
       b.id AS bookId,
       b.title,
       b.sort,
       b.timestamp,
       b.pubdate,
       b.series_index AS seriesIndex,
       b.path,
       (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' ||
          COALESCE(s.series_name, '') || ' ' ||  SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search
FROM FilteredBooks b
LEFT JOIN AuthorNames a ON b.id = a.bookId
LEFT JOIN SeriesInfo s ON b.id = s.bookId
` + searchClause(searchString) + `
` + (sortArray[sortString] || sortArray['timestamp.desc']) + ` limit ? offset ?`;
}

function countBooksWithTagsQuery(searchString, tagIdString) {
  return `
WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.name AS series_name
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
),
FilteredBooks AS (
    SELECT DISTINCT books.*
    FROM books
    JOIN books_tags_link ON books.id = books_tags_link.book
    WHERE books_tags_link.tag = ` + tagIdString + `
)
SELECT COUNT(*) AS count
FROM (
    SELECT (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' || 
      COALESCE(s.series_name, '') || ' ' ||  SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search
    FROM FilteredBooks b
    LEFT JOIN AuthorNames a ON b.id = a.bookId
    LEFT JOIN SeriesInfo s ON b.id = s.bookId
    ` + searchClause(searchString) + `
)`;
}

function findBooksWithCCQuery(ccNum, searchString, sortString, ccIdString) {
  return `
WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.name AS series_name
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
),
FilteredBooks AS (
    SELECT books.*
    FROM books
    JOIN books_custom_column_` + ccNum + `_link AS ccl ON books.id = ccl.book
    JOIN custom_column_` + ccNum + ` AS cc ON ccl.value = cc.id
    WHERE cc.id IN (` + ccIdString + `)  -- Filterung nach Custom Column ID
)
SELECT ROW_NUMBER() OVER (` + (sortArray[sortString] || sortArray['timestamp.desc']) + `) AS num,
       ` + bookColumns + `,
      (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' || 
        COALESCE(s.series_name, '') || ' ' || SUBSTR(b.path, 1, INSTR(b.path, '(') - 1)) AS search
FROM FilteredBooks b
LEFT JOIN AuthorNames a ON b.id = a.bookId
LEFT JOIN SeriesInfo s ON b.id = s.bookId
` + searchClause(searchString) + `
LIMIT ? OFFSET ?;`;
}

function countBooksWithCCQuery(ccNum, searchString, ccIdString) {
  return `
WITH AuthorNames AS (
    SELECT books.id AS bookId,
           GROUP_CONCAT(authors.name, ', ') AS name
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON authors.id = books_authors_link.author
    GROUP BY books.id
),
SeriesInfo AS (
    SELECT books.id AS bookId, series.name AS series_name
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON series.id = books_series_link.series
),
FilteredBooks AS (
    SELECT books.*
    FROM books
    JOIN books_custom_column_` + ccNum + `_link AS ccl ON books.id = ccl.book
    JOIN custom_column_` + ccNum + ` AS cc ON ccl.value = cc.id
    WHERE cc.id IN (` + ccIdString + `)  -- Frühzeitige Filterung nach Custom Column ID
)
SELECT COUNT(*) AS count
FROM (
    SELECT 1  -- Platzhalter, da wir nur die Zeilenanzahl zählen
    FROM FilteredBooks b
    LEFT JOIN AuthorNames a ON b.id = a.bookId
    LEFT JOIN SeriesInfo s ON b.id = s.bookId
    WHERE (COALESCE(a.name, '') || ' ' || b.author_sort || ' ' || b.title || ' ' || 
           COALESCE(s.series_name, '') || ' ' || b.path) LIKE '%` + searchString + `%'
);`
}

function findBooksByAuthorQuery(sortString) {
  return `
WITH AuthorBooks AS (
    SELECT books.*
    FROM books
    JOIN books_authors_link ON books.id = books_authors_link.book
    JOIN authors ON books_authors_link.author = authors.id
    WHERE authors.id = ?
)
SELECT ROW_NUMBER() OVER (
    ` + (sortArray[sortString] || sortArray['serie.asc']) + `
) AS num, ` + bookColumns + `
FROM AuthorBooks b
LIMIT ? OFFSET ?;`
}

const countBooksByAuthorQuery = `SELECT COUNT(*) AS count
FROM authors a
JOIN books_authors_link bal ON a.id = bal.author
JOIN books b ON bal.book = b.id
WHERE a.id = ?`;

function findBooksBySerieQuery(sortString) {
  return `
WITH SeriesBooks AS (
    SELECT books.*, series.name AS seriesName, series.id AS seriesId
    FROM books
    JOIN books_series_link ON books.id = books_series_link.book
    JOIN series ON books_series_link.series = series.id
    WHERE series.id = ?
)
SELECT ROW_NUMBER() OVER (
    ` + (sortArray[sortString] || sortArray['serie.asc']) + `
) AS num, ` + bookColumns + `, seriesName, seriesId
FROM SeriesBooks b
LIMIT ? OFFSET ?;`;
}

const countBooksBySerieQuery = `
SELECT COUNT(*) AS count
FROM books b
JOIN books_series_link bsl ON bsl.book = b.id
JOIN series s ON s.id = bsl.series
WHERE s.id = ?;`;

// Global prepared STMTs (for better performance of often used prepared STMTs)
try {
  initDb();
  COVERDATA_STMT = METADATA_DB.prepare(queryCoverData);
} catch (error) {
  errorLogger(error);
  process.exit(1);
}

// Exported functions **************************************
export function connectDb() {  // open database 
  try {
    initDb();
    if (!COVERDATA_STMT) COVERDATA_STMT = METADATA_DB.prepare(queryCoverData);
    logger.info("connectDb: DB opened");
    return { state: true, msg: "Calibre Database connected." }
  } catch (error) {
    return { state: false, msg: error.message };
  }
}

export function unconnectDb() {  // close database 
  try {
    if (METADATA_DB) {
      METADATA_DB.close();
      METADATA_DB = null;
      COVERDATA_STMT = null;
      logger.warn("unconnectDb: DB closed");
    }
    return { state: true, msg: "Calibre Database closed" }
  } catch (error) {
    return { state: false, msg: error.message };
  }
}

export function findBooks(searchString, sortString, limit, offset) {
  logger.debug("findBooks: searchString=" + searchString + ", sortString=" + sortString + ", limit=" + limit + ", offset=" + offset);
  try {
    const selectAllStmt = METADATA_DB.prepare(findBooksQuery(searchString, sortString));
    return selectAllStmt.all(limit, offset);
  } catch (error) { errorLogger(error); return [] }
}


export function searchForBooks(searchString, limit=25) {
  logger.debug(`searchForBooks: searchString=${searchString}, limit=${limit}`);
  try {
    console.log(searchForBooksQuery(searchString, limit));
    const selectAllStmt = METADATA_DB.prepare(searchForBooksQuery(searchString, limit));
    return selectAllStmt.all(limit);
  } catch (error) { errorLogger(error); return [] }
}

export function countBooks(searchString) {
  logger.debug("countBooks: searchString=" + searchString);
  try {
    const selectOneStmt = METADATA_DB.prepare(countBooksQuery(searchString));
    return selectOneStmt.get().count;
  } catch (error) { errorLogger(error); return -1 }
}

export function findBooksWithTags(searchString, sortString, tagIdString, limit, offset) {
  logger.debug("findBooksWithTags: searchString=" + searchString + ", sortString=" + sortString + ", tagIdString=" + tagIdString + ", limit=" + limit + ", offset=" + offset);
  try {
    const selectAllStmt = METADATA_DB.prepare(findBooksWithTagsQuery(searchString, sortString, tagIdString));
    return selectAllStmt.all(limit, offset);
  } catch (error) { errorLogger(error); return []; }
}

export function countBooksWithTags(searchString, tagIdString) {
  logger.debug("countBooksWithTags: searchString=" + searchString + ", tagIdString=" + tagIdString);
  try {
    const selectOneStmt = METADATA_DB.prepare(countBooksWithTagsQuery(searchString, tagIdString));
    return selectOneStmt.get().count;
  } catch (error) { errorLogger(error); return -1; }
}

export function findBooksWithCC(ccNum, searchString, sortString, ccIdString, limit, offset) {
  logger.debug("findBooksWithCC: ccNum=" + ccNum + ", searchString=" + searchString + ", sortString=" + sortString + ", ccIdString=" + ccIdString + ", limit=" + limit + ", offset=" + offset);
  try {
    const selectAllStmt = METADATA_DB.prepare(findBooksWithCCQuery(ccNum, searchString, sortString, ccIdString));
    return selectAllStmt.all(limit, offset);
  } catch (error) { errorLogger(error); return []; }
}

export function countBooksWithCC(ccNum, searchString, ccIdString) {
  logger.debug("countBooksWithCC: ccNum=" + ccNum + ", searchString=" + searchString + ", ccIdString=" + ccIdString);
  try {
    const selectOneStmt = METADATA_DB.prepare(countBooksWithCCQuery(ccNum, searchString, ccIdString));
    return selectOneStmt.get().count;
  } catch (error) { errorLogger(error); return -1; }
}

//====

export function findBooksBySerie(seriesId, sortString, limit, offset) {
  logger.debug("findBooksBySerie: seriesId=" + seriesId + ", sortString=" + sortString + ", limit=" + limit + ", offset=" + offset);
  try {
    const selectAllStmt = METADATA_DB.prepare(findBooksBySerieQuery(sortString));
    return selectAllStmt.all(seriesId, limit, offset);
  } catch (error) { errorLogger(error); return []; }
}

export function countBooksBySerie(seriesId) {
  try {
    const selectOneStmt = METADATA_DB.prepare(countBooksBySerieQuery);
    return selectOneStmt.get(seriesId).count;
  } catch (error) { errorLogger(error); return -1; }
}

export function findBooksByAuthor(authorsId, sortString, limit, offset) {
  logger.debug("findBooksByAuthor: authorsId=" + authorsId + ", sortString=" + sortString + ", limit=" + limit + ", offset=" + offset);
  try {
    const selectAllStmt = METADATA_DB.prepare(findBooksByAuthorQuery(sortString));
    return selectAllStmt.all(authorsId, limit, offset);
  } catch (error) { errorLogger(error); return []; }
}

export function countBooksByAuthor(authorsId) {
  try {
    const selectOneStmt = METADATA_DB.prepare(countBooksByAuthorQuery);
    return selectOneStmt.get(authorsId).count;
  } catch (error) { errorLogger(error); return -1; }
}

export function getBook(bookId) {
  try {
    const selectOneStmt = METADATA_DB.prepare(queryBook);
    return selectOneStmt.get(bookId);
  } catch (error) { errorLogger(error); return null; }
}

export function getAuthorsOfBooks(bookIdString) {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryAuthorsOfBooks(bookIdString));
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getFormatsOfBooks(bookIdString) {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryFormatsOfBooks(bookIdString));
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getSeriesOfBooks(bookIdString) {
  try {
    const selectAllStmt = METADATA_DB.prepare(querySeriesOfBooks(bookIdString));
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getTagsOfBooks(bookIdString) {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryTagsOfBook(bookIdString));
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getPublisherOfBooks(bookIdString) {
  try {
    const selectOneStmt = METADATA_DB.prepare(queryPublisherOfBook(bookIdString));
    return selectOneStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getCustomColumnOfBooks(colId, bookIdString) {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryCustomColumnsOfBooks(colId, bookIdString));
    return selectAllStmt.all().map(res => res.value);
  } catch (error) { errorLogger(error); return []; }
}

export function getTags() {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryTags);
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getCustomColumnsIds() {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryCustomColumnsIds);
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getCustomColumns(ccNum) {
  try {
    const selectAllStmt = METADATA_DB.prepare(queryCustomColumns(ccNum));
    return selectAllStmt.all();
  } catch (error) { errorLogger(error); return []; }
}

export function getCoverData(bookId) {
  try {
    return COVERDATA_STMT.get(bookId);
  } catch (error) {
    if (error.code === "ERR_INVALID_STATE") {
      try {
        logger.warn("*** getCoverData: re-prepared global STMT");
        COVERDATA_STMT = METADATA_DB.prepare(queryCoverData);
        return COVERDATA_STMT.get(bookId);
      } catch (error) { errorLogger(error); return null; }
    } else { errorLogger(error); return null; }
  }
}

export function getFileData(bookId, format) {
  try {
    return METADATA_DB.prepare(queryFileData,).get(bookId, format);
  } catch (error) { errorLogger(error); return null; }
}

export function getStatistics() {
  try {
    return METADATA_DB.prepare(queryCounts).get();
  } catch (error) { errorLogger(error); return {}; }
}

export function getTagsStatistics() {
  try {
    return METADATA_DB.prepare(queryTagsCounts).all();
  } catch (error) { errorLogger(error); return []; }
}

export function getAuthorsStatistics() {
  try {
    return METADATA_DB.prepare(queryAuthorsCounts).all();
  } catch (error) { errorLogger(error); return []; }
}

export function getSeriesStatistics() {
  try {
    return METADATA_DB.prepare(querySeriesCounts).all();
  } catch (error) { errorLogger(error); return []; }
}

export function getPublishersStatistics() {
  try {
    return METADATA_DB.prepare(queryPublisherCounts).all();
  } catch (error) { errorLogger(error); return []; }
}

