const COLORS = [
  "#f4511e", "#e91e63", "#8e44ad", "#5e35b1",
  "#3f51b5", "#4285f4", "#039be5", "#00897b",
  "#43a047", "#c0ca33", "#f9a825", "#6d4c41"
];

let state = {
  accounts: [],
  settings: { defaultPeriodHours: 24, notifications: true, sortLimitedFirst: true, autoClipboard: true }
};

let editingAccountId = null;   // для модалки добавления/редактирования аккаунта
let periodAccountId = null;    // для модалки ввода периода
let menuAccountId = null;      // для модалки меню
let selectedColor = COLORS[0];
let tickTimer = null;

function uid() {
  return "acc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function seedDefaults() {
  const names = [
    "Николай Федотов", "Петр Иванов", "Nikita Kolyada", "Foma Creative",
    "Bosmer&Danmer", "FOMA-BLOG BACKUP", "Nik", "Nikita Kolyada",
    "Nikita Kolyada", "Nikita Active", "Vera Kolyada", "Nikita Rurikovich"
  ];
  return names.map((n, i) => ({
    id: uid(),
    name: n,
    email: "",
    color: COLORS[i % COLORS.length],
    limited: false,
    resetAt: null,
    periodHours: null,
    autoPeriod: false
  }));
}

async function load() {
  const data = await Storage.getState();
  if (data.accounts && data.accounts.length) {
    state.accounts = data.accounts;
  } else {
    state.accounts = seedDefaults();
    await persistAccounts();
  }
  if (data.settings && Object.keys(data.settings).length) {
    state.settings = { ...state.settings, ...data.settings };
  } else {
    await persistSettings();
  }
  document.getElementById("defaultPeriod").value = state.settings.defaultPeriodHours;
  document.getElementById("notifToggle").checked = state.settings.notifications;
  document.getElementById("sortToggle").checked = state.settings.sortLimitedFirst;
  const autoCbEl = document.getElementById("autoClipboardToggle");
  if (autoCbEl) autoCbEl.checked = state.settings.autoClipboard !== false;
  render();
  startTicker();
}

async function persistAccounts() {
  const result = await Storage.setAccounts(state.accounts);
  chrome.runtime.sendMessage({ type: "ACCOUNTS_UPDATED" }).catch(() => {});
  if (!result.ok) {
    showSyncWarning();
  }
  return result;
}
async function persistSettings() {
  await Storage.setSettings(state.settings);
}

let syncWarningShown = false;
function showSyncWarning() {
  if (syncWarningShown) return;
  syncWarningShown = true;
  const el = document.getElementById("syncWarning");
  if (el) el.classList.remove("hidden");
}

function formatCountdown(ms) {
  if (ms <= 0) return "сброшен";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  let parts = [];
  if (days) parts.push(days + "д");
  if (hours || days) parts.push(hours + "ч");
  parts.push(mins + "м");
  return "через " + parts.join(" ");
}

function formatHours(h) {
  if (h >= 24 && h % 24 === 0) return (h / 24) + "д";
  if (h >= 24) return (h / 24).toFixed(1) + "д";
  return h + "ч";
}

function checkExpirations() {
  const now = Date.now();
  let changed = false;
  state.accounts.forEach((a) => {
    if (a.limited && a.resetAt && a.resetAt <= now) {
      a.limited = false;
      a.resetAt = null;
      changed = true;
      Storage.closeOpenEvent(a.id, { resolvedAt: now });
    }
  });
  if (changed) persistAccounts();
  return changed;
}

function startTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const changed = checkExpirations();
    if (changed) render();
    else updateCountdownTexts();
  }, 1000 * 15);
}

function updateCountdownTexts() {
  document.querySelectorAll("[data-countdown-id]").forEach((el) => {
    const acc = state.accounts.find((a) => a.id === el.dataset.countdownId);
    if (acc && acc.limited && acc.resetAt) {
      el.textContent = formatCountdown(acc.resetAt - Date.now());
    }
  });
}

function sortedAccounts() {
  const list = [...state.accounts];
  if (state.settings.sortLimitedFirst) {
    list.sort((a, b) => {
      if (a.limited && b.limited) return (a.resetAt || 0) - (b.resetAt || 0);
      if (a.limited) return -1;
      if (b.limited) return 1;
      return 0;
    });
  }
  return list;
}

function openAccountInTab(acc) {
  const target = "https://gemini.google.com/app";
  const url = acc.email
    ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(acc.email)}&continue=${encodeURIComponent(target)}`
    : `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(target)}`;
  chrome.tabs.create({ url });
}

function render() {
  checkExpirations();
  const list = document.getElementById("accountsList");
  list.innerHTML = "";

  const accounts = sortedAccounts();
  if (!accounts.length) {
    list.innerHTML = '<div class="empty-state">Пока нет аккаунтов.<br/>Нажмите «Добавить аккаунт».</div>';
  }

  accounts.forEach((acc) => {
    const card = document.createElement("div");
    card.className = "account-card" + (acc.limited ? " limited" : "");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = acc.color;
    avatar.textContent = (acc.name.trim()[0] || "?").toUpperCase();

    const info = document.createElement("div");
    info.className = "account-info";
    const nameEl = document.createElement("div");
    nameEl.className = "account-name";
    nameEl.textContent = acc.name;
    const statusEl = document.createElement("div");
    if (acc.limited) {
      statusEl.className = "account-status limited-text";
      statusEl.dataset.countdownId = acc.id;
      statusEl.textContent = formatCountdown(acc.resetAt - Date.now());
    } else {
      statusEl.className = "account-status";
      statusEl.textContent = acc.autoPeriod && acc.periodHours
        ? `лимит доступен · автоинтервал ${formatHours(acc.periodHours)}`
        : "лимит доступен";
    }
    info.appendChild(nameEl);
    info.appendChild(statusEl);

    const toggleWrap = document.createElement("label");
    toggleWrap.className = "toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = acc.limited;
    cb.addEventListener("change", () => onToggleLimit(acc.id, cb.checked, cb));
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    toggleWrap.appendChild(cb);
    toggleWrap.appendChild(slider);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "open-btn";
    openBtn.title = "Открыть аккаунт в Gemini";
    openBtn.textContent = "↗";
    openBtn.addEventListener("click", () => openAccountInTab(acc));

    const menuBtn = document.createElement("button");
    menuBtn.className = "menu-dots";
    menuBtn.textContent = "⋮";
    menuBtn.addEventListener("click", () => openMenuModal(acc.id));

    actions.appendChild(openBtn);
    actions.appendChild(menuBtn);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(toggleWrap);
    card.appendChild(actions);
    list.appendChild(card);
  });

  const limitedCount = state.accounts.filter((a) => a.limited).length;
  document.getElementById("statsLine").textContent =
    `${state.accounts.length} аккаунт(ов) · ограничено: ${limitedCount}`;
}

async function recordLimitStart(acc) {
  await Storage.addHistoryEvent({
    id: uid(),
    accountId: acc.id,
    accountName: acc.name,
    markedAt: Date.now(),
    plannedResetAt: acc.resetAt,
    plannedHours: acc.periodHours,
    resolvedAt: null
  });
}

async function onToggleLimit(accId, checked, checkboxEl) {
  const acc = state.accounts.find((a) => a.id === accId);
  if (!acc) return;

  if (checked) {
    if (acc.autoPeriod && acc.periodHours) {
      // применяем сохранённый интервал без вопроса
      acc.limited = true;
      acc.resetAt = Date.now() + acc.periodHours * 60 * 60 * 1000;
      await recordLimitStart(acc);
      await persistAccounts();
      render();
    } else {
      // спрашиваем период, откатываем чекбокс пока не подтвердят
      checkboxEl.checked = false;
      openPeriodModal(accId);
    }
  } else {
    acc.limited = false;
    acc.resetAt = null;
    await Storage.closeOpenEvent(acc.id, { resolvedAt: Date.now(), resolvedEarly: true });
    await persistAccounts();
    render();
  }
}

/* ---------- Модалка: добавить/редактировать аккаунт ---------- */

function buildColorSwatches(container) {
  container.innerHTML = "";
  COLORS.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (c === selectedColor ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      selectedColor = c;
      buildColorSwatches(container);
    });
    container.appendChild(sw);
  });
}

function openAccountModal(accountId) {
  editingAccountId = accountId || null;
  const modal = document.getElementById("accountModal");
  const title = document.getElementById("accountModalTitle");
  const nameInput = document.getElementById("accountNameInput");
  const emailInput = document.getElementById("accountEmailInput");

  if (editingAccountId) {
    const acc = state.accounts.find((a) => a.id === editingAccountId);
    title.textContent = "Редактировать аккаунт";
    nameInput.value = acc.name;
    emailInput.value = acc.email || "";
    selectedColor = acc.color;
  } else {
    title.textContent = "Новый аккаунт";
    nameInput.value = "";
    emailInput.value = "";
    selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  buildColorSwatches(document.getElementById("colorSwatches"));
  modal.classList.remove("hidden");
  nameInput.focus();
}

function closeAccountModal() {
  document.getElementById("accountModal").classList.add("hidden");
  editingAccountId = null;
}

async function saveAccountModal() {
  const name = document.getElementById("accountNameInput").value.trim();
  const email = document.getElementById("accountEmailInput").value.trim();
  if (!name) return;

  if (editingAccountId) {
    const acc = state.accounts.find((a) => a.id === editingAccountId);
    acc.name = name;
    acc.email = email;
    acc.color = selectedColor;
  } else {
    state.accounts.push({
      id: uid(),
      name,
      email,
      color: selectedColor,
      limited: false,
      resetAt: null,
      periodHours: null,
      autoPeriod: false
    });
  }
  await persistAccounts();
  closeAccountModal();
  render();
}

/* ---------- Модалка: ввод периода ---------- */

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openPeriodModal(accountId) {
  periodAccountId = accountId;
  const acc = state.accounts.find((a) => a.id === accountId);
  document.getElementById("periodAccountName").textContent = acc.name;
  document.getElementById("pasteMessageInput").value = "";
  hideClipboardNotice();

  const defaultHours = state.settings.defaultPeriodHours || 24;
  const defaultDate = new Date(Date.now() + defaultHours * 60 * 60 * 1000);
  document.getElementById("resetAtInput").value = toDatetimeLocalValue(defaultDate);

  document.getElementById("rememberPeriodCheckbox").checked = false;
  document.getElementById("periodModal").classList.remove("hidden");

  // Автоматическая проверка буфера обмена при открытии панели
  if (state.settings.autoClipboard !== false) {
    tryAutoFillFromClipboard({ manual: false });
  }
}

function closePeriodModal() {
  document.getElementById("periodModal").classList.add("hidden");
  hideClipboardNotice();
  periodAccountId = null;
}

function showClipboardNotice(msg, isError = false) {
  const notice = document.getElementById("clipboardNotice");
  const noticeText = document.getElementById("clipboardNoticeText");
  if (!notice || !noticeText) return;
  noticeText.textContent = msg;
  if (isError) {
    notice.classList.add("error");
  } else {
    notice.classList.remove("error");
  }
  notice.classList.remove("hidden");
}

function hideClipboardNotice() {
  const notice = document.getElementById("clipboardNotice");
  if (notice) notice.classList.add("hidden");
}

async function tryAutoFillFromClipboard({ manual = false } = {}) {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    if (manual) showClipboardNotice("Буфер обмена недоступен в этом браузере", true);
    return false;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      if (manual) showClipboardNotice("Буфер обмена пуст", true);
      return false;
    }

    const d = parseResetDateFromText(text);
    if (d) {
      if (d.getTime() <= Date.now()) {
        if (manual) showClipboardNotice("Дата из буфера уже в прошлом", true);
        return false;
      }
      document.getElementById("pasteMessageInput").value = text.trim();
      document.getElementById("resetAtInput").value = toDatetimeLocalValue(d);
      showClipboardNotice("Дата сброса распознана и подставлена из буфера");
      return true;
    } else {
      if (manual) showClipboardNotice("В буфере нет подходящей даты или сообщения", true);
      return false;
    }
  } catch (err) {
    console.debug("Не удалось прочитать буфер обмена:", err);
    if (manual) showClipboardNotice("Нет доступа к буферу обмена", true);
    return false;
  }
}

// Распознаёт дату/время из текста сообщений Gemini / Antigravity
function parseResetDateFromText(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Относительное время: "через 4 часа", "try again in 2 hours 30 minutes", "in 4h 15m"
  const relRegex = /(?:refresh|reset|try again|available|доступен|обновится|сброс(?:ится)?|попробуйте(?: снова)?)\s+(?:in|через)\s+(?:(\d+)\s*(?:d|д|дн|дней|дня|days?))?\s*(?:(\d+)\s*(?:h|ч|час(?:а|ов)?|hours?))?\s*(?:(\d+)\s*(?:m|мин(?:ут[ыа]?)?|minutes?))?/i;
  const relMatch = text.match(relRegex);
  if (relMatch && (relMatch[1] || relMatch[2] || relMatch[3])) {
    const days = parseInt(relMatch[1] || "0", 10);
    const hours = parseInt(relMatch[2] || "0", 10);
    const mins = parseInt(relMatch[3] || "0", 10);
    const totalMs = ((days * 24 + hours) * 60 + mins) * 60 * 1000;
    if (totalMs > 0) {
      return new Date(Date.now() + totalMs);
    }
  }

  // 2. Месяц словом на русском: "4 сентября 2026 г., 15:01" или "4 сент. 2026, 15:01:30"
  const ruMonths = {
    "янв": 0, "фев": 1, "мар": 2, "апр": 3, "мая": 4, "май": 4,
    "июн": 5, "июл": 6, "авг": 7, "сен": 8, "окт": 9, "ноя": 10, "дек": 11
  };
  const ruMonthRegex = /(\d{1,2})\s+([а-яё]{3,8})\s+(\d{4})(?:\s*(?:г\.?|года))?,?\s*(?:в\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/i;
  const ruMatch = text.match(ruMonthRegex);
  if (ruMatch) {
    const day = parseInt(ruMatch[1], 10);
    const rawMonth = ruMatch[2].toLowerCase().slice(0, 3);
    const month = ruMonths[rawMonth];
    const year = parseInt(ruMatch[3], 10);
    const hour = parseInt(ruMatch[4], 10);
    const minute = parseInt(ruMatch[5], 10);
    const second = ruMatch[6] ? parseInt(ruMatch[6], 10) : 0;
    if (month !== undefined) {
      const d = new Date(year, month, day, hour, minute, second);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 3. Месяц словом на английском: "September 4, 2026, 3:01 PM"
  const enMonths = {
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
    "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11
  };
  const enMonthRegex = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;
  const enMatch = text.match(enMonthRegex);
  if (enMatch) {
    const month = enMonths[enMatch[1].toLowerCase().slice(0, 3)];
    const day = parseInt(enMatch[2], 10);
    const year = parseInt(enMatch[3], 10);
    let hour = parseInt(enMatch[4], 10);
    const minute = parseInt(enMatch[5], 10);
    const second = enMatch[6] ? parseInt(enMatch[6], 10) : 0;
    const ampm = enMatch[7];
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hour < 12) hour += 12;
      if (upper === "AM" && hour === 12) hour = 0;
    }
    if (month !== undefined) {
      const d = new Date(year, month, day, hour, minute, second);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 4. US формат: "9/4/2026, 3:01:35 PM" или "09/04/2026 15:01"
  const usRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;
  const usMatch = text.match(usRegex);
  if (usMatch) {
    let [, month, day, year, hour, minute, second, ampm] = usMatch;
    month = parseInt(month, 10);
    day = parseInt(day, 10);
    year = parseInt(year, 10);
    hour = parseInt(hour, 10);
    minute = parseInt(minute, 10);
    second = second ? parseInt(second, 10) : 0;
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hour < 12) hour += 12;
      if (upper === "AM" && hour === 12) hour = 0;
    }
    const d = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(d.getTime())) return d;
  }

  // 5. Русский / Европейский формат через точки: "04.09.2026, 15:01:35" или "04.09.2026 в 15:01"
  const euRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(?:в\s*|at\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/i;
  const euMatch = text.match(euRegex);
  if (euMatch) {
    let [, day, month, year, hour, minute, second] = euMatch;
    day = parseInt(day, 10);
    month = parseInt(month, 10);
    year = parseInt(year, 10);
    hour = parseInt(hour, 10);
    minute = parseInt(minute, 10);
    second = second ? parseInt(second, 10) : 0;
    const d = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(d.getTime())) return d;
  }

  // 6. ISO формат: "2026-09-04T15:01:35" или "2026-09-04 15:01"
  const isoRegex = /(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/i;
  const isoMatch = text.match(isoRegex);
  if (isoMatch) {
    let [, year, month, day, hour, minute, second] = isoMatch;
    year = parseInt(year, 10);
    month = parseInt(month, 10);
    day = parseInt(day, 10);
    hour = parseInt(hour, 10);
    minute = parseInt(minute, 10);
    second = second ? parseInt(second, 10) : 0;
    const d = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

async function savePeriodModal() {
  const val = document.getElementById("resetAtInput").value;
  if (!val) return;
  const resetAt = new Date(val).getTime();
  if (isNaN(resetAt) || resetAt <= Date.now()) {
    alert("Укажите дату/время в будущем.");
    return;
  }
  const remember = document.getElementById("rememberPeriodCheckbox").checked;

  const acc = state.accounts.find((a) => a.id === periodAccountId);
  const hours = (resetAt - Date.now()) / (60 * 60 * 1000);

  acc.limited = true;
  acc.resetAt = resetAt;
  acc.periodHours = Math.round(hours * 100) / 100;
  acc.autoPeriod = remember;

  await recordLimitStart(acc);
  await persistAccounts();
  closePeriodModal();
  render();
}

/* ---------- Модалка: меню аккаунта ---------- */

function openMenuModal(accountId) {
  menuAccountId = accountId;
  document.getElementById("menuModal").classList.remove("hidden");
}
function closeMenuModal() {
  document.getElementById("menuModal").classList.add("hidden");
  menuAccountId = null;
}

/* ---------- Экспорт / импорт ---------- */

async function exportData() {
  const payload = await Storage.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gemini-limits-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importDataFromFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  const merge = confirm(
    "OK — добавить импортированные аккаунты к текущим (объединение по id).\n" +
    "Отмена — полностью заменить текущий список аккаунтов импортированным."
  );
  const result = await Storage.importAll(payload, merge ? "merge" : "replace");
  state.accounts = result.accounts;
  state.settings = { ...state.settings, ...result.settings };
  render();
  if (!result.syncOk) showSyncWarning();
  alert("Импорт завершён" + (merge ? " (объединено)." : " (список заменён)."));
}

/* ---------- Инициализация событий ---------- */

document.addEventListener("DOMContentLoaded", () => {
  load();

  document.getElementById("addAccountBtn").addEventListener("click", () => openAccountModal(null));
  document.getElementById("accountModalCancel").addEventListener("click", closeAccountModal);
  document.getElementById("accountModalSave").addEventListener("click", saveAccountModal);

  document.getElementById("periodModalCancel").addEventListener("click", closePeriodModal);
  document.getElementById("periodModalSave").addEventListener("click", savePeriodModal);
  document.getElementById("parseMessageBtn").addEventListener("click", () => {
    const text = document.getElementById("pasteMessageInput").value;
    const d = parseResetDateFromText(text);
    if (d) {
      document.getElementById("resetAtInput").value = toDatetimeLocalValue(d);
      showClipboardNotice("Дата успешно распознана");
    } else {
      showClipboardNotice("Не удалось найти дату в тексте", true);
    }
  });
  // Автораспознавание сразу при вставке/вводе текста — без клика по кнопке
  document.getElementById("pasteMessageInput").addEventListener("input", (e) => {
    const d = parseResetDateFromText(e.target.value);
    if (d) {
      document.getElementById("resetAtInput").value = toDatetimeLocalValue(d);
      showClipboardNotice("Дата распознана из текста");
    } else {
      hideClipboardNotice();
    }
  });
  // Кнопка ручной вставки из буфера обмена
  const pasteCbBtn = document.getElementById("pasteClipboardBtn");
  if (pasteCbBtn) {
    pasteCbBtn.addEventListener("click", () => tryAutoFillFromClipboard({ manual: true }));
  }

  document.getElementById("menuClose").addEventListener("click", closeMenuModal);
  document.getElementById("menuEdit").addEventListener("click", () => {
    const id = menuAccountId;
    closeMenuModal();
    openAccountModal(id);
  });
  document.getElementById("menuEditPeriod").addEventListener("click", async () => {
    const acc = state.accounts.find((a) => a.id === menuAccountId);
    if (acc) {
      acc.autoPeriod = false;
      await persistAccounts();
    }
    closeMenuModal();
    render();
  });
  document.getElementById("menuResetNow").addEventListener("click", async () => {
    const acc = state.accounts.find((a) => a.id === menuAccountId);
    if (acc) {
      acc.limited = false;
      acc.resetAt = null;
      await Storage.closeOpenEvent(acc.id, { resolvedAt: Date.now(), resolvedEarly: true });
      await persistAccounts();
    }
    closeMenuModal();
    render();
  });
  document.getElementById("menuDelete").addEventListener("click", async () => {
    state.accounts = state.accounts.filter((a) => a.id !== menuAccountId);
    await persistAccounts();
    closeMenuModal();
    render();
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.toggle("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
  });
  document.getElementById("defaultPeriod").addEventListener("change", (e) => {
    state.settings.defaultPeriodHours = parseFloat(e.target.value) || 24;
    persistSettings();
  });
  document.getElementById("notifToggle").addEventListener("change", (e) => {
    state.settings.notifications = e.target.checked;
    persistSettings();
  });
  document.getElementById("sortToggle").addEventListener("change", (e) => {
    state.settings.sortLimitedFirst = e.target.checked;
    persistSettings();
    render();
  });
  const autoCbToggle = document.getElementById("autoClipboardToggle");
  if (autoCbToggle) {
    autoCbToggle.addEventListener("change", (e) => {
      state.settings.autoClipboard = e.target.checked;
      persistSettings();
    });
  }

  document.getElementById("statsBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
  });
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importDataFromFile(file);
    } catch (err) {
      alert("Не удалось импортировать файл: " + err.message);
    }
    e.target.value = "";
  });
});
