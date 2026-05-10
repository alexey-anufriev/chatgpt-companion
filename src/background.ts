/**
 * Context menu identifier used to distinguish this extension's menu action
 * from any other Chrome context menu events.
 */
const MENU_ID = "discuss-in-chatgpt";

/**
 * Tracks the tab whose side panel is currently dedicated to an active
 * discussion, so opening a new discussion can close the previous panel.
 */
let activeDiscussionTabId: number | null = null;

/**
 * Registers the context menu after install and enables side panel support for
 * tabs that already exist.
 */
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: MENU_ID,
        title: "Discuss with ChatGPT",
        contexts: ["page", "selection"]
    });

    void ensurePanelConfiguredForAllTabs();
});

/**
 * Re-applies side panel options when Chrome restarts the extension service
 * worker.
 */
chrome.runtime.onStartup.addListener(() => {
    void ensurePanelConfiguredForAllTabs();
});

/**
 * Enables the side panel for newly opened tabs.
 */
chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
        void ensurePanelConfiguredForTab(tab.id);
    }
});

/**
 * Re-enables the side panel after tab navigation updates its Chrome-managed
 * options.
 */
chrome.tabs.onUpdated.addListener((tabId) => {
    void ensurePanelConfiguredForTab(tabId);
});

/**
 * Clears discussion storage and active-panel bookkeeping when a tab closes.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeDiscussionTabId) {
        activeDiscussionTabId = null;
    }

    void clearDiscussionForTab(tabId);
});

/**
 * Starts a new discussion from the context menu, opens the tab-scoped side
 * panel, and stores the prompt for the content script to pick up.
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id) {
        return;
    }

    const nextTabId = tab.id;
    const previousTabId = activeDiscussionTabId;

    activeDiscussionTabId = nextTabId;

    // keep only one tab-scoped discussion panel visible at a time
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

/**
 * Removes the stored discussion when the user closes the side panel manually.
 */
chrome.sidePanel.onClosed.addListener(async (info) => {
    if (info.tabId && info.tabId === activeDiscussionTabId) {
        activeDiscussionTabId = null;
    }

    if (typeof info.tabId !== "number") {
        return;
    }

    await clearDiscussionForTab(info.tabId);
});

/**
 * Enables the extension side panel for every currently open tab.
 *
 * Chrome does not automatically apply side panel options to tabs that already
 * exist when the service worker starts, so startup and install paths both use
 * this sweep to keep the context menu flow available everywhere.
 */
async function ensurePanelConfiguredForAllTabs(): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({});

        // filter first so Promise.all only receives concrete tab ids
        await Promise.all(
            tabs
                .filter((tab) => typeof tab.id === "number")
                .map((tab) => ensurePanelConfiguredForTab(tab.id!))
        );
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] ensurePanelConfiguredForAllTabs failed", error);
    }
}

/**
 * Enables the extension side panel for a single tab.
 */
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

/**
 * Collects source data from the clicked tab, builds the ChatGPT prompt, and
 * stores it under a fresh session id for the side panel/content script pair.
 */
async function handleDiscussClick(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab
): Promise<void> {
    if (!tab.id) {
        return;
    }

    try {
        // executeScript runs collectPageData in the page, not in this service worker
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
        const storage = (await chrome.storage.local.get([
            "discussions",
            "tabSessionIds"
        ])) as StorageShape;
        const previousSessionId = storage.tabSessionIds?.[String(tab.id)];
        const discussions = { ...(storage.discussions ?? {}) };
        const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };

        // replace the tab's prior session so stale prompts are not retained
        if (previousSessionId) {
            delete discussions[previousSessionId];
        }

        discussions[sessionId] = {
            prompt,
            stamp: Date.now(),
            source: result,
            consumed: false
        };
        tabSessionIds[String(tab.id)] = sessionId;

        // clearing closeDiscussionSessionId prevents an older close event from
        // erasing the freshly inserted ChatGPT draft
        await chrome.storage.local.set({
            discussions,
            tabSessionIds,
            closeDiscussionSessionId: undefined
        });

        console.log("[discuss-with-chatgpt-ext] prompt saved", { sessionId, tabId: tab.id });
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] handleDiscussClick failed", error);
    }
}

/**
 * Removes any discussion session associated with a tab and records the closed
 * session id so the ChatGPT content script can clear a stale draft.
 */
async function clearDiscussionForTab(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;
    const tabKey = String(tabId);
    const sessionId = storage.tabSessionIds?.[tabKey];

    if (!sessionId) {
        return;
    }

    const discussions = { ...(storage.discussions ?? {}) };
    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };

    delete discussions[sessionId];
    delete tabSessionIds[tabKey];

    await chrome.storage.local.set({
        discussions,
        tabSessionIds,
        closeDiscussionSessionId: sessionId
    });
}

/**
 * Runs in the page context and returns the minimal source metadata used to
 * create a discussion prompt.
 */
function collectPageData(selectionText: string): DiscussSource {
    return {
        title: document.title || "",
        url: location.href || "",
        selection: selectionText || ""
    };
}

/**
 * Builds the prompt inserted into ChatGPT from the selected page metadata.
 */
function buildPrompt(data: DiscussSource): string {
    const hasSelection = data.selection && data.selection.trim().length > 0;

    const parts: string[] = [
        paragraph("Hi, I’d like to discuss the following content."),
        paragraph(`Title: ${data.title || "(no title)"}`),
        paragraph(`URL: ${data.url || "(no url)"}`)
    ];

    if (hasSelection) {
        // keep the stored prompt bounded so large selections remain cheap to
        // move through extension storage and into the ChatGPT composer
        const MAX = 4000;
        const selection = data.selection.trim().slice(0, MAX);

        parts.push(
            paragraph("Selected excerpt:"),
            paragraph(selection),
            paragraph("Focus primarily on this excerpt.")
        );
    }

    parts.push(
        paragraph("Please:"),
        paragraph("- Provide a concise summary"),
        paragraph("- Identify the main idea"),
        paragraph("- Highlight what is actually important"),
        paragraph("- Point out weak or questionable parts"),
        paragraph("Use the language of the original material for your response.")
    );

    return parts.join("\n");
}

/**
 * Wraps one prompt block in a paragraph tag so ChatGPT receives explicit block
 * boundaries instead of relying on blank-line spacing.
 */
function paragraph(text: string): string {
    return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

/**
 * Escapes page-provided text before it is embedded in the prompt HTML.
 */
function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "\"":
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return char;
        }
    });
}
