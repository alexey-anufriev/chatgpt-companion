const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

if (!clearDataBtn || !statusEl || !sessionsListEl || !sessionCountEl) {
    console.error("[discuss-with-chatgpt-ext] options DOM elements not found");
} else {
    clearDataBtn.addEventListener("click", () => {
        void requestClearDataAndCache();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes["discussions"] || changes["tabSessionIds"])) {
            void renderPersistedSessions();
        }
    });

    void renderPersistedSessions();
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
