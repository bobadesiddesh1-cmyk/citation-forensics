/**
 * CiteTrace storage helpers — thin promise wrappers around chrome.storage.
 * Used by capture (chat page), forensics (source page) and the popup.
 *
 * chrome.storage.session : in-flight trace jobs (cleared when browser closes)
 * chrome.storage.local   : trace history (cap 200, FIFO) + settings
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Storage) return;

  const HISTORY_KEY = "citetrace_history";
  const SETTINGS_KEY = "citetrace_settings";
  const HISTORY_CAP = 200;
  const JOB_PREFIX = "citetrace_job_";

  const DEFAULT_SETTINGS = {
    enableChatgpt: true,
    enablePerplexity: true,
    enableGemini: true,
  };

  function hasChrome() {
    return (
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
    );
  }

  // ── trace jobs (session) ──────────────────────────────────────────────

  async function saveJob(job) {
    if (!hasChrome() || !chrome.storage.session) return false;
    await chrome.storage.session.set({ [JOB_PREFIX + job.jobId]: job });
    return true;
  }

  async function getJob(jobId) {
    if (!hasChrome() || !chrome.storage.session) return null;
    const key = JOB_PREFIX + jobId;
    const data = await chrome.storage.session.get(key);
    return data[key] || null;
  }

  async function deleteJob(jobId) {
    if (!hasChrome() || !chrome.storage.session) return;
    await chrome.storage.session.remove(JOB_PREFIX + jobId);
  }

  // ── history (local, cap 200 FIFO) ─────────────────────────────────────

  /**
   * entry: { date, aiSite, sourceUrl, sourceDomain,
   *          verbatimCount, paraphraseCount, coveragePct }
   */
  async function addHistory(entry) {
    if (!hasChrome()) return;
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const list = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
    list.push(entry);
    while (list.length > HISTORY_CAP) list.shift(); // FIFO: oldest out first
    await chrome.storage.local.set({ [HISTORY_KEY]: list });
  }

  async function getHistory() {
    if (!hasChrome()) return [];
    const data = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  }

  async function clearHistory() {
    if (!hasChrome()) return;
    await chrome.storage.local.remove(HISTORY_KEY);
  }

  // ── settings ──────────────────────────────────────────────────────────

  async function getSettings() {
    if (!hasChrome()) return { ...DEFAULT_SETTINGS };
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  }

  async function setSettings(patch) {
    if (!hasChrome()) return;
    const current = await getSettings();
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...current, ...patch },
    });
  }

  NS.Storage = {
    saveJob,
    getJob,
    deleteJob,
    addHistory,
    getHistory,
    clearHistory,
    getSettings,
    setSettings,
    HISTORY_CAP,
    DEFAULT_SETTINGS,
  };
})();
