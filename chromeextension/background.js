importScripts("api.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "parse-link",
    title: "解析网易云链接",
    contexts: ["link", "selection", "page"]
  });
  chrome.contextMenus.create({
    id: "download-link",
    title: "打包下载网易云歌曲",
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

  const songResponse = await getSong(id, quality, "json");
  const song = songResponse.data;
  const baseName = sanitizeFilename(`${song.ar_name || "未知歌手"} - ${song.name || id}`);
  const files = [];

  if (song.url) {
    const audio = await fetchBinary(song.url);
    files.push({
      path: `${baseName}/${baseName}.${guessAudioExtension(audio.contentType, song.url)}`,
      data: audio.bytes
    });
  }

  if (song.pic) {
    const cover = await fetchBinary(song.pic);
    files.push({
      path: `${baseName}/cover.${guessImageExtension(cover.contentType, song.pic)}`,
      data: cover.bytes
    });
  }

  files.push({
    path: `${baseName}/lyrics.lrc`,
    data: encodeText(song.lyric || "暂无歌词")
  });

  if (song.tlyric) {
    files.push({
      path: `${baseName}/translated-lyrics.lrc`,
      data: encodeText(song.tlyric)
    });
  }

  files.push({
    path: `${baseName}/info.json`,
    data: encodeText(JSON.stringify({
      id: song.id,
      name: song.name,
      artists: song.ar_name,
      album: song.al_name,
      quality,
      sourceUrl: song.url,
      cover: song.pic
    }, null, 2))
  });

  const zip = buildZip(files);
  const objectUrl = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const downloadId = await chrome.downloads.download({
    url: objectUrl,
    filename: `${baseName}.zip`,
    saveAs: false,
    conflictAction: "uniquify"
  });

  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return downloadId;
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`资源下载失败：${response.status}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    finalUrl: response.url
  };
}

function encodeText(text) {
  return new TextEncoder().encode(String(text));
}

function sanitizeFilename(value) {
  return String(value || "netease-song")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "netease-song";
}

function guessAudioExtension(contentType, url) {
  const lowered = `${contentType} ${url}`.toLowerCase();
  if (lowered.includes("flac")) return "flac";
  if (lowered.includes("mpeg") || lowered.includes("mp3")) return "mp3";
  if (lowered.includes("mp4") || lowered.includes("m4a")) return "m4a";
  if (lowered.includes("wav")) return "wav";
  return "mp3";
}

function guessImageExtension(contentType, url) {
  const lowered = `${contentType} ${url}`.toLowerCase();
  if (lowered.includes("png")) return "png";
  if (lowered.includes("webp")) return "webp";
  return "jpg";
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encodeText(file.path);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);
    const localHeader = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name
    );

    localParts.push(localHeader, data);

    const centralHeader = concatBytes(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0)
  );

  return concatBytes(...localParts, ...centralParts, endRecord);
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  parts.forEach((part) => {
    out.set(part, cursor);
    cursor += part.length;
  });
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
