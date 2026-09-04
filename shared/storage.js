/*
 * Единый слой доступа к данным.
 *
 * accounts / settings — храним в chrome.storage.sync, чтобы список
 * аккаунтов и их состояние синхронизировались между компьютерами.
 * У sync жёсткие лимиты (около 8KB на один ключ, 100KB всего), поэтому
 * если запись не помещается — тихо дублируем в chrome.storage.local,
 * чтобы данные точно не потерялись, и возвращаем ok:false вызывающему
 * коду (попап показывает предупреждение).
 *
 * history — история отметок "лимит кончился" по каждому аккаунту, нужна
 * для страницы статистики. Растёт со временем и не критична для синхронизации
 * между устройствами, поэтому лежит в chrome.storage.local (без лимита в 8KB
 * на ключ) с мягким ограничением по количеству записей.
 */

const HISTORY_KEY = "history";
const MIGRATION_FLAG = "migratedToSyncV1";
const HISTORY_LIMIT = 500;

function promisify(fn, thisArg, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(thisArg, ...args, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "storage error"));
      } else {
        resolve(result);
      }
    });
  });
}

const Storage = {
  _migrated: false,

  async migrateIfNeeded() {
    if (this._migrated) return;
    const flagData = await promisify(chrome.storage.local.get, chrome.storage.local, [MIGRATION_FLAG]);
    if (flagData[MIGRATION_FLAG]) {
      this._migrated = true;
      return;
    }
    const local = await promisify(chrome.storage.local.get, chrome.storage.local, ["accounts", "settings"]);
    const sync = await promisify(chrome.storage.sync.get, chrome.storage.sync, ["accounts", "settings"]);
    if (!sync.accounts && local.accounts) {
      try {
        await promisify(chrome.storage.sync.set, chrome.storage.sync, {
          accounts: local.accounts,
          settings: local.settings || {}
        });
      } catch (e) {
        console.warn("Не удалось перенести данные в chrome.storage.sync, остаются в local:", e);
      }
    }
    await promisify(chrome.storage.local.set, chrome.storage.local, { [MIGRATION_FLAG]: true });
    this._migrated = true;
  },

  async getState() {
    await this.migrateIfNeeded();
    const syncData = await promisify(chrome.storage.sync.get, chrome.storage.sync, ["accounts", "settings"]);
    if (syncData.accounts) return syncData;
    // Резервный вариант: если в sync пусто (например, запись туда не влезла
    // по квоте), но локально что-то есть — используем локальную копию.
    const localData = await promisify(chrome.storage.local.get, chrome.storage.local, ["accounts", "settings"]);
    return { accounts: localData.accounts, settings: { ...(syncData.settings || {}), ...(localData.settings || {}) } };
  },

  async setAccounts(accounts) {
    try {
      await promisify(chrome.storage.sync.set, chrome.storage.sync, { accounts });
      return { ok: true };
    } catch (e) {
      await promisify(chrome.storage.local.set, chrome.storage.local, { accounts });
      return { ok: false, error: String(e.message || e) };
    }
  },

  async setSettings(settings) {
    try {
      await promisify(chrome.storage.sync.set, chrome.storage.sync, { settings });
      return { ok: true };
    } catch (e) {
      await promisify(chrome.storage.local.set, chrome.storage.local, { settings });
      return { ok: false, error: String(e.message || e) };
    }
  },

  async getHistory() {
    const data = await promisify(chrome.storage.local.get, chrome.storage.local, [HISTORY_KEY]);
    return data[HISTORY_KEY] || [];
  },

  async addHistoryEvent(event) {
    const history = await this.getHistory();
    history.push(event);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    await promisify(chrome.storage.local.set, chrome.storage.local, { [HISTORY_KEY]: history });
    return history;
  },

  // Находит последнюю незакрытую запись для аккаунта (resolvedAt == null)
  // и дополняет её — используется, когда лимит реально сбрасывается.
  async closeOpenEvent(accountId, patch) {
    const history = await this.getHistory();
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].accountId === accountId && !history[i].resolvedAt) {
        Object.assign(history[i], patch);
        break;
      }
    }
    await promisify(chrome.storage.local.set, chrome.storage.local, { [HISTORY_KEY]: history });
    return history;
  },

  async clearHistory() {
    await promisify(chrome.storage.local.set, chrome.storage.local, { [HISTORY_KEY]: [] });
  },

  async exportAll() {
    const state = await this.getState();
    const history = await this.getHistory();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: state.accounts || [],
      settings: state.settings || {},
      history
    };
  },

  // mode: "replace" — полностью заменить аккаунты/настройки;
  // "merge" — объединить по id аккаунта (импортированные перезаписывают
  // совпадающие id, остальные существующие остаются).
  async importAll(payload, mode) {
    if (!payload || !Array.isArray(payload.accounts)) {
      throw new Error("В файле не найден список accounts.");
    }
    let accounts = payload.accounts;
    let settings = payload.settings || {};
    let history = Array.isArray(payload.history) ? payload.history : [];

    if (mode === "merge") {
      const current = await this.getState();
      const currentAccounts = current.accounts || [];
      const byId = new Map(currentAccounts.map((a) => [a.id, a]));
      accounts.forEach((a) => byId.set(a.id, a));
      accounts = Array.from(byId.values());
      settings = { ...(current.settings || {}), ...settings };
      const currentHistory = await this.getHistory();
      history = currentHistory.concat(history);
    }

    const accResult = await this.setAccounts(accounts);
    const setResult = await this.setSettings(settings);
    await promisify(chrome.storage.local.set, chrome.storage.local, {
      [HISTORY_KEY]: history.slice(-HISTORY_LIMIT)
    });
    return { accounts, settings, syncOk: accResult.ok && setResult.ok };
  }
};
