const MENU_ID = "discuss-in-chatgpt";

let activeDiscussionTabId: number | null = null;

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: MENU_ID,
        title: "Discuss with ChatGPT",
        contexts: ["page", "selection"]
    });

    void ensurePanelConfiguredForAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
    void ensurePanelConfiguredForAllTabs();
});

chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
        void ensurePanelConfiguredForTab(tab.id);
    }
});

chrome.tabs.onUpdated.addListener((tabId) => {
    void ensurePanelConfiguredForTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeDiscussionTabId) {
        activeDiscussionTabId = null;
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id) {
        return;
    }

    const nextTabId = tab.id;
    const previousTabId = activeDiscussionTabId;

    activeDiscussionTabId = nextTabId;

    if (previousTabId && previousTabId !== nextTabId) {
        chrome.sidePanel.close({ tabId: previousTabId }).catch((error) => {
            console.warn("[discuss-with-chatgpt-ext] previous side panel close failed", {
                previousTabId,
                error
            });
        });
    }

    chrome.sidePanel.open({ tabId: nextTabId }).catch((error) => {
        console.error("[discuss-with-chatgpt-ext] side panel open failed", {
            nextTabId,
            error
        });
    });

    void handleDiscussClick(info, tab);
});

chrome.sidePanel.onClosed.addListener(async (info) => {
    if (info.tabId && info.tabId === activeDiscussionTabId) {
        activeDiscussionTabId = null;
    }

    await chrome.storage.local.set({
        discussPrompt: "",
        discussPromptStamp: Date.now(),
        discussConsumed: false,
        discussSource: undefined,
        closeDiscussion: true,
        discussionSessionId: crypto.randomUUID()
    });
});

async function ensurePanelConfiguredForAllTabs(): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({});

        await Promise.all(
            tabs
                .filter((tab) => typeof tab.id === "number")
                .map((tab) => ensurePanelConfiguredForTab(tab.id!))
        );
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] ensurePanelConfiguredForAllTabs failed", error);
    }
}

async function ensurePanelConfiguredForTab(tabId: number): Promise<void> {
    try {
        await chrome.sidePanel.setOptions({
            tabId,
            path: "sidepanel.html",
            enabled: true
        });
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] ensurePanelConfiguredForTab failed", {
            tabId,
            error
        });
    }
}

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
        const sessionId = crypto.randomUUID();

        await chrome.storage.local.set({
            discussPrompt: prompt,
            discussPromptStamp: Date.now(),
            discussSource: result,
            discussConsumed: false,
            closeDiscussion: false,
            discussionSessionId: sessionId
        });

        console.log("[discuss-with-chatgpt-ext] prompt saved", { sessionId });
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
