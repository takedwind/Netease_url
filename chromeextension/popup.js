const state = {
  currentTarget: null,
  options: null
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.options = await getOptions();
  fillQualitySelects();
  bindEvents();
  await hydrateFromActiveTab();
  await hydratePendingTarget();
  await checkHealth(false);
  if (state.options.autoParseCurrentPage && state.currentTarget) {
    routeTargetToPanel(state.currentTarget);
  }
}

function fillQualitySelects() {
  const selects = [$("#quality"), $("#defaultQuality")];
  selects.forEach((select) => {
    select.innerHTML = Object.entries(QUALITY_LABELS)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    select.value = state.options.quality;
  });
  $("#autoParse").checked = Boolean(state.options.autoParseCurrentPage);
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  $("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#checkHealth").addEventListener("click", () => checkHealth(true));
  $("#loadApiInfo").addEventListener("click", loadApiInfo);
  $("#parseSong").addEventListener("click", parseSong);
  $("#runSearch").addEventListener("click", runSearch);
  $("#parsePlaylist").addEventListener("click", parsePlaylist);
  $("#parseAlbum").addEventListener("click", parseAlbum);

  $("#searchKeyword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  $("#smartInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") parseSong();
  });
}

async function hydrateFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = extractNeteaseTarget(tab?.url || "");
  if (!target?.id) return;
  state.currentTarget = target;
  if (target.type === "song") $("#smartInput").value = target.url;
  if (target.type === "playlist") $("#playlistInput").value = target.url;
  if (target.type === "album") $("#albumInput").value = target.url;
}

async function hydratePendingTarget() {
  const { pendingTarget } = await chrome.storage.local.get("pendingTarget");
  if (!pendingTarget?.id) return;
  state.currentTarget = pendingTarget;
  if (pendingTarget.type === "song") $("#smartInput").value = pendingTarget.url || pendingTarget.id;
  if (pendingTarget.type === "playlist") $("#playlistInput").value = pendingTarget.url || pendingTarget.id;
  if (pendingTarget.type === "album") $("#albumInput").value = pendingTarget.url || pendingTarget.id;
  await chrome.storage.local.remove("pendingTarget");
}

function routeTargetToPanel(target) {
  if (target.type === "playlist") {
    activateTab("playlist");
    parsePlaylist();
  } else if (target.type === "album") {
    activateTab("album");
    parseAlbum();
  } else {
    activateTab("smart");
    parseSong();
  }
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === name));
}

async function saveSettings() {
  const options = {
    quality: $("#defaultQuality").value,
    autoParseCurrentPage: $("#autoParse").checked
  };
  await setOptions(options);
  state.options = await getOptions();
  $("#quality").value = state.options.quality;
  renderNotice($("#serviceResult"), "设置已保存。");
}

async function checkHealth(showResult) {
  try {
    const result = await getHealth();
    $("#statusText").textContent = "内置服务正常，已连接网易云接口";
    if (showResult) renderJson($("#serviceResult"), result);
  } catch (error) {
    $("#statusText").textContent = "网易云接口不可用";
    if (showResult) renderError($("#serviceResult"), error);
  }
}

async function loadApiInfo() {
  try {
    renderJson($("#serviceResult"), await getApiInfo());
  } catch (error) {
    renderError($("#serviceResult"), error);
  }
}

async function parseSong() {
  const target = $("#smartInput").value.trim();
  const quality = $("#quality").value;
  if (!target) {
    renderNotice($("#songResult"), "请输入歌曲 ID 或链接。");
    return;
  }

  setLoading($("#songResult"), "正在解析歌曲...");
  try {
    const result = await getSong(target, quality, "json");
    renderSong($("#songResult"), result.data);
  } catch (error) {
    renderError($("#songResult"), error);
  }
}

async function runSearch() {
  const keyword = $("#searchKeyword").value.trim();
  const limit = Number($("#searchLimit").value || 20);
  if (!keyword) {
    renderNotice($("#searchResult"), "请输入搜索关键词。");
    return;
  }

  setLoading($("#searchResult"), "正在搜索...");
  try {
    const result = await searchSongs(keyword, limit);
    renderTrackList($("#searchResult"), result.data, "搜索结果");
  } catch (error) {
    renderError($("#searchResult"), error);
  }
}

async function parsePlaylist() {
  const target = $("#playlistInput").value.trim();
  if (!target) {
    renderNotice($("#playlistResult"), "请输入歌单 ID 或链接。");
    return;
  }

  setLoading($("#playlistResult"), "正在解析歌单...");
  try {
    const result = await getPlaylist(target);
    const playlist = result.data.playlist;
    renderTrackList($("#playlistResult"), playlist.tracks, playlist.name || "歌单");
  } catch (error) {
    renderError($("#playlistResult"), error);
  }
}

async function parseAlbum() {
  const target = $("#albumInput").value.trim();
  if (!target) {
    renderNotice($("#albumResult"), "请输入专辑 ID 或链接。");
    return;
  }

  setLoading($("#albumResult"), "正在解析专辑...");
  try {
    const result = await getAlbum(target);
    const album = result.data.album;
    renderTrackList($("#albumResult"), album.songs, album.name || "专辑");
  } catch (error) {
    renderError($("#albumResult"), error);
  }
}

function renderSong(container, song) {
  container.classList.remove("empty");
  container.innerHTML = `
    <div class="song-card">
      <img class="cover" src="${escapeAttr(song.pic || "")}" alt="">
      <div>
        <h2 class="title">${escapeHtml(song.name || "未知歌曲")}</h2>
        <div class="meta">${escapeHtml(song.ar_name || "")}<br>${escapeHtml(song.al_name || "")}</div>
        <div class="actions">
          <button data-action="download" data-id="${escapeAttr(song.id)}">浏览器下载</button>
          <button data-action="copy" data-url="${escapeAttr(song.url || "")}">复制链接</button>
          <button data-action="lyrics">歌词</button>
        </div>
      </div>
    </div>
    <pre class="lyrics" hidden>${escapeHtml(song.lyric || "暂无歌词")}</pre>
  `;
  bindActionButtons(container, song);
}

function renderTrackList(container, tracks, title) {
  const list = tracks || [];
  container.classList.remove("empty");
  if (!list.length) {
    renderNotice(container, "没有找到曲目。");
    return;
  }

  container.innerHTML = `
    <div class="meta">${escapeHtml(title)} · ${list.length} 首</div>
    <div class="list">
      ${list.map((track) => `
        <div class="list-item">
          <div>
            <div class="list-title">${escapeHtml(track.name || "未知歌曲")}</div>
            <div class="list-meta">${escapeHtml(track.artists || track.artist_string || "")} · ${escapeHtml(track.album || "")}</div>
          </div>
          <div class="actions">
            <button data-action="fill" data-id="${escapeAttr(track.id)}">解析</button>
            <button data-action="download" data-id="${escapeAttr(track.id)}">下载</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
  bindActionButtons(container);
}

function bindActionButtons(container, song) {
  container.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const id = button.dataset.id || song?.id;
      if (action === "download") {
        await chrome.runtime.sendMessage({
          type: "download-song",
          id,
          quality: $("#quality").value
        });
      }
      if (action === "copy") {
        await navigator.clipboard.writeText(button.dataset.url || "");
      }
      if (action === "fill") {
        activateTab("smart");
        $("#smartInput").value = id;
        parseSong();
      }
      if (action === "lyrics") {
        const lyrics = container.querySelector(".lyrics");
        lyrics.hidden = !lyrics.hidden;
      }
    });
  });
}

function setLoading(container, text) {
  container.classList.add("empty");
  container.textContent = text;
}

function renderNotice(container, text) {
  container.classList.remove("empty");
  container.innerHTML = `<div class="notice">${escapeHtml(text)}</div>`;
}

function renderError(container, error) {
  renderNotice(container, error.message || String(error));
}

function renderJson(container, data) {
  container.classList.remove("empty");
  container.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
