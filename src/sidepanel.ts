const CHATGPT_BASE_URL = "https://chatgpt.com/";

const sourceTitleEl = document.getElementById("sourceTitle") as HTMLDivElement | null;
const sourceUrlEl = document.getElementById("sourceUrl") as HTMLDivElement | null;
const copyPromptBtn = document.getElementById("copyPromptBtn") as HTMLButtonElement | null;
const reinsertBtn = document.getElementById("reinsertBtn") as HTMLButtonElement | null;
const closeBtn = document.getElementById("closeBtn") as HTMLButtonElement | null;
const chatgptFrame = document.getElementById("chatgptFrame") as HTMLIFrameElement | null;

let currentIframeSessionId: string | null = null;

void init();

async function init(): Promise<void> {
    if (!sourceTitleEl || !sourceUrlEl || !copyPromptBtn || !reinsertBtn || !closeBtn || !chatgptFrame) {
        console.error("[discuss-with-chatgpt-ext] side panel DOM elements not found");
        return;
    }

    await renderSource();
    await syncIframeSession();
    attachEvents();

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes["discussPromptStamp"] || changes["discussSource"]) {
            await renderSource();
        }

        if (changes["discussionSessionId"]) {
            await syncIframeSession();
        }
    });
}

function attachEvents(): void {
    copyPromptBtn?.addEventListener("click", async () => {
        const data = (await chrome.storage.local.get("discussPrompt")) as StorageShape;
        await navigator.clipboard.writeText(data.discussPrompt ?? "");
    });

    reinsertBtn?.addEventListener("click", async () => {
        await chrome.storage.local.set({
            discussPromptStamp: Date.now(),
            discussConsumed: false
        });
    });

    closeBtn?.addEventListener("click", async () => {
        await chrome.storage.local.set({
            discussPrompt: "",
            discussPromptStamp: Date.now(),
            discussConsumed: false,
            discussSource: undefined,
            closeDiscussion: true,
            discussionSessionId: crypto.randomUUID()
        });

        await new Promise((r) => setTimeout(r, 150));

        window.close();
    });
}

async function renderSource(): Promise<void> {
    if (!sourceTitleEl || !sourceUrlEl) {
        return;
    }

    const data = (await chrome.storage.local.get("discussSource")) as StorageShape;
    const source = data.discussSource;

    if (!source) {
        sourceTitleEl.textContent = "Page not selected";
        sourceUrlEl.textContent = "URL not found";
        return;
    }

    sourceTitleEl.textContent = source.title || "Page title is missing";
    sourceUrlEl.textContent = source.url || "URL is missing";
}

async function syncIframeSession(): Promise<void> {
    if (!chatgptFrame) {
        return;
    }

    const data = (await chrome.storage.local.get("discussionSessionId")) as StorageShape;
    const sessionId = data.discussionSessionId;

    if (!sessionId || sessionId === currentIframeSessionId) {
        return;
    }

    currentIframeSessionId = sessionId;
    chatgptFrame.src = buildChatUrl(sessionId);
}

function buildChatUrl(sessionId: string): string {
    const url = new URL(CHATGPT_BASE_URL);
    url.hash = `dwc_session=${encodeURIComponent(sessionId)}`;
    return url.toString();
}