/**
 * Context menu identifiers used to distinguish this extension's menu actions
 * from any other Chrome context menu events.
 */
const MENU_PARENT_ID = "discuss-in-chatgpt";
const MENU_TEMPLATE_PREFIX = "discuss-in-chatgpt-template-";
const DEFAULT_PREFERRED_LANGUAGE = "English";
const ORIGINAL_LANGUAGE_LABEL = "Original language";
const DEFAULT_PROMPT_TEMPLATE_NAME = "Default";
const DEFAULT_PROMPT_TEMPLATE_ID = "default";
const DEFAULT_PROMPT_TEMPLATE = [
    "Hi, I’d like to discuss the following content.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Selected excerpt:",
    "{selected_text}",
    "{/if}",
    "",
    "Please:",
    "- Provide a concise summary",
    "- Identify the main idea",
    "- Highlight what is actually important",
    "- Point out weak or questionable parts",
    "Use the language of the original material for your response."
].join("\n");
const DEFAULT_TRANSLATED_PROMPT_TEMPLATE_ID = "default-translated";
const DEFAULT_TRANSLATED_PROMPT_TEMPLATE_NAME = "Default translated";
const DEFAULT_TRANSLATED_PROMPT_TEMPLATE = [
    "Hi, I’d like to discuss the following content.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Selected excerpt:",
    "{selected_text}",
    "{/if}",
    "",
    "Please:",
    "- Provide a concise summary",
    "- Identify the main idea",
    "- Highlight what is actually important",
    "- Point out weak or questionable parts",
    "Use {preferred_language} for your response."
].join("\n");
const SHORT_SUMMARY_PROMPT_TEMPLATE_ID = "short-summary";
const SHORT_SUMMARY_PROMPT_TEMPLATE_NAME = "Short summary";
const SHORT_SUMMARY_PROMPT_TEMPLATE = [
    "Compact the following material into a short summary.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Material:",
    "{selected_text}",
    "{/if}",
    "",
    "Do not analyze or critique it.",
    "Use the language of the original material for your response."
].join("\n");
const SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_ID = "short-summary-translated";
const SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_NAME = "Short summary translated";
const SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE = [
    "Compact the following material into a short summary.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Material:",
    "{selected_text}",
    "{/if}",
    "",
    "Do not analyze or critique it.",
    "Use {preferred_language} for your response."
].join("\n");
const PROMPT_TEMPLATE_IDS_BEFORE_TRANSLATED_SUMMARY = new Set([
    DEFAULT_PROMPT_TEMPLATE_ID,
    DEFAULT_TRANSLATED_PROMPT_TEMPLATE_ID,
    SHORT_SUMMARY_PROMPT_TEMPLATE_ID
]);

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
 * Keeps prompt-template context menu items aligned with settings.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes["preferredLanguage"] || changes["promptTemplates"])) {
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
        contexts: ["page", "selection"]
    });

    promptTemplates.forEach((promptTemplate, promptTemplateIndex) => {
        chrome.contextMenus.create({
            id: `${MENU_TEMPLATE_PREFIX}${promptTemplateIndex}`,
            parentId: MENU_PARENT_ID,
            title: `Using "${promptTemplate.name}" template`,
            contexts: ["page", "selection"]
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

    const promptTemplate = await getMenuPromptTemplate(menuItemId);
    const preferredLanguage = await getPreferredLanguage();
    const existingDiscussion = await getDiscussionForTab(tab.id);

    if (existingDiscussion) {
        await handleExistingDiscussionLanguage(
            tab.id,
            info.selectionText ?? "",
            existingDiscussion,
            promptTemplate,
            getRequestedResponseLanguage(promptTemplate, preferredLanguage)
        );
        return;
    }

    await clearPendingLanguageMismatch(tab.id);
    await createDiscussionFromTab(tab, info.selectionText ?? "", promptTemplate);
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
 * Stores or clears the restart decision needed for an existing session.
 */
async function handleExistingDiscussionLanguage(
    tabId: number,
    selectionText: string,
    discussion: DiscussionState,
    promptTemplate: PromptTemplate,
    requestedLanguage: string
): Promise<void> {
    const currentLanguage = discussion.responseLanguage ?? ORIGINAL_LANGUAGE_LABEL;
    const currentPromptTemplateName = discussion.promptTemplateName ?? DEFAULT_PROMPT_TEMPLATE_NAME;

    if (requestedLanguage === currentLanguage && promptTemplate.name === currentPromptTemplateName) {
        await clearPendingLanguageMismatch(tabId);
        return;
    }

    await setPendingLanguageMismatch({
        tabId,
        currentLanguage,
        currentPromptTemplateName,
        requestedLanguage,
        requestedPromptTemplateId: promptTemplate.id,
        requestedPromptTemplateName: promptTemplate.name,
        selectionText,
        stamp: Date.now()
    });
}

/**
 * Restarts a tab discussion from the side panel settings mismatch prompt.
 */
async function restartDiscussion(message: Partial<RuntimeMessage>): Promise<void> {
    if (message.type !== "restart-discussion" || typeof message.tabId !== "number") {
        throw new Error("Restart request is missing tab id");
    }

    if (typeof message.requestedPromptTemplateId !== "string") {
        throw new Error("Restart request is missing prompt template");
    }

    const tab = await chrome.tabs.get(message.tabId);
    const promptTemplate = await getPromptTemplateById(message.requestedPromptTemplateId);
    const restarted = await createDiscussionFromTab(
        tab,
        message.selectionText ?? "",
        promptTemplate
    );
    if (!restarted) {
        throw new Error("Restart operation failed");
    }

    await clearPendingLanguageMismatch(message.tabId);
}

/**
 * Stores a tab-scoped settings mismatch prompt for the side panel.
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
 * Clears a tab-scoped settings mismatch prompt.
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
    promptTemplate: PromptTemplate
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

        const preferredLanguage = await getPreferredLanguage();
        const prompt = buildPrompt(result, promptTemplate, preferredLanguage);
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
            responseLanguage: getRequestedResponseLanguage(promptTemplate, preferredLanguage),
            promptTemplateName: promptTemplate.name
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
 * Builds the prompt inserted into ChatGPT from a user-editable template.
 */
function buildPrompt(
    data: DiscussSource,
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
    data: DiscussSource,
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
    const storage = (await chrome.storage.local.get("preferredLanguage")) as StorageShape;
    return normalizePreferredLanguage(storage.preferredLanguage);
}

/**
 * Returns stored prompt templates or the hardcoded default fallback.
 */
async function getPromptTemplates(): Promise<PromptTemplate[]> {
    const storage = (await chrome.storage.local.get("promptTemplates")) as StorageShape;
    return normalizePromptTemplates(storage.promptTemplates);
}

/**
 * Returns one prompt template by id or the current default template.
 */
async function getPromptTemplateById(promptTemplateId: string): Promise<PromptTemplate> {
    const promptTemplates = await getPromptTemplates();
    return promptTemplates.find((promptTemplate) => promptTemplate.id === promptTemplateId) ?? promptTemplates[0];
}

/**
 * Converts stored or user-entered language values into one usable language.
 */
function normalizePreferredLanguage(value: unknown): string {
    if (typeof value !== "string") {
        return DEFAULT_PREFERRED_LANGUAGE;
    }

    return value.trim() || DEFAULT_PREFERRED_LANGUAGE;
}

/**
 * Converts stored prompt template values into usable context menu entries.
 */
function normalizePromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) {
        return getDefaultPromptTemplates();
    }

    const promptTemplates = value
        .filter((template): template is PromptTemplate => {
            return typeof template?.id === "string" &&
                typeof template?.name === "string" &&
                typeof template?.template === "string";
        })
        .map((template) => ({
            id: template.id.trim() || crypto.randomUUID(),
            name: template.name.trim() || DEFAULT_PROMPT_TEMPLATE_NAME,
            template: sanitizePromptTemplate(template.template) || DEFAULT_PROMPT_TEMPLATE
        }));

    return promptTemplates.length > 0 ? appendMissingTranslatedSummaryTemplate(promptTemplates) : getDefaultPromptTemplates();
}

/**
 * Returns hardcoded prompt templates used before settings exist.
 */
function getDefaultPromptTemplates(): PromptTemplate[] {
    return [
        {
            id: DEFAULT_PROMPT_TEMPLATE_ID,
            name: DEFAULT_PROMPT_TEMPLATE_NAME,
            template: DEFAULT_PROMPT_TEMPLATE
        },
        {
            id: DEFAULT_TRANSLATED_PROMPT_TEMPLATE_ID,
            name: DEFAULT_TRANSLATED_PROMPT_TEMPLATE_NAME,
            template: DEFAULT_TRANSLATED_PROMPT_TEMPLATE
        },
        {
            id: SHORT_SUMMARY_PROMPT_TEMPLATE_ID,
            name: SHORT_SUMMARY_PROMPT_TEMPLATE_NAME,
            template: SHORT_SUMMARY_PROMPT_TEMPLATE
        },
        {
            id: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_ID,
            name: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_NAME,
            template: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE
        }
    ];
}

/**
 * Adds the new translated summary template to older built-in template lists.
 */
function appendMissingTranslatedSummaryTemplate(promptTemplates: PromptTemplate[]): PromptTemplate[] {
    const hasOlderBuiltInTemplate = promptTemplates.some((promptTemplate) => {
        return PROMPT_TEMPLATE_IDS_BEFORE_TRANSLATED_SUMMARY.has(promptTemplate.id);
    });
    const hasTranslatedSummaryTemplate = promptTemplates.some((promptTemplate) => {
        return promptTemplate.id === SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_ID;
    });

    if (!hasOlderBuiltInTemplate || hasTranslatedSummaryTemplate) {
        return promptTemplates;
    }

    return [
        ...promptTemplates,
        {
            id: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_ID,
            name: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE_NAME,
            template: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE
        }
    ];
}

/**
 * Removes legacy unsupported macros from stored prompt template text.
 */
function sanitizePromptTemplate(template: string): string {
    return addSelectionConditionalsToLegacyTemplate(template)
        .replace(/\{response_language_instruction}/g, "")
        .replace(/\{response_language}/g, "")
        .trim();
}

/**
 * Wraps older built-in selection blocks so page-only prompts stay clean.
 */
function addSelectionConditionalsToLegacyTemplate(template: string): string {
    if (template.includes("{if selected_text}")) {
        return template;
    }

    return template
        .replace(
            "Selected excerpt:\n{selected_text}",
            "{if selected_text}\nSelected excerpt:\n{selected_text}\n{/if}"
        )
        .replace(
            "Material:\n{selected_text}",
            "{if selected_text}\nMaterial:\n{selected_text}\n{/if}"
        );
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
