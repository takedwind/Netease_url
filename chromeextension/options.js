document.addEventListener("DOMContentLoaded", init);

async function init() {
  const options = await getOptions();
  const quality = document.querySelector("#defaultQuality");
  quality.innerHTML = Object.entries(QUALITY_LABELS)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  quality.value = options.quality;
  document.querySelector("#autoParse").checked = Boolean(options.autoParseCurrentPage);
  document.querySelector("#saveSettings").addEventListener("click", save);
}

async function save() {
  await setOptions({
    quality: document.querySelector("#defaultQuality").value,
    autoParseCurrentPage: document.querySelector("#autoParse").checked
  });
  document.querySelector("#result").textContent = "设置已保存。";
}
