let allHistory = [];

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshHistory").addEventListener("click", loadHistory);
  $("#clearHistory").addEventListener("click", clearAll);
  $("#historySearch").addEventListener("input", renderHistory);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.downloadHistory) {
      allHistory = changes.downloadHistory.newValue || [];
      renderHistory();
    }
  });
  await loadHistory();
});

async function loadHistory() {
  allHistory = await getDownloadHistory();
  renderHistory();
}

async function clearAll() {
  if (!confirm("确认清空下载历史？")) {
    return;
  }
  await clearDownloadHistory();
  allHistory = [];
  renderHistory();
}

function renderHistory() {
  const keyword = $("#historySearch").value.trim().toLowerCase();
  const filtered = allHistory.filter((item) => {
    const haystack = `${item.name || ""} ${item.artists || ""} ${item.album || ""}`.toLowerCase();
    return !keyword || haystack.includes(keyword);
  });

  $("#historyCount").textContent = `${filtered.length} / ${allHistory.length} 条记录`;
  const list = $("#historyList");
  if (!filtered.length) {
    list.innerHTML = `<div class="result empty">暂无下载历史。</div>`;
    return;
  }

  list.innerHTML = filtered.map((item) => `
    <article class="history-item">
      <img class="history-cover" src="${escapeAttr(item.cover || "")}" alt="">
      <div>
        <div class="list-title">${escapeHtml(item.name || "未知歌曲")}</div>
        <div class="list-meta">${escapeHtml(item.artists || "")} · ${escapeHtml(item.album || "")}</div>
        <div class="meta">
          <span class="badge">${item.mode === "package" ? "打包" : "歌曲"}</span>
          <span class="badge">${escapeHtml(QUALITY_LABELS[item.quality] || item.quality || "")}</span>
          ${escapeHtml(formatTime(item.downloadedAt))}
        </div>
        <div class="actions">
          <button data-action="parse" data-id="${escapeAttr(item.id)}">再次解析</button>
          <button data-action="audio" data-id="${escapeAttr(item.id)}">下载歌曲</button>
          <button data-action="package" data-id="${escapeAttr(item.id)}">打包下载</button>
          <button data-action="remove" data-key="${escapeAttr(item.key)}">删除</button>
        </div>
      </div>
    </article>
  `).join("");

  list.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button));
  });
}

async function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  const item = allHistory.find((entry) => entry.id === id) || {};
  button.disabled = true;
  const oldText = button.textContent;

  try {
    if (action === "parse") {
      const result = await getSong(id, item.quality || "standard", "json");
      alert(`${result.data.name}\n${result.data.ar_name}\n${result.data.al_name}`);
    }
    if (action === "audio") {
      button.textContent = "下载中";
      await downloadAudioOnly(id, item.quality || "standard");
    }
    if (action === "package") {
      button.textContent = "打包中";
      await downloadSongPackage(id, item.quality || "standard");
    }
    if (action === "remove") {
      await removeDownloadHistory(button.dataset.key);
      allHistory = await getDownloadHistory();
      renderHistory();
    }
  } catch (error) {
    alert(error.message || String(error));
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
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
