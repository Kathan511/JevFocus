const DEFAULTS = {
  topics: ["AI", "software engineering", "startups", "AdTech", "MCP", "LLMs", "productivity"],
  threshold: 0.7,
  focusMode: true,
  alwaysShowCreators: []
};

const CARD_SELECTOR = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-reel-item-renderer"
].join(",");

const state = {
  settings: { ...DEFAULTS },
  timer: null,
  timerDueAt: 0,
  queue: [],
  queuedKeys: new Set(),
  inFlight: 0,
  cache: new Map(),
  failures: new Map(),
  visibleCards: 0,
  lastError: ""
};

const statusChip = createStatusChip();
void initialize();

async function initialize() {
  state.settings = await chrome.storage.sync.get(DEFAULTS);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, value] of Object.entries(changes)) state.settings[key] = value.newValue;
    scheduleScan(0);
  });

  const observer = new MutationObserver(() => scheduleScan(350));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("scroll", () => scheduleScan(180), { passive: true });
  addEventListener("yt-navigate-finish", () => scheduleScan(0));
  setInterval(() => scheduleScan(0), 2_000);
  scheduleScan(0);
}

function scheduleScan(delay) {
  const dueAt = Date.now() + delay;
  // YouTube continuously updates thumbnails and progress bars. Keep the first
  // pending scan rather than letting those updates debounce it forever.
  if (state.timer && state.timerDueAt <= dueAt) return;
  clearTimeout(state.timer);
  state.timerDueAt = dueAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.timerDueAt = 0;
    scanVisibleCards();
  }, Math.max(0, dueAt - Date.now()));
}

function scanVisibleCards() {
  const cards = [...document.querySelectorAll(CARD_SELECTOR)]
    .filter(isCandidateCard)
    .slice(0, 30);
  state.visibleCards = cards.length;
  for (const card of cards) considerCard(card);
  drainQueue();
  renderStatus();
}

function isCandidateCard(card) {
  if (card.querySelector("ytd-ad-slot-renderer, ytd-display-ad-renderer")) return false;
  const rect = card.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > -innerHeight && rect.top < innerHeight * 2;
}

function considerCard(card) {
  const content = extractContent(card);
  if (!content.title) return;
  const key = makeContentKey(content);
  const cached = state.cache.get(key);

  if (cached) {
    applyResult(card, key, content, cached);
    return;
  }

  if (card.dataset.jevFocusKey === key && card.dataset.jevFocusPending === "true") return;
  if ((state.failures.get(key) || 0) > Date.now()) return;

  card.dataset.jevFocusKey = key;
  card.dataset.jevFocusPending = "true";
  if (!state.queuedKeys.has(key)) {
    state.queuedKeys.add(key);
    state.queue.push({ card, key, content });
  }
}

function drainQueue() {
  while (state.inFlight < 2 && state.queue.length) {
    const item = state.queue.shift();
    state.queuedKeys.delete(item.key);
    state.inFlight += 1;
    void classifyCard(item).finally(() => {
      state.inFlight -= 1;
      drainQueue();
    });
  }
}

async function classifyCard({ card, key, content }) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLASSIFY_CONTENT", payload: content });
    if (!response?.ok) throw new Error(response?.error || "Classifier request failed");
    remember(key, response.result);
    state.lastError = "";
    if (card.isConnected && card.dataset.jevFocusKey === key) applyResult(card, key, content, response.result);
  } catch (error) {
    // Avoid repeatedly requesting the same failed card while a feed is open.
    state.failures.set(key, Date.now() + 30_000);
    state.lastError = String(error.message || "Classifier request failed");
    if (card.isConnected && card.dataset.jevFocusKey === key) {
      card.dataset.jevFocusPending = "false";
      card.dataset.jevFocusError = error.message;
    }
  } finally {
    renderStatus();
    scheduleScan(0);
  }
}

function applyResult(card, key, content, result) {
  card.dataset.jevFocusKey = key;
  card.dataset.jevFocusPending = "false";
  const relevant = Number(result.relevance) >= Number(state.settings.threshold);
  const hide = state.settings.focusMode && !relevant && !isAlwaysShown(content.creator);
  card.classList.toggle("jev-youtube-hidden", hide);
  card.dataset.jevFocusResult = hide ? "hidden" : relevant ? "shown" : "below-threshold";
  renderStatus();
}

function extractContent(card) {
  const links = [...card.querySelectorAll("a[href]")];
  const videoLinks = links.filter((link) => /^\/(watch\?|shorts\/)/.test(link.getAttribute("href") || ""));
  const titleLink = card.querySelector("a#video-title, a#video-title-link, #video-title") ||
    videoLinks.find((link) => isVideoTitle(textFrom(link))) || videoLinks[0];
  const channelLink = card.querySelector("ytd-channel-name a, #channel-name a") ||
    links.find((link) => /^\/@/.test(link.getAttribute("href") || ""));
  const descriptionNode = card.querySelector("#description-text, #description");
  const title = textFrom(titleLink);
  const creator = textFrom(channelLink).replace(/^@/, "");
  const description = textFrom(descriptionNode);
  const url = makeAbsoluteUrl(titleLink?.getAttribute("href") || videoLinks[0]?.getAttribute("href") || card.querySelector("a#thumbnail")?.getAttribute("href") || "");
  const accessibilityText = [
    titleLink?.getAttribute("aria-label"),
    card.getAttribute("aria-label")
  ].filter(Boolean).join(" · ");
  const caption = [title, description].filter(Boolean).join(" · ");
  const hashtags = [...new Set((`${caption} ${accessibilityText}`.match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 20);

  return {
    platform: "youtube",
    title: title.slice(0, 500),
    caption: caption.slice(0, 2_000),
    hashtags,
    creator: creator.slice(0, 150),
    audioTitle: "",
    accessibilityText: accessibilityText.slice(0, 500),
    url
  };
}

function textFrom(node) {
  return (node?.textContent || node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || "").replace(/\s+/g, " ").trim();
}

function isVideoTitle(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text);
}

function makeAbsoluteUrl(value) {
  if (!value) return location.href;
  try {
    const url = new URL(value, location.origin);
    url.search = "";
    return url.href;
  } catch {
    return location.href;
  }
}

function makeContentKey(content) {
  return `${content.url}|${content.title}|${content.creator}`;
}

function isAlwaysShown(creator) {
  const normalized = String(creator || "").replace(/^@/, "").toLowerCase();
  return state.settings.alwaysShowCreators.some((item) => String(item).replace(/^@/, "").toLowerCase() === normalized);
}

function remember(key, result) {
  state.cache.set(key, result);
  if (state.cache.size > 300) state.cache.delete(state.cache.keys().next().value);
}

function createStatusChip() {
  const root = document.createElement("button");
  root.id = "jev-youtube-status";
  root.type = "button";
  root.title = "Jev Focus YouTube status";
  root.addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }));
  document.documentElement.append(root);
  return root;
}

function renderStatus() {
  if (!state.settings.focusMode) {
    statusChip.textContent = "Jev Focus · paused";
    statusChip.dataset.state = "paused";
    return;
  }
  if (state.lastError) {
    statusChip.textContent = `Jev Focus · ${state.lastError.slice(0, 72)}`;
    statusChip.dataset.state = "error";
    return;
  }
  const hidden = document.querySelectorAll(".jev-youtube-hidden").length;
  const checking = state.inFlight + state.queue.length;
  statusChip.textContent = checking
    ? `Jev Focus · checking ${checking} · ${hidden} hidden`
    : `Jev Focus · ${hidden} hidden`;
  statusChip.dataset.state = state.visibleCards ? "active" : "waiting";
}
