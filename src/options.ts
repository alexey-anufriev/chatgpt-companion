const OPTIONS_DEFAULT_PREFERRED_LANGUAGE = "English";
const OPTIONS_ORIGINAL_LANGUAGE_LABEL = "Original language";

const preferredLanguageInput = document.getElementById("preferredLanguage") as HTMLInputElement | null;
const saveSettingsBtn = document.getElementById("saveSettingsBtn") as HTMLButtonElement | null;
const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

let savedPreferredLanguage = OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
let isSavingSettings = false;

if (!preferredLanguageInput || !saveSettingsBtn || !clearDataBtn || !statusEl || !sessionsListEl || !sessionCountEl) {
    console.error("[discuss-with-chatgpt-ext] options DOM elements not found");
} else {
    preferredLanguageInput.addEventListener("input", () => {
        updateSaveButtonState();
    });

    saveSettingsBtn.addEventListener("click", () => {
        void savePreferredLanguage();
    });

    clearDataBtn.addEventListener("click", () => {
        void requestClearDataAndCache();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes["discussions"] || changes["tabSessionIds"])) {
            void renderPersistedSessions();
        }

        if (areaName === "local" && changes["preferredLanguage"]) {
            renderPreferredLanguage(changes["preferredLanguage"].newValue);
        }
    });

    void loadPreferredLanguage();
    void renderPersistedSessions();
}

async function loadPreferredLanguage(): Promise<void> {
    const storage = (await chrome.storage.local.get("preferredLanguage")) as StorageShape;
    renderPreferredLanguage(storage.preferredLanguage);
}

function renderPreferredLanguage(preferredLanguage: unknown): void {
    if (!preferredLanguageInput) {
        return;
    }

    savedPreferredLanguage = normalizeOptionsPreferredLanguages(preferredLanguage);
    preferredLanguageInput.value = savedPreferredLanguage;
    updateSaveButtonState();
}

async function savePreferredLanguage(): Promise<void> {
    if (!preferredLanguageInput || !saveSettingsBtn || !statusEl) {
        return;
    }

    const nextPreferredLanguage = normalizeOptionsPreferredLanguages(preferredLanguageInput.value);

    isSavingSettings = true;
    updateSaveButtonState();
    statusEl.textContent = "Saving settings...";

    try {
        await chrome.storage.local.set({
            preferredLanguage: nextPreferredLanguage
        });
        savedPreferredLanguage = nextPreferredLanguage;
        preferredLanguageInput.value = nextPreferredLanguage;
        statusEl.textContent = "Settings saved.";
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] save settings failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Save operation failed.";
    } finally {
        isSavingSettings = false;
        updateSaveButtonState();
    }
}

async function requestClearDataAndCache(): Promise<void> {
    if (!clearDataBtn || !statusEl) {
        return;
    }

    clearDataBtn.disabled = true;
    statusEl.textContent = "Clearing data...";

    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "clear-data-and-cache"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Clear operation failed");
        }

        statusEl.textContent = "Data and cache cleared.";
        await loadPreferredLanguage();
        await renderPersistedSessions();
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] clear data request failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Clear operation failed.";
    } finally {
        clearDataBtn.disabled = false;
    }
}

async function renderPersistedSessions(): Promise<void> {
    if (!sessionsListEl || !sessionCountEl) {
        return;
    }

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;
    const discussions = Object.entries(storage.discussions ?? {}).sort(([, left], [, right]) => {
        return right.stamp - left.stamp;
    });
    const tabSessionIds = storage.tabSessionIds ?? {};

    sessionCountEl.textContent = String(discussions.length);
    sessionsListEl.replaceChildren();

    if (discussions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No persisted sessions.";
        sessionsListEl.append(empty);
        return;
    }

    for (const [sessionId, discussion] of discussions) {
        sessionsListEl.append(createSessionRow(sessionId, discussion, tabSessionIds));
    }
}

function createSessionRow(
    sessionId: string,
    discussion: DiscussionState,
    tabSessionIds: Record<string, string>
): HTMLElement {
    const row = document.createElement("article");
    row.className = "session";

    const title = document.createElement("h3");
    title.textContent = discussion.source.title || "Page title is missing";

    const sourceUrlRow = document.createElement("div");
    sourceUrlRow.className = "sessionUrl";

    const sourceUrlLabel = document.createElement("span");
    sourceUrlLabel.className = "sessionLabel";
    sourceUrlLabel.textContent = "Original URL:";

    const sourceUrl = document.createElement("a");
    sourceUrl.href = discussion.source.url || "#";
    sourceUrl.textContent = discussion.source.url || "URL is missing";
    sourceUrl.target = "_blank";
    sourceUrl.rel = "noreferrer";

    sourceUrlRow.append(sourceUrlLabel, sourceUrl);

    const chatUrlRow = document.createElement("div");
    chatUrlRow.className = "sessionUrl";

    const chatUrlLabel = document.createElement("span");
    chatUrlLabel.className = "sessionLabel";
    chatUrlLabel.textContent = "ChatGPT URL:";

    const chatUrl = document.createElement("a");
    chatUrl.href = discussion.chatUrl || "#";
    chatUrl.textContent = discussion.chatUrl || "Chat URL not saved yet";
    chatUrl.target = "_blank";
    chatUrl.rel = "noreferrer";
    if (!discussion.chatUrl) {
        chatUrl.removeAttribute("href");
    }

    chatUrlRow.append(chatUrlLabel, chatUrl);

    const meta = document.createElement("div");
    meta.className = "sessionMeta";
    meta.textContent = [
        `session: ${sessionId}`,
        `language: ${discussion.responseLanguage || OPTIONS_ORIGINAL_LANGUAGE_LABEL}`,
        `updated: ${new Date(discussion.stamp).toLocaleString()}`,
        `consumed: ${discussion.consumed ? "yes" : "no"}`,
        `tab: ${getMappedTabIds(sessionId, tabSessionIds).join(", ") || "none"}`
    ].join(" | ");

    row.append(title, sourceUrlRow, chatUrlRow, meta);
    return row;
}

function getMappedTabIds(sessionId: string, tabSessionIds: Record<string, string>): string[] {
    return Object.entries(tabSessionIds)
        .filter(([, mappedSessionId]) => mappedSessionId === sessionId)
        .map(([tabId]) => tabId);
}

function normalizeOptionsPreferredLanguages(value: unknown): string {
    if (typeof value !== "string") {
        return OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
    }

    const languages = value
        .split(",")
        .map((language) => language.trim())
        .filter((language) => language.length > 0);

    return languages.length > 0 ? languages.join(", ") : OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
}

function updateSaveButtonState(): void {
    if (!preferredLanguageInput || !saveSettingsBtn) {
        return;
    }

    const currentPreferredLanguage = normalizeOptionsPreferredLanguages(preferredLanguageInput.value);
    saveSettingsBtn.disabled = isSavingSettings || currentPreferredLanguage === savedPreferredLanguage;
}
