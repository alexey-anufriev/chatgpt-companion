import {
    getDefaultPromptTemplates
} from "./prompts.js";
import {
    hasSyncedSettings,
    normalizeHiddenDefaultPromptTemplateIds,
    normalizePreferredChatMode,
    normalizePreferredLanguage,
    normalizePreferredSendingMode,
    SYNC_SETTING_KEYS
} from "./settings.js";
import type {
    PromptTemplate,
    State
} from "./settings.js";
import type {
    RuntimeMessage,
    RuntimeResponse
} from "./events.js";
import type {
    DiscussionMismatch,
    DiscussionSource,
    DiscussionState
} from "./context.js";

/**
 * Context menu identifiers used to distinguish this extension's menu actions
 * from any other Chrome context menu events.
 */
const MENU_PARENT_ID = "discuss-in-chatgpt";
const MENU_TEMPLATE_PREFIX = "discuss-in-chatgpt-template-";
const COMMAND_OPEN_PROMPT_PICKER = "open-prompt-picker";
const ORIGINAL_LANGUAGE_LABEL = "Original language";

/**
 * Registers the context menu after install and enables side panel support for
 * tabs that already exist.
 */
chrome.runtime.onInstalled.addListener(() => {
    void initializeSettingsAndMenus();

    void ensurePanelConfiguredForAllTabs();
});

/**
 * Prepares restored tabs without trying to open the side panel.
 */
chrome.runtime.onStartup.addListener(() => {
    void restoreMappingsAndConfigurePanels();
    void initializeSettingsAndMenus();
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
    void clearDiscussionMismatch(tabId);
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

    openDiscussionPanel(tab.id);
    void clearTemporaryDiscussionForTab(tab.id);
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

chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== COMMAND_OPEN_PROMPT_PICKER) {
        return;
    }

    void openPromptPicker(tab).catch((error) => {
        console.error("[chatgpt-companion] prompt picker open failed", error);
    });
});

/**
 * Keeps prompt-template context menu items aligned with settings.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
        areaName === "local" &&
        (
            changes["preferredLanguage"] ||
            changes["hiddenDefaultPromptTemplateIds"] ||
            changes["promptTemplates"]
        )
    ) {
        createContextMenus();
    }

    if (
        areaName === "sync" &&
        (
            changes["preferredLanguage"] ||
            changes["preferredSendingMode"] ||
            changes["preferredChatMode"] ||
            changes["hiddenDefaultPromptTemplateIds"] ||
            changes["promptTemplates"]
        )
    ) {
        void pullCloudSettingsToLocal()
            .then((didPull) => {
                if (didPull) {
                    createContextMenus();
                }
            })
            .catch((error) => {
                console.error("[chatgpt-companion] cloud settings pull failed", error);
            });
    }
});

/**
 * Handles extension settings actions.
 */
chrome.runtime.onMessage.addListener((message: Partial<RuntimeMessage> | undefined, sender, sendResponse) => {
    switch (message?.type) {
        case "clear-data-and-cache":
            void clearDataAndCache()
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("clearDataAndCache failed", error, sendResponse));
            return true;

        case "continue-discussion":
            void continueDiscussion(message)
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("continueDiscussion failed", error, sendResponse));
            return true;

        case "start-new-discussion":
            void startNewDiscussion(message)
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("startNewDiscussion failed", error, sendResponse));
            return true;

        case "sync-session-tabs":
            void restoreDiscussionMappingsForOpenTabs()
                .then((tabSessionIds) => sendResponse({
                    ok: true,
                    tabSessionIds
                } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("syncSessionTabs failed", error, sendResponse));
            return true;

        case "focus-session-tab":
            void focusSessionTab(message)
                .then((focusedTabId) => sendResponse({
                    ok: true,
                    focusedTabId
                } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("focusSessionTab failed", error, sendResponse));
            return true;

        case "delete-session":
            void deleteSession(message)
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("deleteSession failed", error, sendResponse));
            return true;

        case "prompt-picker-selected":
            void handlePromptPickerSelection(message, sender.tab)
                .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
                .catch((error) => sendErrorResponse("promptPickerSelected failed", error, sendResponse));
            return true;

        default:
            return false;
    }
});

/**
 * Returns every current concrete tab id.
 */
async function getOpenTabIds(): Promise<number[]> {
    const tabs = await chrome.tabs.query({});
    return tabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => typeof tabId === "number");
}

/**
 * Enables the extension side panel for every currently open tab.
 *
 * Chrome does not automatically apply side panel options to tabs that already
 * exist when the service worker starts, so startup and install paths both use
 * this sweep to keep the context menu flow available everywhere.
 */
async function ensurePanelConfiguredForAllTabs(): Promise<void> {
    try {
        const tabIds = await getOpenTabIds();

        await Promise.all(
            tabIds.map((tabId) => ensurePanelConfiguredForTab(tabId))
        );
    } catch (error) {
        console.error("[chatgpt-companion] ensurePanelConfiguredForAllTabs failed", error);
    }
}

/**
 * Pulls synced settings before building settings-driven context menus.
 */
async function initializeSettingsAndMenus(): Promise<void> {
    try {
        await pullCloudSettingsToLocal();
    } catch (error) {
        console.error("[chatgpt-companion] cloud settings startup pull failed", error);
    } finally {
        createContextMenus();
    }
}

/**
 * Copies cloud settings into local storage when cloud sync is enabled.
 */
async function pullCloudSettingsToLocal(): Promise<boolean> {
    const localSettings = (await chrome.storage.local.get("cloudSyncEnabled")) as State;

    if (!localSettings.cloudSyncEnabled) {
        return false;
    }

    const cloudSettings = (await chrome.storage.sync.get(SYNC_SETTING_KEYS)) as State;

    if (!cloudSettings.cloudSyncEnabled && !hasSyncedSettings(cloudSettings)) {
        return false;
    }

    await chrome.storage.local.set({
        preferredLanguage: normalizePreferredLanguage(cloudSettings.preferredLanguage),
        preferredSendingMode: normalizePreferredSendingMode(cloudSettings.preferredSendingMode),
        preferredChatMode: normalizePreferredChatMode(cloudSettings.preferredChatMode),
        hiddenDefaultPromptTemplateIds: normalizeHiddenDefaultPromptTemplateIds(cloudSettings.hiddenDefaultPromptTemplateIds),
        promptTemplates: normalizePromptTemplates(cloudSettings.promptTemplates)
    });

    return true;
}

/**
 * Registers the parent context menu and its prompt-template actions.
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
    const promptTemplates = await getPromptTemplates();

    chrome.contextMenus.create({
        id: MENU_PARENT_ID,
        title: "Discuss with ChatGPT",
        contexts: ["page", "selection", "link"]
    });

    promptTemplates.forEach((promptTemplate, promptTemplateIndex) => {
        chrome.contextMenus.create({
            id: `${MENU_TEMPLATE_PREFIX}${promptTemplateIndex}`,
            parentId: MENU_PARENT_ID,
            title: `Using "${promptTemplate.name}"`,
            contexts: ["page", "selection", "link"]
        });
    });
}

/**
 * Returns whether the clicked context menu item belongs to this extension.
 */
function isDiscussionMenuItem(menuItemId: string): boolean {
    return menuItemId.startsWith(MENU_TEMPLATE_PREFIX);
}

/**
 * Resolves the prompt template represented by a context menu id.
 */
async function getMenuPromptTemplate(menuItemId: string): Promise<PromptTemplate> {
    const promptTemplates = await getPromptTemplates();

    if (!menuItemId.startsWith(MENU_TEMPLATE_PREFIX)) {
        return promptTemplates[0];
    }

    const promptTemplateIndex = Number(menuItemId.slice(MENU_TEMPLATE_PREFIX.length));
    return Number.isInteger(promptTemplateIndex) ? promptTemplates[promptTemplateIndex] ?? promptTemplates[0] : promptTemplates[0];
}

/**
 * Reconnects persisted discussions to currently open tabs and enables panels.
 */
async function restoreMappingsAndConfigurePanels(): Promise<void> {
    try {
        await restoreDiscussionMappingsForOpenTabs();
        await ensurePanelConfiguredForAllTabs();
    } catch (error) {
        console.error("[chatgpt-companion] restoreMappingsAndConfigurePanels failed", error);
    }
}

/**
 * Rebuilds tab-session mappings after Chrome restores tabs with new ids.
 */
async function restoreDiscussionMappingsForOpenTabs(): Promise<Record<string, string>> {
    await clearPersistedTemporaryDiscussions();

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const discussions = storage.discussions ?? {};
    const discussionEntries = Object.entries(discussions);

    if (discussionEntries.length === 0) {
        if (!areStringRecordsEqual(storage.tabSessionIds ?? {}, {})) {
            await chrome.storage.local.set({ tabSessionIds: {} });
        }

        return {};
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
            return !discussion.temporary &&
                !assignedSessionIds.has(sessionId) &&
                discussion.source.url === tab.url;
        });

        if (!entry) {
            continue;
        }

        const [sessionId] = entry;
        tabSessionIds[String(tab.id)] = sessionId;
        assignedSessionIds.add(sessionId);
    }

    if (!areStringRecordsEqual(storage.tabSessionIds ?? {}, tabSessionIds)) {
        await chrome.storage.local.set({ tabSessionIds });
    }

    return tabSessionIds;
}

function areStringRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);

    return leftEntries.length === rightEntries.length &&
        leftEntries.every(([key, value]) => right[key] === value);
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
    ])) as State;

    if (storage.tabSessionIds?.[String(tabId)]) {
        return;
    }

    const usedSessionIds = new Set(Object.values(storage.tabSessionIds ?? {}));
    const entry = Object.entries(storage.discussions ?? {}).find(([sessionId, discussion]) => {
        return !discussion.temporary &&
            !usedSessionIds.has(sessionId) &&
            discussion.source.url === tabUrl;
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
            path: `sidepanel/index.html?tabId=${tabId}`,
            enabled: true
        });
    } catch (error) {
        console.error("[chatgpt-companion] ensurePanelConfiguredForTab failed", {
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
        const message = getErrorMessage(error);
        console.error(`[chatgpt-companion] side panel open failed: ${message}`, {
            tabId,
            error
        });
    });
}

/**
 * Marks a tab as waiting for a newly collected discussion prompt.
 */
function markDiscussionPending(tabId: number): void {
    void updatePendingDiscussionTab(tabId, true).catch((error) => {
        console.error("[chatgpt-companion] pending discussion mark failed", error);
    });
}

/**
 * Clears a tab's prompt-creation pending marker.
 */
async function clearDiscussionPending(tabId: number): Promise<void> {
    await updatePendingDiscussionTab(tabId, false);
}

async function updatePendingDiscussionTab(tabId: number, isPending: boolean): Promise<void> {
    const storage = (await chrome.storage.local.get("pendingDiscussionTabIds")) as State;
    const pendingDiscussionTabIds = { ...(storage.pendingDiscussionTabIds ?? {}) };
    const tabKey = String(tabId);

    if (isPending) {
        pendingDiscussionTabIds[tabKey] = Date.now();
    } else {
        delete pendingDiscussionTabIds[tabKey];
    }

    await chrome.storage.local.set({ pendingDiscussionTabIds });
}

/**
 * Injects the prompt picker content script into the active page and asks it to
 * show the overlay for the current templates.
 */
async function openPromptPicker(tab?: chrome.tabs.Tab): Promise<void> {
    if (!tab?.id) {
        throw new Error("Prompt picker requires an active tab");
    }

    const promptTemplates = (await getPromptTemplates()).map((promptTemplate) => ({
        id: promptTemplate.id,
        name: promptTemplate.name
    }));

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["prompt-picker/index.js"]
    });

    await chrome.tabs.sendMessage(tab.id, {
        type: "show-prompt-picker",
        promptTemplates
    });
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

    markDiscussionPending(tab.id);
    openDiscussionPanel(tab.id);

    try {
        await clearTemporaryDiscussionForTab(tab.id);

        const promptTemplate = await getMenuPromptTemplate(menuItemId);
        await openOrUpdateDiscussionFromTemplate(tab, promptTemplate, info.selectionText ?? "", info.linkUrl);
    } finally {
        await clearDiscussionPending(tab.id);
    }
}

/**
 * Reuses an existing tab discussion when possible or creates a new one from the
 * selected template and source.
 */
async function openOrUpdateDiscussionFromTemplate(
    tab: chrome.tabs.Tab,
    promptTemplate: PromptTemplate,
    selectionText: string,
    requestedLinkUrl?: string
): Promise<void> {
    if (!tab.id) {
        return;
    }

    const preferredLanguage = await getPreferredLanguage();
    const requestedSourceUrl = requestedLinkUrl ?? tab.url ?? "";
    const existingDiscussion = await getDiscussionForTab(tab.id);

    if (existingDiscussion) {
        await handleExistingDiscussionLanguage(
            tab.id,
            selectionText,
            existingDiscussion,
            promptTemplate,
            getRequestedResponseLanguage(promptTemplate, preferredLanguage),
            requestedLinkUrl,
            existingDiscussion.source.url !== requestedSourceUrl || existingDiscussion.source.selection !== selectionText
        );
        return;
    }

    await clearDiscussionMismatch(tab.id);

    if (requestedLinkUrl) {
        await createDiscussionFromLink(tab, requestedLinkUrl, selectionText, promptTemplate);
        return;
    }

    await createDiscussionFromTab(tab, selectionText, promptTemplate);
}

/**
 * Returns a tab's stored session with a matching discussion entry.
 */
async function getDiscussionForTab(tabId: number): Promise<DiscussionState | null> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const sessionId = storage.tabSessionIds?.[String(tabId)];

    return sessionId ? storage.discussions?.[sessionId] ?? null : null;
}

/**
 * Closes open side panels and removes persisted discussion state.
 */
async function clearDataAndCache(): Promise<void> {
    await chrome.storage.local.set({
        clearAllDiscussionDraftsStamp: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const tabIds = await getOpenTabIds();
    await Promise.all(
        tabIds.map((tabId) => chrome.sidePanel.close({ tabId }).catch(() => undefined))
    );

    await chrome.storage.local.remove([
        "discussions",
        "tabSessionIds",
        "discussionMismatches",
        "pendingDiscussionTabIds",
        "closeDiscussionSessionId",
        "clearAllDiscussionDraftsStamp"
    ]);
    await clearSessionStorage();
    await clearCacheStorage();
    createContextMenus();
    await ensurePanelConfiguredForAllTabs();
}

/**
 * Focuses the browser tab currently mapped to a persisted discussion session.
 */
async function focusSessionTab(message: Partial<RuntimeMessage>): Promise<number> {
    if (message.type !== "focus-session-tab" || typeof message.sessionId !== "string") {
        throw new Error("Focus request is missing session id");
    }

    const tabSessionIds = await restoreDiscussionMappingsForOpenTabs();
    const tabId = Object.entries(tabSessionIds).find(([, sessionId]) => {
        return sessionId === message.sessionId;
    })?.[0];

    if (!tabId) {
        throw new Error("Session is not attached to an open tab");
    }

    const numericTabId = Number(tabId);
    const tab = await chrome.tabs.get(numericTabId);

    if (typeof tab.windowId === "number") {
        await chrome.windows.update(tab.windowId, { focused: true });
    }

    await chrome.tabs.update(numericTabId, { active: true });
    return numericTabId;
}

/**
 * Removes one persisted discussion and any open-tab mappings that point to it.
 */
async function deleteSession(message: Partial<RuntimeMessage>): Promise<void> {
    if (message.type !== "delete-session" || typeof message.sessionId !== "string") {
        throw new Error("Delete request is missing session id");
    }

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds",
        "discussionMismatches"
    ])) as State;

    const discussions = { ...(storage.discussions ?? {}) };
    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };
    const discussionMismatches = { ...(storage.discussionMismatches ?? {}) };
    const removedTabIds: string[] = [];

    delete discussions[message.sessionId];

    for (const [tabId, sessionId] of Object.entries(tabSessionIds)) {
        if (sessionId !== message.sessionId) {
            continue;
        }

        delete tabSessionIds[tabId];
        delete discussionMismatches[tabId];
        removedTabIds.push(tabId);
    }

    await chrome.storage.local.set({
        discussions,
        tabSessionIds,
        discussionMismatches,
        closeDiscussionSessionId: message.sessionId
    });

    await Promise.all(
        removedTabIds.map((tabId) => ensurePanelConfiguredForTab(Number(tabId)))
    );
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
 * Stores or clears the restart decision needed for an existing session.
 */
async function handleExistingDiscussionLanguage(
    tabId: number,
    selectionText: string,
    discussion: DiscussionState,
    promptTemplate: PromptTemplate,
    requestedLanguage: string,
    requestedLinkUrl: string | undefined,
    requestedSourceChanged: boolean
): Promise<void> {
    const currentLanguage = discussion.responseLanguage;
    const currentPromptTemplateId = discussion.promptTemplateId;
    const currentPromptTemplateName = discussion.promptTemplateName;
    const isSamePromptTemplate = currentPromptTemplateId
        ? promptTemplate.id === currentPromptTemplateId
        : promptTemplate.name === currentPromptTemplateName;

    if (
        requestedLanguage === currentLanguage &&
        isSamePromptTemplate &&
        !requestedSourceChanged
    ) {
        await clearDiscussionMismatch(tabId);
        return;
    }

    await setDiscussionMismatch({
        tabId,
        currentLanguage,
        currentPromptTemplateName,
        requestedLanguage,
        requestedPromptTemplateId: promptTemplate.id,
        requestedPromptTemplateName: promptTemplate.name,
        requestedLinkUrl,
        requestedSourceChanged,
        selectionText
    });
}

/**
 * Adds the requested prompt to the existing tab discussion without replacing it.
 */
async function continueDiscussion(message: Partial<RuntimeMessage>): Promise<void> {
    if (message.type !== "continue-discussion" || typeof message.tabId !== "number") {
        throw new Error("Continue request is missing tab id");
    }

    if (typeof message.requestedPromptTemplateId !== "string") {
        throw new Error("Continue request is missing prompt template");
    }

    const tab = await chrome.tabs.get(message.tabId);
    const promptTemplate = await getPromptTemplateById(message.requestedPromptTemplateId);
    const source = message.requestedLinkUrl ?
        await collectLinkSourceFromTab(tab, message.requestedLinkUrl, message.selectionText ?? "") :
        await collectPageSourceFromTab(tab, message.selectionText ?? "");

    if (!source || !tab.id) {
        throw new Error("Continue operation failed");
    }

    await updateContinuationPrompt(tab.id, source, promptTemplate);
    await clearDiscussionMismatch(message.tabId);
}

/**
 * Replaces the current tab discussion with a separate new chat.
 */
async function startNewDiscussion(message: Partial<RuntimeMessage>): Promise<void> {
    if (message.type !== "start-new-discussion" || typeof message.tabId !== "number") {
        throw new Error("Start new request is missing tab id");
    }

    if (typeof message.requestedPromptTemplateId !== "string") {
        throw new Error("Start new request is missing prompt template");
    }

    const tab = await chrome.tabs.get(message.tabId);
    const promptTemplate = await getPromptTemplateById(message.requestedPromptTemplateId);
    const started = message.requestedLinkUrl ?
        await createDiscussionFromLink(tab, message.requestedLinkUrl, message.selectionText ?? "", promptTemplate) :
        await createDiscussionFromTab(tab, message.selectionText ?? "", promptTemplate);

    if (!started) {
        throw new Error("Start new operation failed");
    }

    await clearDiscussionMismatch(message.tabId);
}

/**
 * Starts the normal discussion flow from a template chosen in the prompt picker.
 */
async function handlePromptPickerSelection(
    message: Partial<RuntimeMessage>,
    tab?: chrome.tabs.Tab
): Promise<void> {
    if (
        message.type !== "prompt-picker-selected" ||
        typeof message.requestedPromptTemplateId !== "string"
    ) {
        throw new Error("Prompt picker request is missing prompt template");
    }

    if (!tab?.id) {
        throw new Error("Prompt picker request is missing tab");
    }

    markDiscussionPending(tab.id);
    openDiscussionPanel(tab.id);

    try {
        await clearTemporaryDiscussionForTab(tab.id);

        const promptTemplate = await getPromptTemplateById(message.requestedPromptTemplateId);
        await openOrUpdateDiscussionFromTemplate(tab, promptTemplate, message.selectionText ?? "");
    } finally {
        await clearDiscussionPending(tab.id);
    }
}

/**
 * Stores a tab-scoped discussion mismatch prompt for the side panel.
 */
async function setDiscussionMismatch(mismatch: DiscussionMismatch): Promise<void> {
    const storage = (await chrome.storage.local.get("discussionMismatches")) as State;

    await chrome.storage.local.set({
        discussionMismatches: {
            ...(storage.discussionMismatches ?? {}),
            [String(mismatch.tabId)]: mismatch
        }
    });
}

/**
 * Clears a tab-scoped discussion mismatch prompt.
 */
async function clearDiscussionMismatch(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get("discussionMismatches")) as State;
    const tabKey = String(tabId);

    if (!storage.discussionMismatches?.[tabKey]) {
        return;
    }

    const discussionMismatches = { ...(storage.discussionMismatches ?? {}) };
    delete discussionMismatches[tabKey];

    await chrome.storage.local.set({ discussionMismatches });
}

/**
 * Collects source data from the clicked tab, builds the ChatGPT prompt, and
 * stores it under a fresh session id for the side panel/content script pair.
 */
async function createDiscussionFromTab(
    tab: chrome.tabs.Tab,
    selectionText: string,
    promptTemplate: PromptTemplate
): Promise<boolean> {
    if (!tab.id) {
        return false;
    }

    try {
        const result = await collectPageSourceFromTab(tab, selectionText);
        if (!result) {
            return false;
        }

        return await createDiscussionFromSource(tab.id, result, promptTemplate);
    } catch (error) {
        console.error("[chatgpt-companion] createDiscussionFromTab failed", error);
        return false;
    }
}

/**
 * Collects linked page metadata from the clicked tab and stores a discussion.
 */
async function createDiscussionFromLink(
    tab: chrome.tabs.Tab,
    linkUrl: string,
    selectionText: string,
    promptTemplate: PromptTemplate
): Promise<boolean> {
    if (!tab.id) {
        return false;
    }

    try {
        const result = await collectLinkSourceFromTab(tab, linkUrl, selectionText);
        if (!result) {
            return false;
        }

        return await createDiscussionFromSource(tab.id, result, promptTemplate);
    } catch (error) {
        console.error("[chatgpt-companion] createDiscussionFromLink failed", error);
        return false;
    }
}

/**
 * Collects current page source metadata from a tab.
 */
async function collectPageSourceFromTab(tab: chrome.tabs.Tab, selectionText: string): Promise<DiscussionSource | null> {
    if (!tab.id) {
        return null;
    }

    // executeScript runs collectPageData in the page, not in this service worker
    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectPageData,
        args: [selectionText]
    });

    return injectionResults[0]?.result ?? null;
}

/**
 * Collects linked page source metadata from a tab.
 */
async function collectLinkSourceFromTab(
    tab: chrome.tabs.Tab,
    linkUrl: string,
    selectionText: string
): Promise<DiscussionSource | null> {
    if (!tab.id) {
        return null;
    }

    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectLinkData,
        args: [linkUrl, selectionText]
    });

    return injectionResults[0]?.result ?? null;
}

/**
 * Builds and stores one discussion source for the side panel/content script pair.
 */
async function createDiscussionFromSource(
    tabId: number,
    source: DiscussionSource,
    promptTemplate: PromptTemplate
): Promise<boolean> {
    const preferredLanguage = await getPreferredLanguage();
    const preferredChatMode = await getPreferredChatMode();
    const prompt = buildPrompt(source, promptTemplate, preferredLanguage);
    const sessionId = crypto.randomUUID();
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const previousSessionId = storage.tabSessionIds?.[String(tabId)];
    const discussions = { ...(storage.discussions ?? {}) };
    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };

    // replace the tab's prior session so stale prompts are not retained
    if (previousSessionId) {
        delete discussions[previousSessionId];
    }

    discussions[sessionId] = {
        prompt,
        stamp: Date.now(),
        source,
        consumed: false,
        temporary: preferredChatMode === "temporary",
        responseLanguage: getRequestedResponseLanguage(promptTemplate, preferredLanguage),
        promptTemplateId: promptTemplate.id,
        promptTemplateName: promptTemplate.name
    };
    tabSessionIds[String(tabId)] = sessionId;

    // clearing closeDiscussionSessionId prevents an older close event from
    // erasing the freshly inserted ChatGPT draft
    await chrome.storage.local.set({
        discussions,
        tabSessionIds,
        closeDiscussionSessionId: undefined
    });

    return true;
}

/**
 * Replaces only the pending prompt while preserving the original chat identity.
 */
async function updateContinuationPrompt(
    tabId: number,
    source: DiscussionSource,
    promptTemplate: PromptTemplate
): Promise<void> {
    const preferredLanguage = await getPreferredLanguage();
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const sessionId = storage.tabSessionIds?.[String(tabId)];

    if (!sessionId || !storage.discussions?.[sessionId]) {
        throw new Error("Existing discussion not found");
    }

    await chrome.storage.local.set({
        discussions: {
            ...storage.discussions,
            [sessionId]: {
                ...storage.discussions[sessionId],
                prompt: buildPrompt(source, promptTemplate, preferredLanguage),
                stamp: Date.now(),
                consumed: false
            }
        },
        closeDiscussionSessionId: undefined
    });
}

/**
 * Removes the tab-to-session mapping. Normal discussions remain available for
 * restore; temporary discussions are discarded.
 */
async function detachDiscussionFromTab(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds",
        "discussionMismatches"
    ])) as State;
    const tabKey = String(tabId);
    const sessionId = storage.tabSessionIds?.[tabKey];

    if (!sessionId) {
        return;
    }

    if (storage.discussions?.[sessionId]?.temporary) {
        await clearTemporaryDiscussionForTab(tabId);
        return;
    }

    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };
    delete tabSessionIds[tabKey];

    await chrome.storage.local.set({ tabSessionIds });
}

/**
 * Removes a tab's temporary discussion because it cannot be restored after the
 * side panel document is gone.
 */
async function clearTemporaryDiscussionForTab(tabId: number): Promise<void> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds",
        "discussionMismatches"
    ])) as State;
    const tabKey = String(tabId);
    const sessionId = storage.tabSessionIds?.[tabKey];
    const discussion = sessionId ? storage.discussions?.[sessionId] : undefined;

    if (!sessionId || !discussion?.temporary) {
        return;
    }

    const discussions = { ...(storage.discussions ?? {}) };
    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };
    const discussionMismatches = { ...(storage.discussionMismatches ?? {}) };

    delete discussions[sessionId];
    delete tabSessionIds[tabKey];
    delete discussionMismatches[tabKey];

    await chrome.storage.local.set({
        discussions,
        tabSessionIds,
        discussionMismatches,
        closeDiscussionSessionId: sessionId
    });
}

/**
 * Removes any temporary records that survived an extension/browser restart.
 */
async function clearPersistedTemporaryDiscussions(): Promise<void> {
    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds",
        "discussionMismatches"
    ])) as State;
    const openTabIds = new Set(await getOpenTabIds());
    const openTemporarySessionIds = new Set(
        Object.entries(storage.tabSessionIds ?? {})
            .filter(([tabId]) => openTabIds.has(Number(tabId)))
            .map(([, sessionId]) => sessionId)
    );
    const temporarySessionIds = new Set(
        Object.entries(storage.discussions ?? {})
            .filter(([sessionId, discussion]) => {
                return discussion.temporary && !openTemporarySessionIds.has(sessionId);
            })
            .map(([sessionId]) => sessionId)
    );

    if (temporarySessionIds.size === 0) {
        return;
    }

    const discussions = { ...(storage.discussions ?? {}) };
    const tabSessionIds = { ...(storage.tabSessionIds ?? {}) };
    const discussionMismatches = { ...(storage.discussionMismatches ?? {}) };

    for (const sessionId of temporarySessionIds) {
        delete discussions[sessionId];
    }

    for (const [tabId, sessionId] of Object.entries(tabSessionIds)) {
        if (!temporarySessionIds.has(sessionId)) {
            continue;
        }

        delete tabSessionIds[tabId];
        delete discussionMismatches[tabId];
    }

    await chrome.storage.local.set({
        discussions,
        tabSessionIds,
        discussionMismatches
    });
}

/**
 * Runs in the page context and returns the minimal source metadata used to
 * create a discussion prompt.
 */
function collectPageData(selectionText: string): DiscussionSource {
    return {
        title: document.title || "",
        url: location.href || "",
        selection: selectionText || ""
    };
}

/**
 * Runs in the page context and returns source metadata for a clicked link.
 */
function collectLinkData(linkUrl: string, selectionText: string): DiscussionSource {
    const link = Array.from(document.links).find((item) => item.href === linkUrl);
    let fallbackTitle = linkUrl;

    try {
        fallbackTitle = new URL(linkUrl).hostname;
    } catch {
        fallbackTitle = linkUrl;
    }

    const linkTitle = link?.getAttribute("title")?.trim() ||
        link?.getAttribute("aria-label")?.trim() ||
        link?.textContent?.trim() ||
        fallbackTitle;

    return {
        title: linkTitle,
        url: linkUrl,
        selection: selectionText || ""
    };
}

/**
 * Builds the prompt inserted into ChatGPT from a user-editable template.
 */
function buildPrompt(
    data: DiscussionSource,
    promptTemplate: PromptTemplate,
    preferredLanguage: string
): string {
    const macros = getPromptMacros(data, preferredLanguage);

    return applyPromptConditionals(promptTemplate.template, macros)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => paragraph(applyPromptMacros(line, macros)))
        .join("\n");
}

/**
 * Removes conditional template blocks when their macro value is absent.
 */
function applyPromptConditionals(template: string, macros: Record<string, string>): string {
    return template.replace(/\{if\s+([a-z0-9_]+)}\n?([\s\S]*?)\n?\{\/if}/g, (_match, name: string, content: string) => {
        return macros[name]?.trim() ? content : "";
    });
}

/**
 * Builds supported prompt template macro values from source and settings.
 */
function getPromptMacros(
    data: DiscussionSource,
    preferredLanguage: string
): Record<string, string> {
    const now = new Date();
    return {
        page_title: data.title || "(no title)",
        page_url: data.url || "(no url)",
        selected_text: data.selection.trim().slice(0, 4000),
        current_date: now.toLocaleDateString(),
        current_time: now.toLocaleTimeString(),
        preferred_language: preferredLanguage
    };
}

/**
 * Replaces supported prompt template macros with prepared values.
 */
function applyPromptMacros(
    text: string,
    macros: Record<string, string>
): string {
    return text
        .replace(/\{([a-z0-9_]+)}/g, (match, name: string) => {
            return macros[name] ?? match;
        });
}

/**
 * Returns the currently configured preferred response language.
 */
async function getPreferredLanguage(): Promise<string> {
    const storage = (await chrome.storage.local.get("preferredLanguage")) as State;
    return normalizePreferredLanguage(storage.preferredLanguage);
}

/**
 * Returns the currently configured ChatGPT entry mode.
 */
async function getPreferredChatMode(): Promise<string> {
    const storage = (await chrome.storage.local.get("preferredChatMode")) as State;
    return normalizePreferredChatMode(storage.preferredChatMode);
}

/**
 * Returns stored prompt templates or the hardcoded default fallback.
 */
async function getPromptTemplates(): Promise<PromptTemplate[]> {
    const storage = (await chrome.storage.local.get([
        "hiddenDefaultPromptTemplateIds",
        "promptTemplates"
    ])) as State;
    return filterHiddenDefaultPromptTemplates(
        normalizePromptTemplates(storage.promptTemplates),
        storage.hiddenDefaultPromptTemplateIds
    );
}

/**
 * Returns one prompt template by id or the current default template.
 */
async function getPromptTemplateById(promptTemplateId: string): Promise<PromptTemplate> {
    const storage = (await chrome.storage.local.get("promptTemplates")) as State;
    const promptTemplates = normalizePromptTemplates(storage.promptTemplates);
    return promptTemplates.find((promptTemplate) => promptTemplate.id === promptTemplateId) ?? promptTemplates[0];
}

/**
 * Converts stored prompt template values into usable context menu entries.
 */
function normalizePromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) {
        return getDefaultPromptTemplates();
    }

    const defaultPromptTemplates = getDefaultPromptTemplates();
    const defaultPromptTemplateIds = new Set(defaultPromptTemplates.map((template) => template.id));
    const storedPromptTemplates = value
        .filter((template): template is PromptTemplate => {
            return typeof template?.id === "string" &&
                typeof template?.name === "string" &&
                typeof template?.template === "string" &&
                template.name.trim().length > 0 &&
                template.template.trim().length > 0;
        })
        .map((template) => ({
            id: template.id.trim() || crypto.randomUUID(),
            name: template.name.trim(),
            template: template.template.trim()
        }));
    const storedPromptTemplatesById = new Map(
        storedPromptTemplates.map((template) => [template.id, template])
    );
    const promptTemplates = defaultPromptTemplates.map((defaultPromptTemplate) => {
        return storedPromptTemplatesById.get(defaultPromptTemplate.id) ?? defaultPromptTemplate;
    });

    for (const storedPromptTemplate of storedPromptTemplates) {
        if (!defaultPromptTemplateIds.has(storedPromptTemplate.id)) {
            promptTemplates.push(storedPromptTemplate);
        }
    }

    return promptTemplates.length > 0 ? promptTemplates : getDefaultPromptTemplates();
}

function filterHiddenDefaultPromptTemplates(
    promptTemplates: PromptTemplate[],
    hiddenDefaultPromptTemplateIds: unknown
): PromptTemplate[] {
    const defaultPromptTemplateIds = new Set(getDefaultPromptTemplates().map((template) => template.id));
    const hiddenTemplateIds = new Set(normalizeHiddenDefaultPromptTemplateIds(hiddenDefaultPromptTemplateIds));

    return promptTemplates.filter((promptTemplate) => {
        return !defaultPromptTemplateIds.has(promptTemplate.id) || !hiddenTemplateIds.has(promptTemplate.id);
    });
}

/**
 * Returns the response language implied by the selected prompt template.
 */
function getRequestedResponseLanguage(promptTemplate: PromptTemplate, preferredLanguage: string): string {
    return promptTemplate.template.includes("{preferred_language}")
        ? preferredLanguage
        : ORIGINAL_LANGUAGE_LABEL;
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
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error !== null) {
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    return String(error);
}

/**
 * Sends a normalized runtime error response and keeps logs consistent.
 */
function sendErrorResponse(
    label: string,
    error: unknown,
    sendResponse: (response: RuntimeResponse) => void
): void {
    console.error(`[chatgpt-companion] ${label}`, error);
    sendResponse({
        ok: false,
        error: getErrorMessage(error)
    });
}
