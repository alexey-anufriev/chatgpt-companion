const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;

if (!clearDataBtn || !statusEl) {
    console.error("[discuss-with-chatgpt-ext] options DOM elements not found");
} else {
    clearDataBtn.addEventListener("click", () => {
        void requestClearDataAndCache();
    });
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
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] clear data request failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Clear operation failed.";
    } finally {
        clearDataBtn.disabled = false;
    }
}
