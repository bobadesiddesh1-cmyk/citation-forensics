/**
 * AnswerShare storage — records, profiles, settings, jobs.
 * All chrome.storage, all local to the browser. No record ever contains
 * page text from sources; answer text is kept (trimmed) because the
 * win/loss trace needs it, and it's the user's own chat content.
 *
 * chrome.storage.session : in-flight trace/profile jobs
 * chrome.storage.local   :
 *   answershare_records  — captured answers (cap 2000, FIFO)
 *   answershare_profiles — saved page profiles (cap 200, FIFO)
 *   answershare_settings — domains, competitors, topics, toggles
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {}); // shared engine namespace
  if (NS.ASStorage) return;

  const RECORDS_KEY = "answershare_records";
  const PROFILES_KEY = "answershare_profiles";
  const SETTINGS_KEY = "answershare_settings";
  const JOB_PREFIX = "answershare_job_";
  const RECORDS_CAP = 2000;
  const PROFILES_CAP = 200;
  const ANSWER_TEXT_CAP = 15000; // chars kept per record for later tracing

  const DEFAULT_SETTINGS = {
    myDomains: [],
    competitorDomains: [],
    topics: [], // [{name, keywords: []}]
    enableChatgpt: true,
    enablePerplexity: true,
    enableGemini: true,
    captureToasts: true,
  };

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  // ── jobs (session) ────────────────────────────────────────────────────

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

  // ── captured answer records ───────────────────────────────────────────

  /**
   * record: { id, ts, query, aiSite,
   *           citations: [{url, domain, rank, title}],
   *           answerText }   (answerText trimmed to ANSWER_TEXT_CAP)
   */
  async function addRecord(record) {
    if (!hasChrome()) return false;
    const data = await chrome.storage.local.get(RECORDS_KEY);
    const list = Array.isArray(data[RECORDS_KEY]) ? data[RECORDS_KEY] : [];
    // dedupe: same site + query + citation domain set already captured
    const sig = signature(record);
    if (list.some((r) => signature(r) === sig)) return false;
    record.answerText = (record.answerText || "").slice(0, ANSWER_TEXT_CAP);
    list.push(record);
    while (list.length > RECORDS_CAP) list.shift();
    await chrome.storage.local.set({ [RECORDS_KEY]: list });
    return true;
  }

  function signature(r) {
    const domains = (r.citations || [])
      .map((c) => c.domain)
      .sort()
      .join(",");
    return (r.aiSite || "") + "|" + (r.query || "").trim().toLowerCase() + "|" + domains;
  }

  async function getRecords() {
    if (!hasChrome()) return [];
    const data = await chrome.storage.local.get(RECORDS_KEY);
    return Array.isArray(data[RECORDS_KEY]) ? data[RECORDS_KEY] : [];
  }

  async function deleteRecord(id) {
    if (!hasChrome()) return;
    const list = (await getRecords()).filter((r) => r.id !== id);
    await chrome.storage.local.set({ [RECORDS_KEY]: list });
  }

  async function clearRecords() {
    if (!hasChrome()) return;
    await chrome.storage.local.remove(RECORDS_KEY);
  }

  // ── page profiles (win/loss evidence) ────────────────────────────────

  /**
   * profile: { id, ts, kind: "winner"|"mine", url, domain, query?,
   *            stats: {...citability-style stats...} }
   */
  async function addProfile(profile) {
    if (!hasChrome()) return;
    const data = await chrome.storage.local.get(PROFILES_KEY);
    const list = Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
    // newest profile for the same url+kind replaces the old one
    const filtered = list.filter(
      (p) => !(p.url === profile.url && p.kind === profile.kind)
    );
    filtered.push(profile);
    while (filtered.length > PROFILES_CAP) filtered.shift();
    await chrome.storage.local.set({ [PROFILES_KEY]: filtered });
  }

  async function getProfiles() {
    if (!hasChrome()) return [];
    const data = await chrome.storage.local.get(PROFILES_KEY);
    return Array.isArray(data[PROFILES_KEY]) ? data[PROFILES_KEY] : [];
  }

  async function clearProfiles() {
    if (!hasChrome()) return;
    await chrome.storage.local.remove(PROFILES_KEY);
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
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
  }

  // ── analytics helpers (pure, used by dashboard + popup) ──────────────

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function matchesDomainList(domain, list) {
    const d = (domain || "").toLowerCase();
    return (list || []).some((entry) => {
      const e = (entry || "").trim().toLowerCase().replace(/^www\./, "");
      return e && (d === e || d.endsWith("." + e));
    });
  }

  /** Which topic (name) a query belongs to, or null. */
  function topicOf(query, topics) {
    const q = (query || "").toLowerCase();
    for (const t of topics || []) {
      if ((t.keywords || []).some((k) => k && q.includes(k.toLowerCase()))) {
        return t.name;
      }
    }
    return null;
  }

  NS.ASStorage = {
    getJob,
    deleteJob,
    addRecord,
    getRecords,
    deleteRecord,
    clearRecords,
    addProfile,
    getProfiles,
    clearProfiles,
    getSettings,
    setSettings,
    domainOf,
    matchesDomainList,
    topicOf,
    RECORDS_CAP,
    PROFILES_CAP,
    DEFAULT_SETTINGS,
  };
})();
