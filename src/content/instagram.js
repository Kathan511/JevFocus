const DEFAULTS = {
  topics: ["AI", "software engineering", "startups", "AdTech", "MCP", "LLMs", "productivity"],
  threshold: 0.7,
  focusMode: true,
  alwaysShowCreators: []
};

const state = {
  settings: { ...DEFAULTS },
  currentKey: null,
  previousReel: null,
  activeReel: null,
  timer: null,
  timerDueAt: 0,
  requestSequence: 0,
  cache: new Map(),
  advanceFailures: new Map()
};

const overlay = createOverlay();
void initialize();

async function initialize() {
  state.settings = await chrome.storage.sync.get(DEFAULTS);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, value] of Object.entries(changes)) state.settings[key] = value.newValue;
    scheduleScan(0);
  });

  const observer = new MutationObserver(() => scheduleScan(250));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("scroll", () => scheduleScan(120), { passive: true });
  addEventListener("popstate", () => scheduleScan(0));
  setInterval(() => scheduleScan(0), 1500);
  scheduleScan(0);
}

function scheduleScan(delay) {
  const dueAt = Date.now() + delay;
  // Instagram mutates the Reel tree continuously. Treat scans as a trailing
  // throttle instead of a pure debounce so mutation bursts cannot postpone a
  // scan forever.
  if (state.timer && state.timerDueAt <= dueAt) return;
  clearTimeout(state.timer);
  state.timerDueAt = dueAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.timerDueAt = 0;
    void scanCurrentReel();
  }, Math.max(0, dueAt - Date.now()));
}

async function scanCurrentReel() {
  if (!location.pathname.startsWith("/reels") && !location.pathname.startsWith("/reel/")) {
    state.currentKey = null;
    state.activeReel = null;
    state.requestSequence += 1;
    overlay.root.classList.add("jev-hidden");
    return;
  }

  const reel = findMostVisibleReel();
  if (!reel) {
    state.currentKey = null;
    state.activeReel = null;
    return render({ mode: "neutral", status: "Waiting for a Reel…" });
  }

  const content = extractContent(reel);
  const key = makeContentKey(content, reel);
  if (key === state.currentKey) return;

  state.currentKey = key;
  state.activeReel = reel;
  const sequence = ++state.requestSequence;

  if (isAlwaysShown(content.creator)) {
    return render({ mode: "pass", status: "Always shown", score: 1, topic: content.creator || "Creator" });
  }

  if (!hasEnoughMetadata(content)) {
    return render({
      mode: "neutral",
      status: "Not auto-skipped",
      topic: "Not enough caption or creator metadata",
      reason: "Jev Focus waits for more signals instead of guessing."
    });
  }

  render({ mode: "neutral", status: "Checking relevance…", topic: summarizeContent(content) });

  try {
    let result = state.cache.get(key);
    if (!result) {
      const response = await chrome.runtime.sendMessage({ type: "CLASSIFY_CONTENT", payload: { ...content, platform: "instagram" } });
      if (!response?.ok) throw new Error(response?.error || "Classifier request failed");
      result = response.result;
      remember(key, result);
    }
    if (sequence !== state.requestSequence || key !== state.currentKey) return;

    const belowThreshold = result.relevance < Number(state.settings.threshold);
    render({
      mode: belowThreshold ? "skip" : "pass",
      status: belowThreshold ? (state.settings.focusMode ? "Skipping…" : "Below threshold") : "Relevant",
      score: result.relevance,
      topic: result.topic,
      reason: result.reason,
      creator: content.creator,
      canUndo: belowThreshold && state.settings.focusMode
    });

    if (belowThreshold && state.settings.focusMode) {
      await wait(650);
      if (sequence === state.requestSequence && key === state.currentKey) {
        await skipToNext(reel, key, sequence);
      }
    }
  } catch (error) {
    if (sequence !== state.requestSequence) return;
    render({ mode: "neutral", status: "Filter unavailable", error: error.message });
  }
}

function findMostVisibleReel() {
  const video = findMostVisibleVideo();
  return video ? findReelContainer(video) : null;
}

function findMostVisibleVideo() {
  return [...document.querySelectorAll("main video, video")]
    .map((node) => ({
      node,
      score: visibleArea(node.getBoundingClientRect()) * (!node.paused ? 1.15 : 1)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.node;
}

function findReelContainer(video) {
  const article = video.closest("article");
  if (article) return article;

  let node = video.parentElement;
  let best = node;
  let bestScore = -1;
  for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
    if (node.matches("main, body, html")) break;
    const rect = node.getBoundingClientRect();
    const text = (node.innerText || "").trim();
    const hasCreator = [...node.querySelectorAll("a[href]")].some((anchor) => isCreatorPath(anchor.getAttribute("href")));
    const hasAudio = Boolean(node.querySelector("a[href*='/audio/'], a[href*='/reels/audio/']"));
    const sizeFitsOneReel = rect.height <= innerHeight * 1.7 && rect.width <= innerWidth;
    if (!sizeFitsOneReel && bestScore >= 0) continue;
    const score = (sizeFitsOneReel ? 80 : 0) + Math.min(text.length, 600) + (hasCreator ? 250 : 0) + (hasAudio ? 120 : 0) - depth * 4;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best || video.parentElement;
}

function visibleArea(rect) {
  const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
  const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
  return width * height;
}

function extractContent(reel) {
  const video = reel.querySelector("video") || (reel.matches("video") ? reel : null);
  const nearby = video ? findNearbyMetadataNodes(video) : [];
  const textNodes = [
    ...reel.querySelectorAll("h1, h2, button, [aria-label], span[dir='auto'], div[dir='auto'], span[role='link']"),
    ...nearby
  ];
  const scopeLines = (reel.innerText || "").split("\n").map((line) => line.trim()).filter(isUsefulText);
  const nodeText = textNodes.flatMap((node) => [node.innerText?.trim(), node.getAttribute?.("aria-label")?.trim()]).filter(isUsefulText);
  const chunks = [...new Set([...nodeText, ...scopeLines])];
  const creatorLink = [...new Set([
    ...reel.querySelectorAll("a[href]"),
    ...nearby.filter((node) => node.matches?.("a[href]"))
  ])].find((anchor) => isCreatorPath(anchor.getAttribute("href")));
  const creator = creatorFromPath(creatorLink?.getAttribute("href"));
  const caption = chunks
    .filter((text) => text !== creator && text !== `@${creator}`)
    .slice(0, 14)
    .join(" · ");
  const hashtags = [...new Set((chunks.join(" ").match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 20);
  const audioLink = [...reel.querySelectorAll("a[href*='/reels/audio/'], a[href*='/audio/']"), ...nearby]
    .find((node) => node.matches?.("a[href*='/reels/audio/'], a[href*='/audio/']"));
  const audioTitle = audioLink?.innerText?.trim() || audioLink?.getAttribute?.("aria-label") || "";
  const mediaLink = reel.querySelector("a[href*='/reel/']")?.href || location.href;
  const accessibilityText = [
    video?.getAttribute("aria-label"),
    video?.getAttribute("title"),
    reel.querySelector("img[alt]")?.getAttribute("alt")
  ].filter(Boolean).join(" · ");

  return {
    caption: caption.slice(0, 2000),
    hashtags,
    creator: creator.slice(0, 100),
    audioTitle: audioTitle.slice(0, 300),
    accessibilityText: accessibilityText.slice(0, 500),
    url: mediaLink
  };
}

function isCreatorPath(href) {
  const match = /^\/([A-Za-z0-9._]+)(?:\/reels)?\/?$/.exec(href || "");
  if (!match) return false;
  const value = match[1].toLowerCase();
  return !new Set(["accounts", "about", "ads", "direct", "explore", "legal", "p", "reel", "reels", "stories", "web"]).has(value);
}

function creatorFromPath(href) {
  return /^\/([A-Za-z0-9._]+)(?:\/reels)?\/?$/.exec(href || "")?.[1] || "";
}

function findNearbyMetadataNodes(video) {
  const videoRect = video.getBoundingClientRect();
  const bounds = {
    left: Math.max(0, videoRect.left - 520),
    right: Math.min(innerWidth, videoRect.right + 420),
    top: Math.max(0, videoRect.top - 120),
    bottom: Math.min(innerHeight, videoRect.bottom + 320)
  };
  const selector = "main a[href], main button, main [aria-label], main span[dir='auto'], main div[dir='auto']";
  return [...document.querySelectorAll(selector)].filter((node) => {
    if (node.closest("#jev-focus-overlay")) return false;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
  });
}

function isUsefulText(value) {
  const text = String(value || "").trim();
  if (!text || /^\d+[.,]?\d*[KMB]?$/i.test(text)) return false;
  return !new Set([
    "follow", "following", "like", "likes", "comment", "comments", "share", "save",
    "more", "original audio", "audio is muted", "play", "pause", "reels"
  ]).has(text.toLowerCase());
}

function hasEnoughMetadata(content) {
  return Boolean(content.caption || content.hashtags.length || content.creator || content.audioTitle || content.accessibilityText);
}

function summarizeContent(content) {
  return content.hashtags.slice(0, 3).join(" ") || content.creator || content.audioTitle || "Caption found";
}

function makeContentKey(content, reel) {
  const path = (() => { try { return new URL(content.url).pathname; } catch { return ""; } })();
  const mediaSource = reel.querySelector("video")?.currentSrc || reel.querySelector("video")?.src || "";
  return `${path}|${mediaSource}|${content.creator}|${content.caption.slice(0, 120)}|${content.audioTitle}|${content.accessibilityText.slice(0, 80)}`;
}

function isAlwaysShown(creator) {
  const normalized = String(creator || "").toLowerCase();
  return state.settings.alwaysShowCreators.some((item) => String(item).toLowerCase() === normalized);
}

async function skipToNext(current, expectedKey, sequence) {
  state.previousReel = current;
  const currentVideo = current.querySelector("video") || (current.matches("video") ? current : null);
  const startingSource = currentVideo?.currentSrc || currentVideo?.src || "";
  const startingUrl = location.href;
  const nextControl = findVisibleNextControl(currentVideo);

  if (nextControl && sequence === state.requestSequence) {
    nextControl.click();
    if (await waitForReelChange(currentVideo, startingSource, startingUrl, sequence, 1100)) {
      state.advanceFailures.delete(expectedKey);
      scheduleScan(0);
      return;
    }
  }

  if (sequence !== state.requestSequence) return;
  scrollPastCurrentReel(currentVideo || current);
  if (await waitForReelChange(currentVideo, startingSource, startingUrl, sequence, 1400)) {
    state.advanceFailures.delete(expectedKey);
    scheduleScan(0);
    return;
  }

  if (sequence !== state.requestSequence) return;
  const failures = (state.advanceFailures.get(expectedKey) || 0) + 1;
  state.advanceFailures.set(expectedKey, failures);

  // Retry transient lazy-loading failures without another network request (the
  // classification is cached), but do not spin forever on a Reel Instagram
  // refuses to advance past.
  if (failures < 3) {
    state.currentKey = null;
    scheduleScan(500);
    return;
  }

  render({
    mode: "neutral",
    status: "Could not advance automatically",
    reason: "Scroll once manually and Jev Focus will continue with the next Reel."
  });
}

function findVisibleNextControl(currentVideo) {
  const videoRect = currentVideo?.getBoundingClientRect();
  return [...document.querySelectorAll("button[aria-label]")]
    .filter((button) => {
      if (!/navigate to next reel|next reel/i.test(button.getAttribute("aria-label") || "")) return false;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      const style = getComputedStyle(button);
      return style.display !== "none" && style.visibility !== "hidden" && visibleArea(button.getBoundingClientRect()) > 0;
    })
    .sort((a, b) => distanceFromVideo(a, videoRect) - distanceFromVideo(b, videoRect))[0];
}

function distanceFromVideo(control, videoRect) {
  if (!videoRect) return 0;
  const rect = control.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - (videoRect.left + videoRect.width / 2);
  const y = rect.top + rect.height / 2 - (videoRect.top + videoRect.height / 2);
  return x * x + y * y;
}

function scrollPastCurrentReel(currentNode) {
  const currentRect = currentNode.getBoundingClientRect();
  const nextVideo = [...document.querySelectorAll("main video, video")]
    .filter((node) => node !== currentNode && node.getBoundingClientRect().top > currentRect.top + Math.max(40, currentRect.height * 0.25))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

  if (nextVideo) {
    nextVideo.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const distance = Math.max(currentRect.height * 0.9, innerHeight * 0.88, 500);
  const scrollContainer = findVerticalScrollContainer(currentNode);
  if (scrollContainer) {
    scrollContainer.scrollBy({ top: distance, behavior: "smooth" });
  } else {
    scrollBy({ top: distance, behavior: "smooth" });
  }
}

function findVerticalScrollContainer(node) {
  for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 2) {
      return parent;
    }
  }
  const root = document.scrollingElement;
  return root && root.scrollHeight > root.clientHeight + 2 ? root : null;
}

async function waitForReelChange(originalVideo, originalSource, originalUrl, sequence, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await wait(100);
    if (sequence !== state.requestSequence) return true;
    const visibleVideo = findMostVisibleVideo();
    const visibleSource = visibleVideo?.currentSrc || visibleVideo?.src || "";
    if (visibleVideo && (
      visibleVideo !== originalVideo ||
      (originalSource && visibleSource && visibleSource !== originalSource) ||
      location.href !== originalUrl
    )) return true;
  }
  return false;
}

function undoSkip() {
  if (!state.previousReel?.isConnected) return;
  state.previousReel.scrollIntoView({ behavior: "smooth", block: "center" });
  state.currentKey = null;
  state.previousReel = null;
}

async function alwaysShowCreator(creator) {
  if (!creator) return;
  const creators = [...new Set([...(state.settings.alwaysShowCreators || []), creator])];
  await chrome.storage.sync.set({ alwaysShowCreators: creators });
  render({ mode: "pass", status: "Creator added", score: 1, topic: `@${creator} will always be shown` });
}

function createOverlay() {
  const root = document.createElement("aside");
  root.id = "jev-focus-overlay";
  root.className = "jev-hidden jev-neutral";
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="jev-head"><span class="jev-brand">Jev Focus</span><span class="jev-status"></span></div>
    <div class="jev-score"></div>
    <div class="jev-topic"></div>
    <div class="jev-reason"></div>
    <div class="jev-error"></div>
    <div class="jev-actions">
      <button type="button" data-action="undo">Undo</button>
      <button type="button" data-action="always-show">Always show creator</button>
    </div>`;
  document.documentElement.append(root);
  root.querySelector("[data-action='undo']").addEventListener("click", undoSkip);
  root.querySelector("[data-action='always-show']").addEventListener("click", () => {
    void alwaysShowCreator(root.dataset.creator);
  });
  return {
    root,
    status: root.querySelector(".jev-status"),
    score: root.querySelector(".jev-score"),
    topic: root.querySelector(".jev-topic"),
    reason: root.querySelector(".jev-reason"),
    error: root.querySelector(".jev-error"),
    undo: root.querySelector("[data-action='undo']"),
    always: root.querySelector("[data-action='always-show']")
  };
}

function render({ mode = "neutral", status = "", score, topic = "", reason = "", error = "", creator = "", canUndo = false }) {
  overlay.root.className = `jev-${mode}`;
  overlay.root.dataset.creator = creator;
  overlay.status.textContent = status;
  overlay.score.textContent = Number.isFinite(score) ? `${Math.round(score * 100)}% match` : "";
  overlay.topic.textContent = topic;
  overlay.reason.textContent = reason;
  overlay.error.textContent = error;
  overlay.undo.hidden = !canUndo && !state.previousReel;
  overlay.always.hidden = !creator;
}

function remember(key, value) {
  state.cache.set(key, value);
  if (state.cache.size > 100) state.cache.delete(state.cache.keys().next().value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
