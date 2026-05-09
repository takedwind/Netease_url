importScripts("api.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "parse-link",
    title: "解析网易云链接",
    contexts: ["link", "selection", "page"]
  });
  chrome.contextMenus.create({
    id: "download-link",
    title: "下载网易云歌曲",
    contexts: ["link", "selection", "page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const source = info.linkUrl || info.selectionText || tab?.url || "";
  const target = extractNeteaseTarget(source);
  if (!target?.isNetease) {
    await chrome.storage.local.set({
      lastError: "没有识别到网易云音乐链接或 ID"
    });
    return;
  }

  await chrome.storage.local.set({
    pendingTarget: target,
    pendingAt: Date.now()
  });

  if (info.menuItemId === "download-link" && target.type === "song" && target.id) {
    const options = await getOptions();
    await startBrowserDownload(target.id, options.quality);
    return;
  }

  if (chrome.action.openPopup) {
    try {
      await chrome.action.openPopup();
    } catch (error) {
      await chrome.storage.local.set({
        lastError: error.message
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "download-song") {
    startBrowserDownload(message.id, message.quality)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "open-popup-target") {
    chrome.storage.local.set({
      pendingTarget: message.target,
      pendingAt: Date.now()
    }).then(async () => {
      if (chrome.action.openPopup) {
        await chrome.action.openPopup().catch(() => undefined);
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

async function startBrowserDownload(id, quality) {
  if (!id) {
    throw new Error("缺少歌曲 ID");
  }
  const url = await buildDownloadUrl(id, quality);
  return chrome.downloads.download({
    url,
    saveAs: false,
    conflictAction: "uniquify"
  });
}
