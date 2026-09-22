const DEFAULTS = {
  topics: ["AI", "software engineering", "startups", "AdTech", "MCP", "LLMs", "productivity"],
  threshold: 0.7,
  focusMode: true,
  alwaysShowCreators: []
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const missing = Object.fromEntries(
    Object.entries(DEFAULTS).filter(([key]) => current[key] === undefined)
  );
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;
  if (message.type === "OPEN_OPTIONS") {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  const operation = ["CLASSIFY_REEL", "CLASSIFY_CONTENT"].includes(message.type)
    ? classifyContent(message.payload)
    : message.type === "TEST_CONNECTION" ? testConnection() : null;
  if (!operation) return false;

  operation
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function classifyContent(content) {
  const [settings, secrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ jevApiKey: "" })
  ]);
  return classifyDirectlyWithJev(content, settings.topics, secrets.jevApiKey);
}

async function classifyDirectlyWithJev(content, topics, apiKey) {
  if (!apiKey) throw new Error("Add your Jev API key in the extension settings");
  const endpoint = "https://api.typesafe.ai/v1/systemone";
  const topicCriteria = Object.fromEntries(topics.map((topic, index) => [`topic_${index}`, topic]));
  topicCriteria.other = "None of the selected topics";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          selected_topics: topics,
          reel: {
            platform: content.platform || "instagram",
            title: content.title || "",
            caption: content.caption,
            hashtags: content.hashtags,
            creator: content.creator,
            audio_title: content.audioTitle || "",
            accessibility_text: content.accessibilityText,
            url: content.url
          }
        },
        questions: {
          relevant: {
            type: "noul",
            instructions: "Is this online video meaningfully related to at least one selected topic? Use only the supplied video metadata."
          },
          topic_match: {
            type: "choice",
            instructions: "Choose the selected topic that best matches this video, or other when none match.",
            criteria: topicCriteria
          }
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Jev returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
    }
    return normalizeDirectJevResponse(await response.json(), topics);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Jev timed out after 10 seconds");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDirectJevResponse(payload, topics) {
  if (Number.isFinite(Number(payload?.code)) && Number(payload.code) !== 0) {
    throw new Error(payload.message || `Jev returned code ${payload.code}`);
  }
  const answers = payload?.data?.answers || payload?.answers || payload?.data || {};
  const relevant = answers.relevant || {};
  const topicMatch = answers.topic_match || {};
  const relevance = firstFinite(relevant.noul, relevant.probability, relevant.value);
  if (relevance === null) throw new Error("Jev response did not contain the relevance probability");

  const choice = String(topicMatch.choice || topicMatch.selected || topicMatch.value || "other");
  const topicIndex = /^topic_(\d+)$/.exec(choice)?.[1];
  const topic = topicIndex !== undefined ? topics[Number(topicIndex)] || "Unknown" : "Unknown";
  const confidence = firstFinite(relevant.confidence, topicMatch.confidence, Math.max(relevance, 1 - relevance));
  return {
    relevance: Math.max(0, Math.min(1, relevance)),
    confidence: Math.max(0, Math.min(1, confidence ?? relevance)),
    topic,
    reason: topic === "Unknown" ? "Jev did not find a strong selected-topic match." : `Best matching topic: ${topic}`
  };
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function testConnection() {
  const result = await classifyContent({
    platform: "instagram",
    caption: "A short tutorial about artificial intelligence and software engineering.",
    hashtags: ["#AI", "#softwareengineering"],
    creator: "jev_focus_connection_test",
    audioTitle: "",
    accessibilityText: "",
    url: "https://www.instagram.com/reels/"
  });
  return { message: `Connected · ${Math.round(result.relevance * 100)}% test score` };
}
