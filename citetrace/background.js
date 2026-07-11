/**
 * CiteTrace background service worker.
 *
 * Responsibilities (deliberately tiny):
 *  1. Make chrome.storage.session readable from content scripts
 *     (setAccessLevel — without this, the forensics content script on the
 *     source page could not read the trace job written on the chat page).
 *  2. Open the source tab on behalf of the capture content script
 *     (content scripts cannot call chrome.tabs.create themselves).
 *
 * The worker performs ZERO network requests.
 */

// Called at top level so it runs on every service-worker start
// (the access level does not reliably persist across browser restarts).
try {
  chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
  });
} catch (e) {
  // Older Chrome without setAccessLevel: tracing across tabs will not work,
  // but nothing crashes.
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

  if (msg.type === "CITETRACE_OPEN_TRACE") {
    // Persist the job first, then open the tab, so the sentinel on the new
    // tab can never race an unwritten job.
    const key = "citetrace_job_" + msg.job.jobId;
    chrome.storage.session
      .set({ [key]: msg.job })
      .then(() => chrome.tabs.create({ url: msg.url, active: true }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }

  return false;
});
