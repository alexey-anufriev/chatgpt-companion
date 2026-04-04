const MENU_ID = "discuss-with-chatgpt-ext";

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: MENU_ID,
        title: "Discuss with ChatGPT",
        contexts: ["page", "selection"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id || !tab.windowId) {
        return;
    }

    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
        console.error("[discuss-with-chatgpt-ext] sidePanel open failed", error);
    });

    void handleDiscussClick(info, tab);
});

async function handleDiscussClick(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab
): Promise<void> {
    if (!tab.id) {
        return;
    }

    try {
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: collectPageData,
            args: [info.selectionText ?? ""]
        });

        const result = injectionResults[0]?.result;
        if (!result) {
            return;
        }

        const prompt = buildPrompt(result);

        await chrome.storage.local.set({
            discussPrompt: prompt,
            discussPromptStamp: Date.now(),
            discussSource: result,
            discussConsumed: false
        });

        console.log("[discuss-with-chatgpt-ext] prompt saved");
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] handleDiscussClick failed", error);
    }
}

function collectPageData(selectionText: string): DiscussSource {
    return {
        title: document.title || "",
        url: location.href || "",
        selection: selectionText || ""
    };
}

function buildPrompt(data: DiscussSource): string {
    const hasSelection = data.selection && data.selection.trim().length > 0;

    const parts: string[] = [
        "Hi, I’d like to discuss the following content.",
        "",
        `Title: ${data.title || "(no title)"}`,
        `URL: ${data.url || "(no url)"}`
    ];

    if (hasSelection) {
        const MAX = 4000;
        const selection = data.selection.trim().slice(0, MAX);

        parts.push(
            "",
            "Selected excerpt:",
            selection,
            "",
            "Focus primarily on this excerpt."
        );
    }

    parts.push(
        "",
        "Please:",
        "- Provide a concise summary",
        "- Identify the main idea",
        "- Highlight what is actually important",
        "- Point out weak or questionable parts",
        "",
        "Use the language of the original material for your response."
    );

    return parts.join("\n");
}
