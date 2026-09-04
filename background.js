importScripts("shared/storage.js");

const ALARM_NAME = "check_limits";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  checkAndNotify();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkAndNotify();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "ACCOUNTS_UPDATED") {
    updateBadge();
  }
});

// Реагируем и на изменения, пришедшие синхронизацией с другого компьютера,
// чтобы бейдж на иконке обновился, даже если попап никто не открывал.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "sync" || areaName === "local") && changes.accounts) {
    updateBadge(changes.accounts.newValue);
  }
});

async function checkAndNotify() {
  const state = await Storage.getState();
  const accounts = state.accounts || [];
  const settings = state.settings || { notifications: true };
  const now = Date.now();
  let changed = false;

  for (const a of accounts) {
    if (a.limited && a.resetAt && a.resetAt <= now) {
      a.limited = false;
      a.resetAt = null;
      changed = true;
      await Storage.closeOpenEvent(a.id, { resolvedAt: now });
      if (settings.notifications !== false) {
        chrome.notifications.create("reset_" + a.id + "_" + now, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Лимит сброшен",
          message: `Аккаунт «${a.name}» — лимит Gemini Pro снова доступен.`,
          priority: 1
        });
      }
    }
  }

  if (changed) {
    await Storage.setAccounts(accounts);
  }
  updateBadge(accounts);
}

async function updateBadge(accountsArg) {
  let accounts = accountsArg;
  if (!accounts) {
    const state = await Storage.getState();
    accounts = state.accounts || [];
  }
  const limitedCount = accounts.filter((a) => a.limited).length;
  chrome.action.setBadgeText({ text: limitedCount > 0 ? String(limitedCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#e05252" });
}
