const sourceTitleEl = document.getElementById("sourceTitle") as HTMLDivElement | null;
const sourceUrlEl = document.getElementById("sourceUrl") as HTMLDivElement | null;
const copyPromptBtn = document.getElementById("copyPromptBtn") as HTMLButtonElement | null;
const reinsertBtn = document.getElementById("reinsertBtn") as HTMLButtonElement | null;

void init();

async function init(): Promise<void> {
    if (!sourceTitleEl || !sourceUrlEl || !copyPromptBtn || !reinsertBtn) {
        console.error("[discuss-with-chatgpt-ext] side panel DOM elements not found");
        return;
    }

    await renderSource();
    attachEvents();

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes["discussPromptStamp"]) {
            await renderSource();
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