'use strict'

let TOKEN = localStorage.getItem('token');
let SCROLL_POSITION = 0;

//validate
async function validate() {
  try {
    const response = await fetch("/verify", { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    const data = await response.json();
    switch (response.status) {
      case 200: {
        displayMessage('Login "' + data.user.username + '" gültig bis ' + (new Date(data.user.exp * 1000).toLocaleDateString()), 5);
        break;
      }
      case 401: {
        document.getElementById('booklist').innerHTML = "";
        document.getElementById('book').innerHTML = "";
        document.querySelectorAll('button.menu').forEach(el => el.style.display = 'none');
        document.getElementById('searchInput').style.display = 'none';
        document.getElementById('login').innerHTML = data.html;
        break;
      }
      default: {
        responseFail_Handler("verifyUser", response);
      }
    }
  } catch (error) { console.error('Error:', error); }
}

async function login(first_login) {
  const loginForm = document.getElementById('loginForm');

  if (loginForm) {
    const formData = new FormData(loginForm);
    const data = Object.fromEntries(formData.entries());

    if (first_login) {
      if (data.password !== data.password2) {
        displayMessage('Passwords do not match. Try again!', 5);
        return;
      }
    }

    try {
      const response = await fetch("/login", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok) {
        TOKEN = result.token;
        localStorage.setItem('token', result.token);
        document.getElementById('login').innerHTML = "";
        document.querySelectorAll('.menu').forEach(el => el.style.display = 'block');
        document.getElementById('searchInput').style.display = 'block';

        getBooklist(LIST_OPTIONS);
      } else {
        responseFail_Handler("login", response, 'Credentials not valid. Try again!')
      }
    } catch (error) {
      error_Handler("login", error)
    }
  }
}

let displayMessageTimeoutHandler;

function displayMessage(msg, sec) {
  document.getElementById('message').innerHTML = "<p>" + msg + "</p";
  if (displayMessageTimeoutHandler) displayMessageTimeoutHandler.clear;
  if (sec)
    displayMessageTimeoutHandler = setTimeout(() => { document.getElementById('message').innerHTML = "" }, sec * 1000);
}

function responseFail_Handler(functionName, response, msg) {
  msg = msg || (functionName + ": " + response.statusText + " (#" + response.status + ")");
  displayMessage(msg, 8);
}

function error_Handler(functionName, error, msg) {
  msg = msg || (functionName + ": " + 'Error fetching data: ' + error);
  console.error(msg);
  displayMessage(msg, 8);
}

const LIST_OPTIONS = {
  'type': 'search',
  'searchString': '',
  'bookId': 0,
  'serieId': 0,
  'authorsId': 0,
  'tagId': 0,
  'ccId': 0,
  'ccNum': 0,
  'sortString': 'timestamp.desc'
};

let OPTIONS_COUNTER;

let OPTIONS;

function pushOptions(options) {
  OPTIONS_COUNTER = OPTIONS_COUNTER + 1;
  sessionStorage.setItem("cassis" + OPTIONS_COUNTER, JSON.stringify(options));
  sessionStorage.setItem("cassis_OPTIONS_COUNTER", OPTIONS_COUNTER);
  if (OPTIONS_COUNTER > 1) {
    let n = OPTIONS_COUNTER;
    let optionsString;
    do {
      optionsString = sessionStorage.getItem("cassis" + ++n);
      optionsString && sessionStorage.removeItem("cassis" + n);
    }
    while (optionsString);
  }
}

function getOptions() {
  const optionsString = sessionStorage.getItem("cassis" + OPTIONS_COUNTER)
  return (optionsString) && JSON.parse(optionsString);
}

function getOption(option) {
  const optionsString = sessionStorage.getItem("cassis" + OPTIONS_COUNTER)
  return (optionsString) && JSON.parse(optionsString)[option];
}

function restoreOptions() {
  OPTIONS_COUNTER = parseInt(sessionStorage.getItem("cassis_OPTIONS_COUNTER")) || 0;
  let options = getOptions();
  if (!options) { options = LIST_OPTIONS; pushOptions(options); }

  if (OPTIONS_COUNTER == 1)
    document.getElementById('back').classList.add("disabled");
  else
    document.getElementById('back').classList.remove("disabled");

  if (!sessionStorage.getItem("cassis" + (OPTIONS_COUNTER + 1)))
    document.getElementById('forward').classList.add("disabled");
  else
    document.getElementById('forward').classList.remove("disabled");

  if (options.type !== 'search')
    document.getElementById('authorsort').classList.add("disabled");
  else
    document.getElementById('authorsort').classList.remove("disabled");
}

async function historyMove(direction) {
  if (document.getElementById('book').style.display !== 'none') {
    closeBook();
    restoreOptions();
    return;
  }

  OPTIONS_COUNTER = parseInt(sessionStorage.getItem("cassis_OPTIONS_COUNTER")) + direction;
  let options = getOptions();
  if (!options) return;

  options.page = 0;  // to top of html page
  document.getElementById('searchInput').value = options.searchString || "";
  getBooklist(options);
  sessionStorage.setItem("cassis_OPTIONS_COUNTER", OPTIONS_COUNTER);
  restoreOptions();
}

function goBack() { historyMove(-1) }
function goForward() { historyMove(1) }

async function getBooklist(options) {
  console.log(`getBooklist: ${JSON.stringify(options)}`);
  const response = await fetch("/app/list/", {
    method: "POST",
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(options)
  });
  if (response.status === 200) {
    const data = await response.json();
    document.getElementById("booklist").innerHTML = data.html;
    document.getElementById("booklist").style.display = 'flex';
    document.getElementById("book").style.display = 'none';
    document.getElementById("info").style.display = 'none';
    document.getElementById("searchInput").value = data.searchString;
    document.body.scrollIntoView();
    restoreOptions();
  } else {
    login(false);
    //responseFail_Handler("getBooklist", response);
  }
}

async function appendToBooklist(options) {
  const response = await fetch("/app/list/", {
    method: "POST",
    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(options)
  });
  const data = await response.json();
  document.getElementById("pagedown").remove();
  document.getElementById("booklist").insertAdjacentHTML("beforeend", data.html);
  CURPAGE = 0;
}

// Element deaktivieren
function dis(item) {
  item.disabled = true;
  setTimeout(() => { item.disabled = false; }, 1000);
}

const getScrollPosition = () => window.pageYOffset || document.documentElement.scrollTop;

function scrollToPosition(position) {
  window.scrollTo({ top: position, behavior: 'smooth' });
}

// Sofortiger Sprung (ohne Animation)
function jumpToPosition(position) {
  window.scrollTo(0, position);
  // oder alternativ:
  // document.documentElement.scrollTop = position;
}

async function getBook(options) {
  console.log(`getBook: ${JSON.stringify(options)}`);
  SCROLL_POSITION = options.scrollPosition || SCROLL_POSITION;
  /*   if (options.oldNum) {
      document.getElementById("app").classList.add((options.oldNum > options.num) ? "swipe-right-transition" : "swipe-left-transition");
    } */
  const response = await fetch("/app/book/" + options.bookId, {
    method: "POST",
    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(options)
  })
  const data = await response.json();

  document.getElementById('login').innerHTML = "";
  document.getElementById("book").innerHTML = data.html;
  document.getElementById("book").style.display = 'block';
  document.getElementById("booklist").style.display = 'none';
  document.getElementById("info").style.display = 'none';
  //document.getElementById('searchInput').value = "";
  document.body.scrollIntoView();

  const bookList = document.getElementById('booklist');
  const currentItem = bookList.querySelector(`[id='${options.bookId}'].item`);

  const nextItem = currentItem.nextElementSibling;
  const nextItemId = nextItem?.classList.contains('item') ? nextItem.id : null;
  if (nextItemId)
    document.getElementById('next_book').value = nextItemId;
  else
    document.getElementById('next_book').style.display = 'none';

  const prevItem = currentItem.previousElementSibling;
  const prevItemId = prevItem?.classList.contains('item') ? prevItem.id : null;
  if (prevItemId)
    document.getElementById('prev_book').value = prevItemId;
  else
    document.getElementById('prev_book').style.display = 'none';

  document.getElementById('back').classList.remove("disabled");

  //restoreOptions();

  /*   if (options.oldNum) {
      document.getElementById("app").classList.remove((options.oldNum > options.num) ? "swipe-right-transition" : "swipe-left-transition");
  
      document.getElementById("app").classList.add((options.oldNum < options.num) ? "trans-right" : "trans-left");
      setTimeout(() => {
        document.getElementById("app").classList.add("swipe-null-transition");
      }, 0);
    } */
  /*setTimeout(() => {
    document.getElementById("footer").style.display = "block";
     if (options.oldNum) {
      document.getElementById("app").classList.remove((options.oldNum < options.num) ? "trans-right" : "trans-left");
      document.getElementById("app").classList.remove("swipe-null-transition");
    } 
  }, 0)*/

  document.getElementById("footer").style.display = "block";
}

function closeBook() {
  document.getElementById("book").style.display = 'none';
  document.getElementById("booklist").style.display = 'flex';
  jumpToPosition(SCROLL_POSITION);
}

function setOptionsHome() {
  let options = LIST_OPTIONS;
  getBooklist(options);
  pushOptions(options);
  /* OPTIONS_COUNTER = 1;
  sessionStorage.setItem("cassis_OPTIONS_COUNTER", OPTIONS_COUNTER); */
  document.getElementById('searchInput').value = '';
}

function setOptionsSearch() {
  let options = {
    'type': 'search',
    'searchString': document.getElementById('searchInput').value
  };
  getBooklist(options);
  pushOptions(options);
}

function setOptionsTag(newOptions) {
  //alert("setOptionsTag: tagOptions=" + JSON.stringify(newOptions));
  let oldOptions = getOptions();
  let options = {
    'type': 'search',
    'searchString': document.getElementById('searchInput').value,
    'tagId': newOptions.tagId || oldOptions.tagId,
    'sortString': newOptions.sortString || oldOptions.sortString
  };

  getBooklist(options);
  pushOptions(options);
}

function setOptionsCC(newOptions) {
  //alert(("setOptionsCC: newOptions=" + JSON.stringify(newOptions));
  let oldOptions = getOptions();
  let options = {
    'type': 'search',
    'searchString': document.getElementById('searchInput').value,
    'ccNum': newOptions.ccNum || oldOptions.ccNum,
    'ccId': newOptions.ccId || oldOptions.ccId,
    'sortString': newOptions.sortString || oldOptions.sortString
  };
  getBooklist(options);
  pushOptions(options);
}

function setOptionsSerie(newOptions) {
  //("setOptionsSerie: newOptions=" + JSON.stringify(newOptions));
  document.getElementById('searchInput').value = "";
  let options = {
    'type': 'serie',
    'serieId': newOptions.serieId,
    'sortString': 'serie.asc'
  };
  getBooklist(options);
  pushOptions(options);
}

function setOptionsAuthor(newOptions) {
  //alert("setOptionsAuthor: " + JSON.stringify(newOptions));
  document.getElementById('searchInput').value = "";
  let options = {
    'type': 'author',
    'authorsId': newOptions.authorsId,
    'sortString': 'timestamp.desc'
  };
  getBooklist(options);
  document.getElementById('searchInput').value = "";
  pushOptions(options);
}

async function setOptionsBook(options) {
  options.scrollPosition = getScrollPosition()
  getBook(options);
}

async function setOptionsPage(page) {
  let options = getOptions();
  options.page = page;
  appendToBooklist(options);
  pushOptions(options);
}

function setOptionsHub(type, id) {
  //alert(type + ": " + id);
  switch (type) {
    case "tag": {
      setOptionsTag({ "tagId": id })
      break;
    }
    case "author": {
      setOptionsAuthor({ "authorsId": id })
      break;
    }
    case "serie": {
      setOptionsSerie({ "serieId": id })
      break;
    }
    case "publisher": {
      // TODO
      break;
    }
  }
  document.getElementById('stats_popup').style.display = 'none';
  document.getElementById('transparent').style.display = 'none';
}

function setSortString(sortType) {
  //alert("setSortString: sortType=" + sortType);
  const oldSortString = getOption('sortString');
  const newSortString = (oldSortString === sortType + ".asc") ? sortType + ".desc" : sortType + ".asc";
  let options = getOptions();
  options.sortString = newSortString;
  options.page = 0;

  getBooklist(options);
  pushOptions(options);
}

function clearSearchInput() {
  document.getElementById('searchInput').select();
  document.getElementById('searchInput').value = '';
  document.getElementById('searchInput').focus();
}

async function getPage(url) {     // info panel
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();

  document.getElementById("booklist").style.display = 'none';
  document.getElementById("book").style.display = 'none';
  document.getElementById('info').style.display = 'block';
  document.getElementById("info").innerHTML = data.html;

  if (document.getElementById("info_url"))
    document.getElementById("info_url").innerHTML = location.protocol + "//" + location.host;

  setTimeout(() => {
    hideDropdownMenu();
    document.body.scrollIntoView();
  }, 100);
}

function showDropdownMenu() {
  document.getElementById('dropdown').style.display = 'block';
  document.getElementById('transparent').style.display = 'block';
}

function hideDropdownMenu() {
  //alert("hideDropdownMenu");
  document.getElementById('transparent').style.display = 'none';
  document.getElementById('dropdown').style.display = 'none';
  if (document.getElementById('stats_popup')) document.getElementById('stats_popup').style.display = 'none';
}

async function connectDb(connect) {
  const url = (!connect) ? "/app/unconnectdb" : "/app/connectdb";
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  alert(data.msg);
}

async function setLogLevel() {
  let loglevel = document.getElementById('loglevel').value;
  const response = await fetch("/app/log/level/" + loglevel, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  document.getElementById('loglevel-value').innerHTML = data.level;
  document.getElementById('loglevel').value = "0";
}

async function setLogConTransport() {
  let checked = document.getElementById('logToConsole').checked;
  const response = await fetch("/app/log/con/" + (checked ? "1" : "0"), { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  //alert(JSON.stringify(data));
  document.getElementById('logToConsole').checked = data.consoleOn;
}

async function setLogFilTransport() {
  let checked = document.getElementById('logToFile').checked;
  const response = await fetch("/app/log/fil/" + (checked ? "1" : "0"), { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  //alert(JSON.stringify(data));
  document.getElementById('logToFile').checked = data.fileOn;
}

async function showTagsStats() {
  //alert("showTagsStats");
  const response = await fetch("/app/tags/count", { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  document.getElementById('stats_popup').outerHTML = data.html;
  document.getElementById('transparent').style.display = 'block';
  document.getElementById('stats_popup').style.display = 'block';
}

async function showAuthorsStats() {
  //alert("showAuthorsStats");
  const response = await fetch("/app/authors/count", { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  document.getElementById('stats_popup').outerHTML = data.html;
  document.getElementById('transparent').style.display = 'block';
  document.getElementById('stats_popup').style.display = 'block';
}

async function showSeriesStats() {
  //alert("showSeriesStats");
  const response = await fetch("/app/series/count", { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  document.getElementById('stats_popup').outerHTML = data.html;
  document.getElementById('transparent').style.display = 'block';
  document.getElementById('stats_popup').style.display = 'block';
}

async function showPublisherStats() {
  //alert("showPublisherStats");
  const response = await fetch("/app/publishers/count", { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await response.json();
  document.getElementById('stats_popup').outerHTML = data.html;
  document.getElementById('transparent').style.display = 'block';
  document.getElementById('stats_popup').style.display = 'block';
}

async function sendMail(authors, title, bookId, tagName) {
  const to = "Marlies Wilkes <marlies@wilkes1.de>";
  const cc = null;
  const bc = null;
  const protocol = window.location.origin;
  const data = { to, authors, title, bookId, tagName, protocol, cc, bc };

  const response = await fetch("/app/booklink/", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(data)
  })
  const result = await response.json();
  location.href = result.content;
}

function submitInputOnEnter() {
  document.getElementById("searchInput").addEventListener("keypress", function (event) {
    event.key === "Enter" && document.getElementById("submitSearch").click();
  });
}

function pageRefresh() {
  localStorage.removeItem('token');
  location.href = `${location.protocol}//${location.hostname}:${location.port}`
}

//===== swipe ==============================================================

let startX = 0;
let endX = 0;
let startY = 0;
let endY = 0;
let diffX;
let diffY;

function handleSwipe() {
  if (isBooklist()) return;
  diffX = endX - startX;
  diffY = endY - startY;
  if (Math.abs(diffX) > Math.max(50, Math.abs(diffY))) { // 50=Mindest-Horitontal-Swipe-Distanz
    //console.log("Swiped: diffX=" + diffX + ", diffY=" + diffY);
    let clickfunc;
    if (diffX > 0) {
      clickfunc = document.getElementById("prev_book");
    } else {
      clickfunc = document.getElementById("next_book");
    }
    if (clickfunc) {
      clickfunc.click();
    } else {
      displayMessage("keine weiteren Daten", 5);
    }
  }
  //else console.log("Notwiped: diffX=" + diffX + ", diffY=" + diffY);
}

function initSwipe() {
  let isMouseDown = false;

  const swipeArea = document.getElementById("app");

  // TOUCH-EVENTS (für mobile Geräte)
  swipeArea.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  });

  swipeArea.addEventListener("touchend", (e) => {
    endX = e.changedTouches[0].clientX;
    endY = e.changedTouches[0].clientY;
    handleSwipe();
  });

  // MAUS-EVENTS (klassische Maus)
  swipeArea.addEventListener("mousedown", (e) => {
    startX = e.clientX;
    isMouseDown = true;
  });

  swipeArea.addEventListener("mouseup", (e) => {
    if (!isMouseDown) return;
    endX = e.clientX;
    isMouseDown = false;
    handleSwipe();
  });

  swipeArea.addEventListener("mouseleave", () => {
    isMouseDown = false; // Falls die Maus das Element verlässt
  });

  // MAGIC MOUSE Wischgesten (wheel-Event)
  let wheelrunning = false;

  swipeArea.addEventListener("wheel", (e) => {
    if (wheelrunning) return;
    let clickfunc;
    if (isBooklist()) { /* alert('booklist'); */ return; }
    ////if (Math.abs(Math.abs(e.deltaX) - Math.abs(e.deltaY)) < 16) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { // Prüfen, ob es eine horizontale Bewegung ist
      if (e.deltaX < 0) {
        //displayMessage("Nach rechts geswiped (Magic Mouse)!");
        clickfunc = document.getElementById("prev_book");
        wheelrunning = true;
      } else {
        //displayMessage("Nach links geswiped (Magic Mouse)!");
        clickfunc = document.getElementById("next_book");
        wheelrunning = true;
      }
      if (clickfunc) {
        clickfunc.click();
      } else {
        displayMessage("keine weiteren Daten", 5);
      }
    }
    setTimeout(() => (wheelrunning = false), 1450)
  });

}

const isBooklist = () => (document.getElementById("booklist").style.display !== 'none')

const toClipboard = async (text, feedbackId) => {
  const feedbackElement = document.getElementById(feedbackId);
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback für ältere Safari
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    // Feedback (z. B. Tooltip)
    if (feedbackElement) {
      feedbackElement.style.display = '';
      setTimeout(() => feedbackElement.style.display = 'none', 2000);
    }
  } catch (err) {
    console.error("Copy failed:", err);
    if (feedbackElement) {
      feedbackElement.textContent = "Fehler!";
    }
  }
};

//===================================================================

async function docReady(type, id, signature, expires) {
  switch (type) {
    case 'book': {
      getBook({ "bookId": id, "signature": signature || "", "expires": expires || "" });
      break;
    }
    case 'search': {
      getBooklist({ "type": 'search', "searchString": id });
      break;
    }
    default: {
      getBooklist(LIST_OPTIONS);
    }
  }
  submitInputOnEnter();
}


let CURPAGE = 0;
window.onscroll = function () {
  if (isBooklist()) {
    if ((window.innerHeight + Math.ceil(window.scrollY)) >= document.body.offsetHeight - 200) {
      const e = document.getElementById("pagedown");
      if (e) {
        const page = parseInt(e.getAttribute("value"));
        if (CURPAGE < page) {
          setOptionsPage(page);
          CURPAGE = page;
        }
      }
    }
  }
};


validate();
