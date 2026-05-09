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
