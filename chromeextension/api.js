const DEFAULT_OPTIONS = {
  quality: "standard",
  autoParseCurrentPage: true,
  downloadMode: "browser"
};

const QUALITY_LABELS = {
  standard: "标准",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res",
  sky: "沉浸环绕",
  jyeffect: "高清环绕",
  jymaster: "超清母带",
  dolby: "杜比全景声"
};

const NETEASE_ORIGIN = "https://music.163.com";

function encodeQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  return search.toString();
}

function extractNeteaseTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/&amp;/g, "&");
  const idMatch = normalized.match(/[?&#]id=(\d+)/) || normalized.match(/\b(?:song|playlist|album)\?id=(\d+)/);
  const plainId = normalized.match(/^\d+$/);
  let type = "song";

  if (/\/playlist\b|#\/playlist\b/i.test(normalized)) {
    type = "playlist";
  } else if (/\/album\b|#\/album\b/i.test(normalized)) {
    type = "album";
  } else if (/\/song\b|#\/song\b/i.test(normalized)) {
    type = "song";
  }

  const id = idMatch ? idMatch[1] : plainId ? normalized : "";
  return {
    raw,
    type,
    id,
    url: normalized,
    isNetease: /music\.163\.com|163cn\.tv/i.test(normalized) || Boolean(plainId)
  };
}

async function getOptions() {
  const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  return {
    ...DEFAULT_OPTIONS,
    ...stored
  };
}

async function setOptions(nextOptions) {
  await chrome.storage.sync.set(nextOptions);
}

async function neteaseFetch(path, options = {}) {
  const response = await fetch(`${NETEASE_ORIGIN}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${NETEASE_ORIGIN}/`,
      ...(options.headers || {})
    },
    body: options.body ? new URLSearchParams(options.body).toString() : undefined
  });

  if (!response.ok) {
    throw new Error(`网易云请求失败：${response.status}`);
  }
  return response.json();
}

function ok(data, message = "success") {
  return {
    status: 200,
    success: true,
    message,
    data
  };
}

async function getHealth() {
  const result = await neteaseFetch("/api/search/get/web", {
    method: "POST",
    body: {
      s: "test",
      type: 1,
      limit: 1,
      offset: 0
    }
  });
  return ok({
    service: "chrome-extension",
    target: "music.163.com",
    upstreamCode: result.code || 200
  }, "插件内置服务正常");
}

async function getApiInfo() {
  return ok({
    name: "网易云音乐智能助手内置服务",
    version: "1.0.0",
    endpoints: {
      health: "内置健康检查",
      song: "歌曲详情、歌词、外链播放地址",
      search: "歌曲搜索",
      playlist: "歌单详情",
      album: "专辑详情",
      download: "浏览器下载"
    },
    supported_qualities: Object.keys(QUALITY_LABELS),
    note: "独立插件不依赖后端；标准播放/下载使用网易云网页外链接口，高音质能力受当前账号和网易云接口限制。"
  }, "接口信息获取成功");
}

async function getSong(target, quality = "standard", type = "json") {
  const parsed = extractNeteaseTarget(target);
  const id = parsed?.id || String(target || "").trim();
  if (!id) {
    throw new Error("缺少歌曲 ID 或链接");
  }

  if (type === "url") {
    return ok(makeSongUrlPayload(id, quality), "获取歌曲 URL 成功");
  }

  if (type === "lyric") {
    return ok(await getLyric(id), "获取歌词成功");
  }

  const detail = await neteaseFetch("/api/v3/song/detail", {
    method: "POST",
    body: {
      c: JSON.stringify([{ id: Number(id), v: 0 }])
    }
  });
  const song = detail.songs?.[0];
  if (!song) {
    throw new Error("未找到歌曲信息");
  }

  if (type === "name") {
    return ok(detail, "获取歌曲信息成功");
  }

  const lyric = await getLyric(id).catch(() => ({}));
  return ok({
    id,
    name: song.name || "",
    ar_name: (song.ar || []).map((artist) => artist.name).join(", "),
    al_name: song.al?.name || "",
    pic: song.al?.picUrl || "",
    level: quality,
    lyric: lyric.lrc?.lyric || "",
    tlyric: lyric.tlyric?.lyric || "",
    url: getOuterSongUrl(id),
    size: "未知",
    source: "extension"
  }, "获取歌曲信息成功");
}

async function getLyric(id) {
  return neteaseFetch(`/api/song/lyric?${encodeQuery({
    id,
    lv: -1,
    kv: -1,
    tv: -1
  })}`);
}

function makeSongUrlPayload(id, quality) {
  return {
    id,
    url: getOuterSongUrl(id),
    level: quality,
    quality_name: QUALITY_LABELS[quality] || quality,
    size: 0,
    size_formatted: "未知",
    type: "mp3",
    bitrate: null
  };
}

function getOuterSongUrl(id) {
  return `${NETEASE_ORIGIN}/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`;
}

async function searchSongs(keyword, limit = 20) {
  if (!keyword) {
    throw new Error("请输入搜索关键词");
  }
  const result = await neteaseFetch("/api/cloudsearch/pc", {
    method: "POST",
    body: {
      s: keyword,
      type: 1,
      limit,
      offset: 0,
      total: true
    }
  });
  const songs = (result.result?.songs || []).map((song) => ({
    id: song.id,
    name: song.name,
    artists: (song.ar || song.artists || []).map((artist) => artist.name).join(", "),
    album: song.al?.name || song.album?.name || "",
    picUrl: song.al?.picUrl || song.album?.picUrl || ""
  }));
  return ok(songs, "搜索完成");
}

async function getPlaylist(idOrUrl) {
  const parsed = extractNeteaseTarget(idOrUrl);
  const id = parsed?.id || String(idOrUrl || "").trim();
  if (!id) {
    throw new Error("缺少歌单 ID 或链接");
  }
  const result = await neteaseFetch("/api/v6/playlist/detail", {
    method: "POST",
    body: {
      id,
      n: 100000,
      s: 8
    }
  });
  return ok({
    status: "success",
    playlist: normalizePlaylist(result.playlist || result)
  }, "获取歌单详情成功");
}

async function getAlbum(idOrUrl) {
  const parsed = extractNeteaseTarget(idOrUrl);
  const id = parsed?.id || String(idOrUrl || "").trim();
  if (!id) {
    throw new Error("缺少专辑 ID 或链接");
  }
  const result = await neteaseFetch(`/api/v1/album/${encodeURIComponent(id)}`);
  return ok({
    status: 200,
    album: normalizeAlbum(result.album || {}, result.songs || [])
  }, "获取专辑详情成功");
}

function normalizePlaylist(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    creator: playlist.creator?.nickname || "",
    description: playlist.description || "",
    coverImgUrl: playlist.coverImgUrl || "",
    trackCount: playlist.trackCount || playlist.tracks?.length || 0,
    tracks: (playlist.tracks || []).map(normalizeTrack)
  };
}

function normalizeAlbum(album, songs) {
  return {
    id: album.id,
    name: album.name,
    artist: album.artist?.name || (album.artists || []).map((artist) => artist.name).join(", "),
    description: album.description || album.briefDesc || "",
    coverImgUrl: album.picUrl || "",
    songs: (songs || []).map(normalizeTrack)
  };
}

function normalizeTrack(song) {
  return {
    id: song.id,
    name: song.name,
    artists: (song.ar || song.artists || []).map((artist) => artist.name).join(", "),
    album: song.al?.name || song.album?.name || "",
    picUrl: song.al?.picUrl || song.album?.picUrl || ""
  };
}

async function downloadToNas() {
  throw new Error("独立插件没有 NAS 保存模式，请使用浏览器下载。");
}

async function buildDownloadUrl(id) {
  if (!id) {
    throw new Error("缺少歌曲 ID");
  }
  return getOuterSongUrl(id);
}

async function downloadSongPackage(id, quality) {
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
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name
    );
    localParts.push(localHeader, data);

    const centralHeader = concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  return concatBytes(
    ...localParts,
    ...centralParts,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  );
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
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
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
