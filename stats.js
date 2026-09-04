function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("ru-RU");
}

function formatHoursSpan(h) {
  if (h == null || isNaN(h)) return "—";
  if (h >= 24) return (h / 24).toFixed(1) + " дн.";
  return h.toFixed(1) + " ч.";
}

function computeStats(accountId, history) {
  const own = history
    .filter((e) => e.accountId === accountId)
    .sort((a, b) => a.markedAt - b.markedAt);

  const count = own.length;

  // Эмпирический интервал: сколько времени реально проходит между
  // последовательными отметками "лимит кончился" на этом аккаунте.
  const intervals = [];
  for (let i = 1; i < own.length; i++) {
    intervals.push((own[i].markedAt - own[i - 1].markedAt) / 3600000);
  }
  const avgEmpirical = intervals.length
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length
    : null;

  const plannedHoursList = own.filter((e) => e.plannedHours != null).map((e) => e.plannedHours);
  const avgPlanned = plannedHoursList.length
    ? plannedHoursList.reduce((a, b) => a + b, 0) / plannedHoursList.length
    : null;

  return { count, avgEmpirical, avgPlanned, recentEvents: own.slice(-8).reverse() };
}

function render(accounts, history) {
  const root = document.getElementById("statsRoot");
  root.innerHTML = "";

  if (!accounts.length) {
    root.innerHTML = '<div class="empty-state">Нет аккаунтов. Добавьте их в попапе расширения.</div>';
    return;
  }

  accounts.forEach((acc) => {
    const s = computeStats(acc.id, history);
    const card = document.createElement("div");
    card.className = "stats-card";

    const eventsHtml = s.recentEvents.length
      ? s.recentEvents.map((e) => {
          const right = e.resolvedAt
            ? "сброшен " + formatDateTime(e.resolvedAt)
            : "ещё ограничен / нет данных о сбросе";
          return `<div class="event-row"><span>${formatDateTime(e.markedAt)}</span><span>${right}</span></div>`;
        }).join("")
      : '<div class="event-row muted">Пока нет записей — статистика появится после первой отметки лимита</div>';

    card.innerHTML = `
      <div class="stats-header">
        <div class="avatar" style="background:${acc.color}">${escapeHtml((acc.name.trim()[0] || "?").toUpperCase())}</div>
        <div class="stats-name">${escapeHtml(acc.name)}</div>
      </div>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">${s.count}</div>
          <div class="stat-label">раз лимит кончался</div>
        </div>
        <div class="stat">
          <div class="stat-value">${formatHoursSpan(s.avgEmpirical)}</div>
          <div class="stat-label">эмпирический интервал между отметками</div>
        </div>
        <div class="stat">
          <div class="stat-value">${formatHoursSpan(s.avgPlanned)}</div>
          <div class="stat-label">средний заявленный период сброса</div>
        </div>
      </div>
      <div class="events-list">${eventsHtml}</div>
    `;
    root.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const state = await Storage.getState();
  const accounts = state.accounts || [];
  let history = await Storage.getHistory();
  render(accounts, history);

  document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
    if (confirm("Очистить всю историю отметок лимита? Это действие необратимо.")) {
      await Storage.clearHistory();
      history = await Storage.getHistory();
      render(accounts, history);
    }
  });
});
