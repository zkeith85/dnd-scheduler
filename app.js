const STORAGE_KEY = "dnd_scheduler_v1";

const state = loadState();

const dateForm = document.getElementById("date-form");
const playerForm = document.getElementById("player-form");
const dateInput = document.getElementById("date-input");
const playerInput = document.getElementById("player-input");
const dateList = document.getElementById("date-list");
const playerList = document.getElementById("player-list");
const boardWrap = document.getElementById("board-wrap");
const results = document.getElementById("results");
const resetBtn = document.getElementById("reset-btn");

dateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = dateInput.value;
  if (!value || state.dates.includes(value)) {
    return;
  }
  state.dates.push(value);
  state.dates.sort();
  for (const player of state.players) {
    ensurePlayerAvailability(player);
  }
  dateInput.value = "";
  persistAndRender();
});

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = playerInput.value.trim();
  if (!raw) {
    return;
  }
  const name = raw.slice(0, 40);
  if (state.players.includes(name)) {
    return;
  }
  state.players.push(name);
  ensurePlayerAvailability(name);
  playerInput.value = "";
  persistAndRender();
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Clear all players, dates, and availability?")) {
    return;
  }
  state.players = [];
  state.dates = [];
  state.availability = {};
  persistAndRender();
});

function persistAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function ensurePlayerAvailability(player) {
  if (!state.availability[player]) {
    state.availability[player] = {};
  }
  for (const date of state.dates) {
    if (typeof state.availability[player][date] !== "boolean") {
      state.availability[player][date] = false;
    }
  }
}

function removeDate(targetDate) {
  state.dates = state.dates.filter((d) => d !== targetDate);
  for (const player of state.players) {
    if (state.availability[player]) {
      delete state.availability[player][targetDate];
    }
  }
  persistAndRender();
}

function removePlayer(targetPlayer) {
  state.players = state.players.filter((p) => p !== targetPlayer);
  delete state.availability[targetPlayer];
  persistAndRender();
}

function toggleAvailability(player, date) {
  state.availability[player][date] = !state.availability[player][date];
  persistAndRender();
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
      chip.innerHTML = `
        <span>${formatDate(date)}</span>
        <button class="remove" aria-label="Remove ${date}" type="button">x</button>
      `;
      chip.querySelector(".remove").addEventListener("click", () => removeDate(date));
      dateList.appendChild(chip);
    }
  }

  if (!state.players.length) {
    playerList.innerHTML = '<p class="empty">No players yet.</p>';
  } else {
    for (const player of state.players) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `
        <span>${escapeHtml(player)}</span>
        <button class="remove" aria-label="Remove ${player}" type="button">x</button>
      `;
      chip.querySelector(".remove").addEventListener("click", () => removePlayer(player));
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
    ensurePlayerAvailability(player);
    const row = document.createElement("tr");
    row.appendChild(document.createElement("td")).textContent = player;

    for (const date of state.dates) {
      const td = document.createElement("td");
      const available = Boolean(state.availability[player][date]);
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
      return {
        date,
        count: available.length,
        available
      };
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

function render() {
  renderChips();
  renderBoard();
  renderResults();
}

function loadState() {
  const fallback = { players: [], dates: [], availability: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    return {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      dates: Array.isArray(parsed.dates) ? parsed.dates : [],
      availability: parsed.availability && typeof parsed.availability === "object" ? parsed.availability : {}
    };
  } catch {
    return fallback;
  }
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
