/**
 * Context menu identifiers used to distinguish this extension's menu actions
 * from any other Chrome context menu events.
 */
const MENU_PARENT_ID = "discuss-in-chatgpt";
const MENU_ORIGINAL_LANGUAGE_ID = "discuss-in-chatgpt-original-language";
const MENU_PREFERRED_LANGUAGE_PREFIX = "discuss-in-chatgpt-preferred-language-";
const DEFAULT_PREFERRED_LANGUAGE = "English";
const ORIGINAL_LANGUAGE_LABEL = "Original language";

/**
 * Registers the context menu after install and enables side panel support for
 * tabs that already exist.
 */
chrome.runtime.onInstalled.addListener(() => {
    createContextMenus();

    void ensurePanelConfiguredForAllTabs();
});

/**
 * Prepares restored tabs without trying to open the side panel.
 */
chrome.runtime.onStartup.addListener(() => {
    void restoreMappingsAndConfigurePanels();
    createContextMenus();
});

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
    void clearPendingLanguageMismatch(tabId);
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
    const menuItemId = String(info.menuItemId);

    if (!isDiscussionMenuItem(menuItemId) || !tab?.id) {
        return;
    }

    void handleContextMenuClick(info, tab, menuItemId);
});

/**
 * Keeps preferred-language context menu items aligned with settings.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes["preferredLanguage"]) {
        createContextMenus();
    }
});

/**
 * Handles extension settings actions.
 */
chrome.runtime.onMessage.addListener((message: Partial<RuntimeMessage> | undefined, _sender, sendResponse) => {
    switch (message?.type) {
        case "clear-data-and-cache":
            void clearDataAndCache()
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("clearDataAndCache failed", error, sendResponse));
            return true;

        case "restart-discussion":
            void restartDiscussion(message)
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("restartDiscussion failed", error, sendResponse));
            return true;

        default:
            return false;
    }
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
 * Registers the parent context menu and its language-specific child actions.
 */
function createContextMenus(): void {
    chrome.contextMenus.removeAll(() => {
        void createContextMenusAfterClear();
    });
}

/**
 * Builds context menu items after Chrome has removed the previous tree.
 */
async function createContextMenusAfterClear(): Promise<void> {
    const preferredLanguages = await getPreferredLanguages();

    chrome.contextMenus.create({
        id: MENU_PARENT_ID,
        title: "Discuss with ChatGPT",
        contexts: ["page", "selection"]
    });

    chrome.contextMenus.create({
        id: MENU_ORIGINAL_LANGUAGE_ID,
        parentId: MENU_PARENT_ID,
        title: "In original language",
        contexts: ["page", "selection"]
    });

    preferredLanguages.forEach((language, index) => {
        chrome.contextMenus.create({
            id: `${MENU_PREFERRED_LANGUAGE_PREFIX}${index}`,
            parentId: MENU_PARENT_ID,
            title: `In ${language}`,
            contexts: ["page", "selection"]
        });
    });
}

/**
 * Returns whether the clicked context menu item belongs to this extension.
 */
function isDiscussionMenuItem(menuItemId: string): boolean {
    return menuItemId === MENU_ORIGINAL_LANGUAGE_ID || menuItemId.startsWith(MENU_PREFERRED_LANGUAGE_PREFIX);
}

/**
 * Resolves the preferred response language represented by a submenu id.
 */
async function getMenuPreferredLanguage(menuItemId: string): Promise<string | undefined> {
    if (menuItemId === MENU_ORIGINAL_LANGUAGE_ID) {
        return undefined;
    }

    const index = Number(menuItemId.slice(MENU_PREFERRED_LANGUAGE_PREFIX.length));
    const preferredLanguages = await getPreferredLanguages();

    return Number.isInteger(index) ? preferredLanguages[index] : undefined;
}

/**
 * Reconnects persisted discussions to currently open tabs and enables panels.
 */
async function restoreMappingsAndConfigurePanels(): Promise<void> {
    try {
        await restoreDiscussionMappingsForOpenTabs();
        await ensurePanelConfiguredForAllTabs();
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] restoreMappingsAndConfigurePanels failed", error);
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
    tab: chrome.tabs.Tab,
    menuItemId: string
): Promise<void> {
    if (!tab.id) {
        return;
    }

    openDiscussionPanel(tab.id);

    const preferredLanguage = await getMenuPreferredLanguage(menuItemId);
    const existingDiscussion = await getDiscussionForTab(tab.id);

    if (existingDiscussion) {
        await handleExistingDiscussionLanguage(tab.id, info.selectionText ?? "", existingDiscussion, preferredLanguage);
        return;
    }

    await clearPendingLanguageMismatch(tab.id);
    await createDiscussionFromTab(tab, info.selectionText ?? "", preferredLanguage);
}

/**
 * Returns a tab's stored session with a matching discussion entry.
 */
async function getDiscussionForTab(tabId: number): Promise<DiscussionState | null> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as StorageShape;
    const sessionId = storage.tabSessionIds?.[String(tabId)];

    return sessionId ? storage.discussions?.[sessionId] ?? null : null;
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
    createContextMenus();
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
 * Stores or clears the language decision needed for an existing session.
 */
async function handleExistingDiscussionLanguage(
    tabId: number,
    selectionText: string,
    discussion: DiscussionState,
    preferredLanguage?: string
): Promise<void> {
    const requestedLanguage = preferredLanguage ?? ORIGINAL_LANGUAGE_LABEL;
    const currentLanguage = discussion.responseLanguage ?? ORIGINAL_LANGUAGE_LABEL;

    if (requestedLanguage === currentLanguage) {
        await clearPendingLanguageMismatch(tabId);
        return;
    }

    await setPendingLanguageMismatch({
        tabId,
        currentLanguage,
        requestedLanguage,
        selectionText,
        stamp: Date.now()
    });
}

/**
 * Restarts a tab discussion from the side panel language mismatch prompt.
 */
async function restartDiscussion(message: Partial<RuntimeMessage>): Promise<void> {
    if (message.type !== "restart-discussion" || typeof message.tabId !== "number") {
        throw new Error("Restart request is missing tab id");
    }

    if (typeof message.requestedLanguage !== "string") {
        throw new Error("Restart request is missing language");
    }

    const tab = await chrome.tabs.get(message.tabId);
    const restarted = await createDiscussionFromTab(tab, message.selectionText ?? "", message.requestedLanguage);
    if (!restarted) {
        throw new Error("Restart operation failed");
    }

    await clearPendingLanguageMismatch(message.tabId);
}

/**
 * Stores a tab-scoped language mismatch prompt for the side panel.
 */
async function setPendingLanguageMismatch(mismatch: PendingLanguageMismatch): Promise<void> {
    const storage = (await chrome.storage.local.get("pendingLanguageMismatches")) as StorageShape;

    await chrome.storage.local.set({
        pendingLanguageMismatches: {
            ...(storage.pendingLanguageMismatches ?? {}),
            [String(mismatch.tabId)]: mismatch
        }
    });
}

/**
 * Clears a tab-scoped language mismatch prompt.
 */
async function clearPendingLanguageMismatch(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get("pendingLanguageMismatches")) as StorageShape;
    const tabKey = String(tabId);

    if (!storage.pendingLanguageMismatches?.[tabKey]) {
        return;
    }

    const pendingLanguageMismatches = { ...(storage.pendingLanguageMismatches ?? {}) };
    delete pendingLanguageMismatches[tabKey];

    await chrome.storage.local.set({ pendingLanguageMismatches });
}

/**
 * Collects source data from the clicked tab, builds the ChatGPT prompt, and
 * stores it under a fresh session id for the side panel/content script pair.
 */
async function createDiscussionFromTab(
    tab: chrome.tabs.Tab,
    selectionText: string,
    preferredLanguage?: string
): Promise<boolean> {
    if (!tab.id) {
        return false;
    }

    try {
        // executeScript runs collectPageData in the page, not in this service worker
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: collectPageData,
            args: [selectionText]
        });

        const result = injectionResults[0]?.result;
        if (!result) {
            return false;
        }

        const prompt = buildPrompt(result, preferredLanguage);
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
            consumed: false,
            responseLanguage: preferredLanguage ?? ORIGINAL_LANGUAGE_LABEL
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
        return true;
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] createDiscussionFromTab failed", error);
        return false;
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
function buildPrompt(data: DiscussSource, preferredLanguage?: string): string {
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
        paragraph(getResponseLanguageInstruction(preferredLanguage))
    );

    return parts.join("\n");
}

/**
 * Returns the currently configured preferred response languages.
 */
async function getPreferredLanguages(): Promise<string[]> {
    const storage = (await chrome.storage.local.get("preferredLanguage")) as StorageShape;
    return normalizePreferredLanguages(storage.preferredLanguage);
}

/**
 * Converts stored or user-entered language values into usable menu labels.
 */
function normalizePreferredLanguages(value: unknown): string[] {
    if (typeof value !== "string") {
        return [DEFAULT_PREFERRED_LANGUAGE];
    }

    const languages = value
        .split(",")
        .map((language) => language.trim())
        .filter((language) => language.length > 0);

    return languages.length > 0 ? languages : [DEFAULT_PREFERRED_LANGUAGE];
}

/**
 * Builds the prompt instruction for original-language or preferred-language replies.
 */
function getResponseLanguageInstruction(preferredLanguage?: string): string {
    if (preferredLanguage) {
        return `Use ${preferredLanguage} for your response.`;
    }

    return "Use the language of the original material for your response.";
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

/**
 * Sends a normalized runtime error response and keeps logs consistent.
 */
function sendErrorResponse(
    label: string,
    error: unknown,
    sendResponse: (response: RuntimeResponse) => void
): void {
    console.error(`[discuss-with-chatgpt-ext] ${label}`, error);
    sendResponse({
        ok: false,
        error: getErrorMessage(error)
    });
}
