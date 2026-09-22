const toggle = document.querySelector("#focusMode");
const summary = document.querySelector("#summary");

void chrome.storage.sync.get({ focusMode: true, topics: [], threshold: 0.7 }).then((settings) => {
  toggle.checked = settings.focusMode;
  summary.textContent = `${settings.topics.length} topics · ${Math.round(settings.threshold * 100)}% threshold`;
});

toggle.addEventListener("change", () => chrome.storage.sync.set({ focusMode: toggle.checked }));
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
