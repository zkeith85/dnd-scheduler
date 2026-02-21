import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const LOCAL_USER_KEY = "dnd_scheduler_user_v1";
const LOCAL_MONTH_KEY = "dnd_scheduler_month_v1";
const SCHEDULE_MONTHS = [
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12"
];

const joinForm = document.getElementById("join-form");
const nameInput = document.getElementById("name-input");
const monthInput = document.getElementById("month-input");
const statusEl = document.getElementById("status");
const shareLinkEl = document.getElementById("share-link");
const copyLinkBtn = document.getElementById("copy-link-btn");

const dateForm = document.getElementById("date-form");
const playerForm = document.getElementById("player-form");
const dateInput = document.getElementById("date-input");
const playerInput = document.getElementById("player-input");
const dateList = document.getElementById("date-list");
const playerList = document.getElementById("player-list");
const boardWrap = document.getElementById("board-wrap");
const results = document.getElementById("results");
const resetBtn = document.getElementById("reset-btn");

const state = {
  players: [],
  dates: [],
  availability: {}
};

let db = null;
let activeRoomId = "";
let activeUser = "";
let unsubscribe = null;
let connected = false;

boot();

function boot() {
  const config = window.FIREBASE_CONFIG;
  if (!isConfigReady(config)) {
    setStatus("Add your Firebase config in firebase-config.js to enable shared sync.", true);
    setConnectedUI(false);
    wireStaticHandlers();
    render();
    return;
  }

  db = getFirestore(initializeApp(config));
  wireStaticHandlers();
  restoreSessionFromUrlOrStorage();
}

function wireStaticHandlers() {
  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = sanitizePlayerName(nameInput.value);
    const monthId = sanitizeMonthId(monthInput.value);
    if (!name || !monthId) {
      setStatus("Enter a valid name and select a month.", true);
      return;
    }
    nameInput.value = name;
    monthInput.value = monthId;
    localStorage.setItem(LOCAL_USER_KEY, name);
    localStorage.setItem(LOCAL_MONTH_KEY, monthId);
    await joinRoom(monthId, name);
  });

  copyLinkBtn.addEventListener("click", async () => {
    if (!activeRoomId) {
      return;
    }
    const link = roomShareLink(activeRoomId);
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Month link copied.");
    } catch {
      setStatus(`Copy failed. Use this link: ${link}`, true);
    }
  });

  dateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!connected) {
      return;
    }
    const value = dateInput.value;
    if (!value) {
      return;
    }
    if (!isDateInMonth(value, activeRoomId)) {
      setStatus("Pick a date inside the selected month.", true);
      return;
    }
    dateInput.value = "";
    await mutateRoom((data) => {
      if (data.dates.includes(value)) {
        return;
      }
      data.dates.push(value);
      data.dates.sort();
      for (const player of data.players) {
        ensurePlayerAvailability(data, player);
      }
    });
  });

  playerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!connected) {
      return;
    }
    const name = sanitizePlayerName(playerInput.value);
    if (!name) {
      return;
    }
    playerInput.value = "";
    await mutateRoom((data) => {
      if (data.players.includes(name)) {
        return;
      }
      data.players.push(name);
      ensurePlayerAvailability(data, name);
    });
  });

  resetBtn.addEventListener("click", async () => {
    if (!connected) {
      return;
    }
    if (!confirm("Clear all players, dates, and availability for this month?")) {
      return;
    }
    await mutateRoom((data) => {
      data.players = [];
      data.dates = [];
      data.availability = {};
    });
  });
}

function restoreSessionFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const monthFromQuery = sanitizeMonthId(params.get("month") || params.get("room") || "");
  const monthFromStorage = sanitizeMonthId(localStorage.getItem(LOCAL_MONTH_KEY) || "");
  const nameFromStorage = sanitizePlayerName(localStorage.getItem(LOCAL_USER_KEY) || "");

  if (nameFromStorage) {
    nameInput.value = nameFromStorage;
  }
  if (monthFromQuery || monthFromStorage) {
    monthInput.value = monthFromQuery || monthFromStorage;
  }

  if (db && nameFromStorage && (monthFromQuery || monthFromStorage)) {
    joinRoom(monthFromQuery || monthFromStorage, nameFromStorage);
  } else {
    render();
    setConnectedUI(false);
  }
}

async function joinRoom(roomId, userName) {
  if (!db) {
    setStatus("Firebase is not configured yet.", true);
    return;
  }
  activeRoomId = roomId;
  activeUser = userName;
  connected = false;
  setConnectedUI(false);
  applyDateLimits(roomId);
  updateShareLink();
  setStatus("Connecting...");
  setMonthInUrl(roomId);

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const roomRef = doc(db, "rooms", roomId);
  unsubscribe = onSnapshot(
    roomRef,
    (snapshot) => {
      const incoming = normalizeState(snapshot.exists() ? snapshot.data() : null);
      state.players = incoming.players;
      state.dates = incoming.dates;
      state.availability = incoming.availability;
      connected = true;
      setConnectedUI(true);
      render();
      setStatus(`Connected to ${monthLabel(roomId)} schedule.`);
    },
    () => {
      connected = false;
      setConnectedUI(false);
      setStatus("Lost connection to month schedule. Check Firebase config/rules.", true);
    }
  );

  try {
    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(roomRef);
      const roomData = normalizeState(snapshot.exists() ? snapshot.data() : null);
      if (!roomData.players.includes(userName)) {
        roomData.players.push(userName);
      }
      for (const player of roomData.players) {
        ensurePlayerAvailability(roomData, player);
      }
      tx.set(roomRef, { ...roomData, updatedAt: serverTimestamp() }, { merge: true });
    });
  } catch {
    setStatus("Could not join month schedule. Check Firestore rules and try again.", true);
  }
}

async function mutateRoom(mutator) {
  if (!db || !activeRoomId) {
    return;
  }
  const roomRef = doc(db, "rooms", activeRoomId);
  try {
    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(roomRef);
      const roomData = normalizeState(snapshot.exists() ? snapshot.data() : null);
      mutator(roomData);
      sanitizeRoomData(roomData);
      tx.set(roomRef, { ...roomData, updatedAt: serverTimestamp() }, { merge: true });
    });
  } catch {
    setStatus("Save failed. Retry in a few seconds.", true);
  }
}

function sanitizeRoomData(data) {
  data.players = [...new Set(data.players.map(sanitizePlayerName).filter(Boolean))];
  data.dates = [...new Set(data.dates.filter((date) => validDateString(date) && isDateInMonth(date, activeRoomId)))].sort();
  if (!data.availability || typeof data.availability !== "object") {
    data.availability = {};
  }
  for (const player of data.players) {
    ensurePlayerAvailability(data, player);
  }
  for (const key of Object.keys(data.availability)) {
    if (!data.players.includes(key)) {
      delete data.availability[key];
    }
  }
}

function ensurePlayerAvailability(data, player) {
  if (!data.availability[player] || typeof data.availability[player] !== "object") {
    data.availability[player] = {};
  }
  for (const date of data.dates) {
    if (typeof data.availability[player][date] !== "boolean") {
      data.availability[player][date] = false;
    }
  }
  for (const date of Object.keys(data.availability[player])) {
    if (!data.dates.includes(date)) {
      delete data.availability[player][date];
    }
  }
}

function removeDate(targetDate) {
  mutateRoom((data) => {
    data.dates = data.dates.filter((d) => d !== targetDate);
    for (const player of data.players) {
      if (data.availability[player]) {
        delete data.availability[player][targetDate];
      }
    }
  });
}

function removePlayer(targetPlayer) {
  mutateRoom((data) => {
    data.players = data.players.filter((p) => p !== targetPlayer);
    delete data.availability[targetPlayer];
  });
}

function toggleAvailability(player, date) {
  mutateRoom((data) => {
    ensurePlayerAvailability(data, player);
    data.availability[player][date] = !data.availability[player][date];
  });
}

function render() {
  renderChips();
  renderBoard();
  renderResults();
}

function renderChips() {
  dateList.innerHTML = "";
  playerList.innerHTML = "";

  if (!state.dates.length) {
    dateList.innerHTML = '<p class="empty">No candidate dates yet.</p>';
  } else {
    for (const date of state.dates) {
      const chip = document.createElement("span");
      chip.className = "chip";

      const label = document.createElement("span");
      label.textContent = formatDate(date);
      chip.appendChild(label);

      const button = document.createElement("button");
      button.className = "remove";
      button.setAttribute("aria-label", `Remove ${date}`);
      button.type = "button";
      button.textContent = "x";
      button.addEventListener("click", () => removeDate(date));
      chip.appendChild(button);

      dateList.appendChild(chip);
    }
  }

  if (!state.players.length) {
    playerList.innerHTML = '<p class="empty">No players yet.</p>';
  } else {
    for (const player of state.players) {
      const chip = document.createElement("span");
      chip.className = "chip";

      const label = document.createElement("span");
      label.textContent = player;
      chip.appendChild(label);

      const button = document.createElement("button");
      button.className = "remove";
      button.setAttribute("aria-label", `Remove ${player}`);
      button.type = "button";
      button.textContent = "x";
      button.addEventListener("click", () => removePlayer(player));
      chip.appendChild(button);

      playerList.appendChild(chip);
    }
  }
}

function renderBoard() {
  if (!state.dates.length || !state.players.length) {
    boardWrap.innerHTML = '<p class="empty" style="padding: 0.8rem;">Add at least one date and one player.</p>';
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headerRow.appendChild(document.createElement("th")).textContent = "Player";
  for (const date of state.dates) {
    const th = document.createElement("th");
    th.textContent = formatDate(date);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const player of state.players) {
    const row = document.createElement("tr");
    row.appendChild(document.createElement("td")).textContent = player;

    for (const date of state.dates) {
      const td = document.createElement("td");
      const available = Boolean(state.availability[player]?.[date]);
      td.className = "toggle" + (available ? " available" : "");
      td.textContent = available ? "Available" : "No";
      td.addEventListener("click", () => toggleAvailability(player, date));
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  boardWrap.innerHTML = "";
  boardWrap.appendChild(table);
}

function renderResults() {
  results.innerHTML = "";
  if (!state.dates.length || !state.players.length) {
    results.innerHTML = '<li class="empty">Results will appear once your board has players and dates.</li>';
    return;
  }

  const scores = state.dates
    .map((date) => {
      const available = state.players.filter((player) => Boolean(state.availability[player]?.[date]));
      return { date, count: available.length, available };
    })
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));

  for (const result of scores.slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = `${formatDate(result.date)} - ${result.count}/${state.players.length} available`;
    if (result.available.length) {
      const names = document.createElement("div");
      names.className = "hint";
      names.textContent = `Party ready: ${result.available.join(", ")}`;
      li.appendChild(names);
    }
    results.appendChild(li);
  }
}

function normalizeState(raw) {
  const clean = {
    players: Array.isArray(raw?.players) ? raw.players : [],
    dates: Array.isArray(raw?.dates) ? raw.dates : [],
    availability: raw?.availability && typeof raw.availability === "object" ? raw.availability : {}
  };
  sanitizeRoomData(clean);
  return clean;
}

function sanitizeMonthId(raw) {
  const month = String(raw || "").trim();
  return SCHEDULE_MONTHS.includes(month) ? month : "";
}

function sanitizePlayerName(raw) {
  return String(raw || "").trim().slice(0, 40);
}

function isConfigReady(config) {
  if (!config || typeof config !== "object") {
    return false;
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  for (const key of required) {
    const value = String(config[key] || "").trim();
    if (!value || value.includes("REPLACE_ME")) {
      return false;
    }
  }
  return true;
}

function validDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDateInMonth(dateString, monthId) {
  if (!validDateString(dateString) || !sanitizeMonthId(monthId)) {
    return false;
  }
  return dateString.startsWith(`${monthId}-`);
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function roomShareLink(roomId) {
  return `${window.location.origin}${window.location.pathname}?month=${encodeURIComponent(roomId)}`;
}

function updateShareLink() {
  if (!activeRoomId) {
    shareLinkEl.textContent = "";
    shareLinkEl.removeAttribute("href");
    return;
  }
  const link = roomShareLink(activeRoomId);
  shareLinkEl.textContent = link;
  shareLinkEl.href = link;
}

function setMonthInUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("month", roomId);
  window.history.replaceState({}, "", url);
}

function monthLabel(monthId) {
  const [year, month] = monthId.split("-");
  const date = new Date(`${monthId}-01T00:00:00`);
  const monthName = date.toLocaleDateString(undefined, { month: "long" });
  return `${monthName} ${year}`;
}

function applyDateLimits(monthId) {
  if (!sanitizeMonthId(monthId)) {
    dateInput.removeAttribute("min");
    dateInput.removeAttribute("max");
    return;
  }
  const [yearText, monthText] = monthId.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(year, month, 0).getDate();
  dateInput.min = `${monthId}-01`;
  dateInput.max = `${monthId}-${String(lastDay).padStart(2, "0")}`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#8a2315" : "";
}

function setConnectedUI(isConnected) {
  dateInput.disabled = !isConnected;
  playerInput.disabled = !isConnected;
  dateForm.querySelector("button[type='submit']").disabled = !isConnected;
  playerForm.querySelector("button[type='submit']").disabled = !isConnected;
  resetBtn.disabled = !isConnected;
  copyLinkBtn.disabled = !activeRoomId;
  updateShareLink();
}
