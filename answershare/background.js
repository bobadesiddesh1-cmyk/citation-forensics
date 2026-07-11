/**
 * AnswerShare background service worker.
 *
 * Responsibilities (deliberately tiny):
 *  1. Make chrome.storage.session readable from content scripts
 *     (trace/profile jobs are written on one page and read on another).
 *  2. Open tabs on behalf of content scripts and the dashboard
 *     (trace-the-winner and profile-my-page flows).
 *
 * The worker performs ZERO network requests.
 */

try {
  chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
  });
} catch (e) {
  /* older Chrome — cross-tab jobs won't work, nothing crashes */
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  } catch (e) {
    /* see above */
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  // Open a tab with a trace or profile job. Job is persisted BEFORE the tab
  // opens so the sentinel can never race an unwritten job.
  if (msg.type === "ANSWERSHARE_OPEN_JOB") {
    const key = "answershare_job_" + msg.job.jobId;
    chrome.storage.session
      .set({ [key]: msg.job })
      .then(() => chrome.tabs.create({ url: msg.url, active: true }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }

  // Open the dashboard (from popup or the capture toast).
  if (msg.type === "ANSWERSHARE_OPEN_DASHBOARD") {
    chrome.tabs
      .create({ url: chrome.runtime.getURL("dashboard/dashboard.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});
