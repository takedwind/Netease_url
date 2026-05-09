(function () {
  const target = detectTarget(location.href);
  if (!target) {
    return;
  }

  injectQuickAction(target);

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href === lastUrl) {
      return;
    }
    lastUrl = location.href;
    const nextTarget = detectTarget(location.href);
    if (nextTarget) {
      injectQuickAction(nextTarget);
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
