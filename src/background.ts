/**
 * Context menu identifier used to distinguish this extension's menu action
 * from any other Chrome context menu events.
 */
const MENU_ID = "discuss-in-chatgpt";

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
    void restorePanelStateForAllTabs();
});

void restorePanelStateForAllTabs();

/**
 * Enables the side panel for newly opened tabs.
 */
chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
        void ensurePanelConfiguredForTab(tab.id);
        void restoreDiscussionMappingForTab(tab.id, tab.url);
    }
});

/**
 * Re-enables the side panel after tab navigation updates its Chrome-managed
 * options.
 */
chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
    void ensurePanelConfiguredForTab(tabId);
    void restoreDiscussionMappingForTab(tabId, tab.url);
});

/**
 * Detaches the tab mapping when a tab closes while keeping discussion history.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    void detachDiscussionFromTab(tabId);
});

/**
 * Opens the current tab's side panel when the extension toolbar icon is clicked.
 *
 * If the tab already has a discussion session, the side panel restores it from
 * storage. Otherwise the panel opens to an empty ChatGPT composer.
 */
chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) {
        return;
    }

    void openDiscussionPanel(tab.id);
});

/**
 * Opens the tab-scoped side panel from the context menu and reuses any existing
 * discussion session before creating a new one from the clicked page.
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id) {
        return;
    }

    void handleContextMenuClick(info, tab);
});

/**
 * Handles extension settings actions.
 */
chrome.runtime.onMessage.addListener((message: Partial<RuntimeMessage> | undefined, _sender, sendResponse) => {
    if (message?.type !== "clear-data-and-cache") {
        return false;
    }

    void clearDataAndCache()
        .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
        .catch((error) => {
            console.error("[discuss-with-chatgpt-ext] clearDataAndCache failed", error);
            sendResponse({
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            } satisfies RuntimeResponse);
        });

    return true;
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
 * Reconnects persisted discussions to currently open tabs and enables panels.
 */
async function restorePanelStateForAllTabs(): Promise<void> {
    try {
        await restoreDiscussionMappingsForOpenTabs();
        await ensurePanelConfiguredForAllTabs();
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] restorePanelStateForAllTabs failed", error);
    }
}

/**
 * Rebuilds tab-session mappings after Chrome restores tabs with new ids.
 */
async function restoreDiscussionMappingsForOpenTabs(): Promise<void> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;
    const discussions = storage.discussions ?? {};
    const discussionEntries = Object.entries(discussions);

    if (discussionEntries.length === 0) {
        await chrome.storage.local.set({ tabSessionIds: {} });
        return;
    }

    const tabs = await chrome.tabs.query({});
    const openTabIds = new Set(
        tabs
            .map((tab) => tab.id)
            .filter((tabId): tabId is number => typeof tabId === "number")
    );
    const tabSessionIds: Record<string, string> = {};
    const assignedSessionIds = new Set<string>();

    for (const [tabId, sessionId] of Object.entries(storage.tabSessionIds ?? {})) {
        const numericTabId = Number(tabId);
        if (openTabIds.has(numericTabId) && discussions[sessionId]) {
            tabSessionIds[tabId] = sessionId;
            assignedSessionIds.add(sessionId);
        }
    }

    for (const tab of tabs) {
        if (typeof tab.id !== "number" || !tab.url || tabSessionIds[String(tab.id)]) {
            continue;
        }

        const entry = discussionEntries.find(([sessionId, discussion]) => {
            return !assignedSessionIds.has(sessionId) && discussion.source.url === tab.url;
        });

        if (!entry) {
            continue;
        }

        const [sessionId] = entry;
        tabSessionIds[String(tab.id)] = sessionId;
        assignedSessionIds.add(sessionId);
    }

    await chrome.storage.local.set({ tabSessionIds });
}

/**
 * Restores one tab mapping when a restored tab later receives its final URL.
 */
async function restoreDiscussionMappingForTab(tabId: number, tabUrl?: string): Promise<void> {
    if (!tabUrl) {
        return;
    }

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;

    if (storage.tabSessionIds?.[String(tabId)]) {
        return;
    }

    const usedSessionIds = new Set(Object.values(storage.tabSessionIds ?? {}));
    const entry = Object.entries(storage.discussions ?? {}).find(([sessionId, discussion]) => {
        return !usedSessionIds.has(sessionId) && discussion.source.url === tabUrl;
    });

    if (!entry) {
        return;
    }

    const [sessionId] = entry;
    await chrome.storage.local.set({
        tabSessionIds: {
            ...(storage.tabSessionIds ?? {}),
            [String(tabId)]: sessionId
        }
    });
}

/**
 * Enables the extension side panel for a single tab.
 */
async function ensurePanelConfiguredForTab(tabId: number): Promise<void> {
    try {
        await chrome.sidePanel.setOptions({
            tabId,
            path: `sidepanel.html?tabId=${tabId}`,
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
 * Opens this extension's side panel for a tab.
 */
function openDiscussionPanel(tabId: number): void {
    chrome.sidePanel.open({ tabId }).catch((error) => {
        console.error("[discuss-with-chatgpt-ext] side panel open failed", {
            tabId,
            message: getErrorMessage(error),
            error
        });
    });

    void ensurePanelConfiguredForTab(tabId);
}

/**
 * Restores a tab's existing discussion session or creates one from the context
 * menu click when none is stored yet.
 */
async function handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab
): Promise<void> {
    if (!tab.id) {
        return;
    }

    openDiscussionPanel(tab.id);

    if (await hasDiscussionForTab(tab.id)) {
        return;
    }

    await createDiscussionFromClick(info, tab);
}

/**
 * Returns whether a tab has a stored session with a matching discussion entry.
 */
async function hasDiscussionForTab(tabId: number): Promise<boolean> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;
    const sessionId = storage.tabSessionIds?.[String(tabId)];

    return Boolean(sessionId && storage.discussions?.[sessionId]);
}

/**
 * Closes open side panels and removes extension-owned persisted state.
 */
async function clearDataAndCache(): Promise<void> {
    await chrome.storage.local.set({
        clearAllDiscussionDraftsStamp: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs
            .filter((tab) => typeof tab.id === "number")
            .map((tab) => {
                return chrome.sidePanel.close({ tabId: tab.id! }).catch(() => undefined);
            })
    );

    await chrome.storage.local.clear();
    await clearSessionStorage();
    await clearCacheStorage();
    await ensurePanelConfiguredForAllTabs();
}

/**
 * Clears optional extension session storage when the browser exposes it.
 */
async function clearSessionStorage(): Promise<void> {
    const sessionStorage = (chrome.storage as { session?: chrome.storage.StorageArea }).session;
    await sessionStorage?.clear();
}

/**
 * Clears CacheStorage entries owned by the extension origin.
 */
async function clearCacheStorage(): Promise<void> {
    if (typeof caches === "undefined") {
        return;
    }

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
}

/**
 * Collects source data from the clicked tab, builds the ChatGPT prompt, and
 * stores it under a fresh session id for the side panel/content script pair.
 */
async function createDiscussionFromClick(
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
        console.error("[discuss-with-chatgpt-ext] createDiscussionFromClick failed", error);
    }
}

/**
 * Removes the tab-to-session mapping while preserving the discussion for restore.
 */
async function detachDiscussionFromTab(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get("tabSessionIds")) as StorageShape;
    const tabKey = String(tabId);

    if (!storage.tabSessionIds?.[tabKey]) {
        return;
    }

    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };
    delete tabSessionIds[tabKey];

    await chrome.storage.local.set({ tabSessionIds });
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

/**
 * Converts unknown caught values into useful log text.
 */
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
