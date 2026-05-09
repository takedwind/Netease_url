(function () {
  const target = detectTarget(location.href);
  if (target) {
    injectQuickAction(target);
    injectSongDetailActions(target);
  }

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const nextTarget = detectTarget(location.href);
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (nextTarget) {
        injectQuickAction(nextTarget);
      }
    }
    if (nextTarget) {
      injectSongDetailActions(nextTarget);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

function detectTarget(url) {
  const parsed = extractTarget(url);
  if (!parsed?.id) {
    return null;
  }
  return parsed;
}

function extractTarget(raw) {
  const idMatch = String(raw).match(/[?&#]id=(\d+)/);
  if (!idMatch) {
    return null;
  }

  let type = "song";
  if (/\/playlist\b|#\/playlist\b/i.test(raw)) {
    type = "playlist";
  } else if (/\/album\b|#\/album\b/i.test(raw)) {
    type = "album";
  }

  return {
    raw,
    url: raw,
    id: idMatch[1],
    type,
    isNetease: true
  };
}

function injectQuickAction(target) {
  if (window.top !== window) {
    return;
  }

  const existing = document.getElementById("netease-helper-quick-action");
  if (existing) {
    existing.remove();
  }

  const button = document.createElement("button");
  button.id = "netease-helper-quick-action";
  button.type = "button";
  button.textContent = target.type === "song" ? "解析/下载" : "解析列表";
  button.title = "使用网易云音乐智能助手处理当前页面";
  button.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:24px",
    "z-index:2147483647",
    "height:38px",
    "padding:0 14px",
    "border:0",
    "border-radius:19px",
    "background:#d71920",
    "color:#fff",
    "font-size:14px",
    "font-weight:600",
    "box-shadow:0 8px 24px rgba(0,0,0,.22)",
    "cursor:pointer"
  ].join(";");

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "open-popup-target",
      target
    });
  });

  document.documentElement.appendChild(button);
}

function injectSongDetailActions(target) {
  if (target.type !== "song") {
    removeSongDetailActions();
    return;
  }

  const clientButton = document.querySelector('div.btn[data-action="orpheus"][data-id]');
  if (!clientButton) {
    return;
  }

  const id = clientButton.dataset.id || target.id;
  if (!id) {
    return;
  }

  const existing = document.getElementById("netease-helper-song-actions");
  if (existing?.dataset.id === id && existing.previousElementSibling === clientButton) {
    return;
  }
  existing?.remove();

  ensureSongActionStyles();

  const actions = document.createElement("div");
  actions.id = "netease-helper-song-actions";
  actions.dataset.id = id;
  actions.className = "netease-helper-song-actions";
  actions.innerHTML = `
    <button type="button" data-helper-action="package">打包下载</button>
    <button type="button" data-helper-action="audio">下载歌曲</button>
    <button type="button" data-helper-action="parse">解析歌曲</button>
  `;

  actions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-helper-action]");
    if (!button) {
      return;
    }
    handleSongDetailAction(button, {
      id,
      raw: location.href,
      url: location.href,
      type: "song",
      isNetease: true
    });
  });

  clientButton.insertAdjacentElement("afterend", actions);
}

function removeSongDetailActions() {
  document.getElementById("netease-helper-song-actions")?.remove();
}

function ensureSongActionStyles() {
  if (document.getElementById("netease-helper-song-action-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "netease-helper-song-action-styles";
  style.textContent = `
    .netease-helper-song-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 0 0;
    }
    .netease-helper-song-actions button {
      width: 100%;
      height: 31px;
      border: 1px solid #d33a31;
      border-radius: 4px;
      background: #d33a31;
      color: #fff;
      font-size: 12px;
      line-height: 29px;
      text-align: center;
      cursor: pointer;
    }
    .netease-helper-song-actions button:hover {
      background: #c62f2f;
      border-color: #c62f2f;
    }
    .netease-helper-song-actions button:disabled {
      cursor: default;
      opacity: .65;
    }
  `;
  document.documentElement.appendChild(style);
}

async function handleSongDetailAction(button, target) {
  const action = button.dataset.helperAction;
  const oldText = button.textContent;
  button.disabled = true;

  try {
    if (action === "parse") {
      button.textContent = "打开中";
      await sendRuntimeMessage({
        type: "open-popup-target",
        target
      });
      button.textContent = oldText;
      button.disabled = false;
      return;
    }

    button.textContent = action === "audio" ? "下载中" : "打包中";
    const response = await sendRuntimeMessage({
      type: action === "audio" ? "download-audio" : "download-package",
      id: target.id
    });
    if (!response?.ok) {
      throw new Error(response?.error || "下载失败");
    }
    button.textContent = "已开始";
    setTimeout(() => {
      button.textContent = oldText;
      button.disabled = false;
    }, 1200);
    return;
  } catch (error) {
    alert(error.message || String(error));
  }

  button.disabled = false;
  button.textContent = oldText;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}
