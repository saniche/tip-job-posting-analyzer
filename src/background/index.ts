import * as auth from './auth';
import * as jobs from './jobs';
import type { Request, Response } from '../shared/messages';

async function handle(msg: Request): Promise<Response> {
  switch (msg.type) {
    case 'login':
      await auth.login(msg.username, msg.password);
      await jobs.resumePolling();
      return { ok: true };
    case 'logout':
      await auth.logout();
      return { ok: true };
    case 'authState':
      return { ok: true, data: { authenticated: (await auth.getToken()) !== null } };
    case 'submitActive': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab');
      await jobs.submitTab(tab);
      return { ok: true };
    }
    case 'clearFinished':
      await jobs.clearFinished();
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: Error) =>
      sendResponse({ ok: false, error: e.message, authRequired: e instanceof auth.AuthError }),
    );
  return true; // async response
});

// Keep polling alive across service-worker restarts
chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'watchdog') void jobs.resumePolling(); });
chrome.runtime.onStartup.addListener(() => void jobs.resumePolling());

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'analyze', title: 'Send job posting to the analyzer', contexts: ['page', 'selection'] });
  void jobs.resumePolling();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'analyze' && tab) void jobs.submitTab(tab, info.selectionText).catch((e) => { console.error(e); void jobs.flashError(); });
});
