const DEFAULTS = {
  topics: ["AI", "software engineering", "startups", "AdTech", "MCP", "LLMs", "productivity"],
  threshold: 0.7,
  focusMode: true,
  alwaysShowCreators: []
};

const fields = {
  jevApiKey: document.querySelector("#jevApiKey"),
  toggleKey: document.querySelector("#toggleKey"),
  topics: document.querySelector("#topics"),
  threshold: document.querySelector("#threshold"),
  thresholdValue: document.querySelector("#thresholdValue"),
  focusMode: document.querySelector("#focusMode"),
  creators: document.querySelector("#creators"),
  test: document.querySelector("#test"),
  save: document.querySelector("#save"),
  status: document.querySelector("#status")
};

void load();
fields.threshold.addEventListener("input", showThreshold);
fields.save.addEventListener("click", () => save());
fields.test.addEventListener("click", testConnection);
fields.toggleKey.addEventListener("click", toggleKeyVisibility);

async function load() {
  const [settings, secrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ jevApiKey: "" })
  ]);
  fields.jevApiKey.value = secrets.jevApiKey;
  fields.topics.value = settings.topics.join("\n");
  fields.threshold.value = settings.threshold;
  fields.focusMode.checked = settings.focusMode;
  fields.creators.value = settings.alwaysShowCreators.join("\n");
  showThreshold();
}

async function save(showConfirmation = true) {
  fields.save.disabled = true;
  fields.test.disabled = true;
  fields.status.textContent = "";
  try {
    const granted = await chrome.permissions.request({ origins: ["https://api.typesafe.ai/*"] });
    if (!granted) throw new Error("TypeSafe API access was not granted.");

    const topics = splitList(fields.topics.value);
    if (!topics.length) throw new Error("Add at least one topic.");
    const apiKey = fields.jevApiKey.value.trim();
    if (!apiKey) throw new Error("Add your Jev API key.");
    if (!apiKey.startsWith("apikey_")) throw new Error("Jev Focus expects a TypeSafe key beginning with apikey_.");

    await chrome.storage.sync.set({
      topics,
      threshold: Number(fields.threshold.value),
      focusMode: fields.focusMode.checked,
      alwaysShowCreators: splitList(fields.creators.value).map((value) => value.replace(/^@/, ""))
    });
    if (apiKey) await chrome.storage.local.set({ jevApiKey: apiKey });
    else await chrome.storage.local.remove("jevApiKey");
    if (showConfirmation) {
      fields.status.textContent = "Saved";
      setTimeout(() => { fields.status.textContent = ""; }, 1800);
    }
    return true;
  } catch (error) {
    fields.status.textContent = error.message;
    return false;
  } finally {
    fields.save.disabled = false;
    fields.test.disabled = false;
  }
}

async function testConnection() {
  fields.status.textContent = "Saving and testing…";
  if (!await save(false)) return;
  fields.save.disabled = true;
  fields.test.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (!response?.ok) throw new Error(response?.error || "Connection test failed");
    fields.status.textContent = response.result.message;
  } catch (error) {
    fields.status.textContent = error.message;
  } finally {
    fields.save.disabled = false;
    fields.test.disabled = false;
  }
}

function splitList(value) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function showThreshold() {
  fields.thresholdValue.textContent = `${Math.round(Number(fields.threshold.value) * 100)}%`;
}

function toggleKeyVisibility() {
  const showing = fields.jevApiKey.type === "text";
  fields.jevApiKey.type = showing ? "password" : "text";
  fields.toggleKey.textContent = showing ? "Show" : "Hide";
  fields.toggleKey.setAttribute("aria-label", showing ? "Show API key" : "Hide API key");
}
