/**
 * AnswerShare background service worker.
 *
 * Responsibilities:
 *  1. Make chrome.storage.session readable from content scripts.
 *  2. Open tabs on behalf of content scripts and the dashboard.
 *  3. Register the source-page forensics bundle DYNAMICALLY, only once the
 *     user grants the optional host permission ("Enable page analysis").
 *     The manifest therefore requests NO broad host permission — the three
 *     AI sites are the only declared content-script hosts — which keeps the
 *     extension out of Chrome's broad-host in-depth review.
 *
 * The worker performs ZERO network requests.
 */

const BROAD_ORIGINS = ["https://*/*", "http://*/*"];

// The forensics bundle that used to be a manifest <all_urls> content script.
// Registered at runtime only when the optional host permission is held.
const FORENSICS_SCRIPT = {
  id: "answershare-forensics",
  matches: ["https://*/*", "http://*/*"],
  js: [
    "content/sentinel.js",
    "shared/tokenizer.js",
    "shared/stoplist.js",
    "shared/storage.js",
    "shared/report.js",
    "content/extract.js",
    "content/matcher.js",
    "content/citability.js",
    "content/highlighter.js",
    "content/panel.js",
    "content/main.js",
  ],
  runAt: "document_end",
  allFrames: false,
  persistAcrossSessions: true,
};

function setSessionAccess() {
  try {
    chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  } catch (e) {
    /* older Chrome — cross-tab jobs won't work, nothing crashes */
  }
}

async function hasAnalysisPermission() {
  try {
    return await chrome.permissions.contains({ origins: BROAD_ORIGINS });
  } catch (e) {
    return false;
  }
}

/** Register the forensics bundle iff the permission is held and it isn't already. */
async function syncForensicsRegistration() {
  try {
    const granted = await hasAnalysisPermission();
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [FORENSICS_SCRIPT.id],
    });
    const isRegistered = existing.length > 0;

    if (granted && !isRegistered) {
      await chrome.scripting.registerContentScripts([FORENSICS_SCRIPT]);
    } else if (!granted && isRegistered) {
      await chrome.scripting.unregisterContentScripts({ ids: [FORENSICS_SCRIPT.id] });
    }
  } catch (e) {
    /* registration races on SW restart are harmless — next event re-syncs */
  }
}

setSessionAccess();
syncForensicsRegistration();

chrome.runtime.onInstalled.addListener(() => {
  setSessionAccess();
  syncForensicsRegistration();
});
chrome.runtime.onStartup.addListener(() => {
  setSessionAccess();
  syncForensicsRegistration();
});

// React to the user granting/revoking the optional permission from anywhere
// (dashboard button, or chrome://extensions site-access controls).
chrome.permissions.onAdded.addListener(syncForensicsRegistration);
chrome.permissions.onRemoved.addListener(syncForensicsRegistration);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  // Content script (inline 🔎 Why? button) asks whether analysis is enabled.
  if (msg.type === "ANSWERSHARE_HAS_PERMISSION") {
    hasAnalysisPermission().then((granted) => sendResponse({ granted }));
    return true;
  }

  // Dashboard tells us it just granted the permission — register immediately
  // (don't wait for the onAdded event, which can lag).
  if (msg.type === "ANSWERSHARE_PERMISSION_GRANTED") {
    syncForensicsRegistration().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Open a trace/profile job. Requires the permission so the registered
  // forensics script will actually run on the opened tab.
  if (msg.type === "ANSWERSHARE_OPEN_JOB") {
    (async () => {
      try {
        if (!(await hasAnalysisPermission())) {
          sendResponse({ ok: false, needPermission: true });
          return;
        }
        await chrome.storage.session.set({
          ["answershare_job_" + msg.job.jobId]: msg.job,
        });
        await syncForensicsRegistration(); // belt-and-braces before navigation
        await chrome.tabs.create({ url: msg.url, active: true });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
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
