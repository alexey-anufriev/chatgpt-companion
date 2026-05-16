import {
    DEFAULT_PROMPT_TEMPLATE,
    getDefaultPromptTemplates
} from "./prompts.js";
import {
    DEFAULT_PREFERRED_CHAT_MODE,
    DEFAULT_PREFERRED_LANGUAGE,
    DEFAULT_PREFERRED_SENDING_MODE,
    SYNC_SETTING_KEYS
} from "./settings.js";
import type {
    PreferredChatMode,
    PreferredSendingMode,
    PromptTemplate,
    State
} from "./settings.js";
import type {
    RuntimeMessage,
    RuntimeResponse
} from "./events.js";
import type {
    DiscussionState
} from "./context.js";

const OPTIONS_NEW_PROMPT_TEMPLATE = [
    "Hi, I’d like to discuss the following content.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "And in particular selected excerpt:",
    "{selected_text}",
    "{/if}",
    "",
    "Use {preferred_language} for your response."
].join("\n");

const preferredLanguageInput = document.getElementById("preferredLanguage") as HTMLInputElement | null;
const preferredSendingModeSelect = document.getElementById("preferredSendingMode") as HTMLSelectElement | null;
const preferredChatModeSelect = document.getElementById("preferredChatMode") as HTMLSelectElement | null;
const shortcutSettingsBtn = document.getElementById("shortcutSettingsBtn") as HTMLButtonElement | null;
const cloudSyncBtn = document.getElementById("cloudSyncBtn") as HTMLButtonElement | null;
const saveSettingsBtn = document.getElementById("saveSettingsBtn") as HTMLButtonElement | null;
const addPromptTemplateBtn = document.getElementById("addPromptTemplateBtn") as HTMLButtonElement | null;
const promptTemplatesListEl = document.getElementById("promptTemplatesList") as HTMLDivElement | null;
const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

type SessionEntry = [string, DiscussionState];

let savedPreferredLanguage = DEFAULT_PREFERRED_LANGUAGE;
let savedPreferredSendingMode: PreferredSendingMode = DEFAULT_PREFERRED_SENDING_MODE;
let savedPreferredChatMode: PreferredChatMode = DEFAULT_PREFERRED_CHAT_MODE;
let savedPromptTemplates: PromptTemplate[] = getDefaultPromptTemplates();
let savedCloudSyncEnabled = false;
let isLoadingSettings = false;
let isChangingCloudSync = false;
let isSavingSettings = false;
let statusClearTimer: number | undefined;

if (
    !preferredLanguageInput ||
    !preferredSendingModeSelect ||
    !preferredChatModeSelect ||
    !shortcutSettingsBtn ||
    !cloudSyncBtn ||
    !saveSettingsBtn ||
    !addPromptTemplateBtn ||
    !promptTemplatesListEl ||
    !clearDataBtn ||
    !statusEl ||
    !sessionsListEl ||
    !sessionCountEl
) {
    console.error("[chatgpt-companion] options DOM elements not found");
} else {
    preferredLanguageInput.addEventListener("input", () => {
        updateSaveButtonState();
    });
    preferredSendingModeSelect.addEventListener("change", () => {
        updateSaveButtonState();
    });
    preferredChatModeSelect.addEventListener("change", () => {
        updateSaveButtonState();
    });

    saveSettingsBtn.addEventListener("click", () => {
        void saveSettings();
    });

    shortcutSettingsBtn.addEventListener("click", () => {
        void openShortcutSettings();
    });

    cloudSyncBtn.addEventListener("click", () => {
        void handleCloudSyncButtonClick();
    });

    addPromptTemplateBtn.addEventListener("click", () => {
        addPromptTemplateEditor({
            id: crypto.randomUUID(),
            name: "New Prompt",
            template: OPTIONS_NEW_PROMPT_TEMPLATE
        }, true);
        updateSaveButtonState();
    });

    clearDataBtn.addEventListener("click", () => {
        void requestClearDataAndCache();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes["discussions"] || changes["tabSessionIds"])) {
            void renderPersistedSessions();
        }

        if (
            !isLoadingSettings &&
            areaName === "local" &&
            (
                changes["preferredLanguage"] ||
                changes["preferredSendingMode"] ||
                changes["preferredChatMode"] ||
                changes["promptTemplates"] ||
                changes["cloudSyncEnabled"]
            )
        ) {
            void loadSettings();
        }
    });

    void loadSettings();
    void renderPersistedSessions();
}

async function openShortcutSettings(): Promise<void> {
    try {
        await chrome.tabs.create({
            url: "chrome://extensions/shortcuts"
        });
    } catch (error) {
        console.error("[chatgpt-companion] shortcut settings open failed", error);
        setStatus("Open chrome://extensions/shortcuts to change the hotkey.");
    }
}

async function loadSettings(): Promise<void> {
    if (isLoadingSettings) {
        return;
    }

    isLoadingSettings = true;

    try {
        const syncState = (await chrome.storage.local.get("cloudSyncEnabled")) as State;

        if (syncState.cloudSyncEnabled) {
            await pullOptionsCloudSettingsToLocal().catch((error) => {
                console.error("[chatgpt-companion] cloud settings pull failed", error);
            });
        }

        const storage = (await chrome.storage.local.get(SYNC_SETTING_KEYS)) as State;

        savedCloudSyncEnabled = storage.cloudSyncEnabled === true;
        renderCloudSyncButton();
        renderPreferredLanguage(storage.preferredLanguage);
        renderPreferredSendingMode(storage.preferredSendingMode);
        renderPreferredChatMode(storage.preferredChatMode);
        renderPromptTemplates(storage.promptTemplates);
    } finally {
        isLoadingSettings = false;
    }
}

function renderPreferredLanguage(preferredLanguage: unknown): void {
    if (!preferredLanguageInput) {
        return;
    }

    savedPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguage);
    preferredLanguageInput.value = savedPreferredLanguage;
    updateSaveButtonState();
}

function renderPreferredSendingMode(preferredSendingMode: unknown): void {
    if (!preferredSendingModeSelect) {
        return;
    }

    savedPreferredSendingMode = normalizeOptionsPreferredSendingMode(preferredSendingMode);
    preferredSendingModeSelect.value = savedPreferredSendingMode;
    updateSaveButtonState();
}

function renderPreferredChatMode(preferredChatMode: unknown): void {
    if (!preferredChatModeSelect) {
        return;
    }

    savedPreferredChatMode = normalizeOptionsPreferredChatMode(preferredChatMode);
    preferredChatModeSelect.value = savedPreferredChatMode;
    updateSaveButtonState();
}

function renderPromptTemplates(promptTemplates: unknown): void {
    if (!promptTemplatesListEl) {
        return;
    }

    savedPromptTemplates = normalizeOptionsPromptTemplates(promptTemplates);
    promptTemplatesListEl.replaceChildren();

    for (const promptTemplate of savedPromptTemplates) {
        addPromptTemplateEditor(promptTemplate);
    }

    updateSaveButtonState();
}

async function saveSettings(): Promise<void> {
    if (
        !preferredLanguageInput ||
        !preferredSendingModeSelect ||
        !preferredChatModeSelect ||
        !saveSettingsBtn ||
        !statusEl
    ) {
        return;
    }

    const nextPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const nextPreferredSendingMode = normalizeOptionsPreferredSendingMode(preferredSendingModeSelect.value);
    const nextPreferredChatMode = normalizeOptionsPreferredChatMode(preferredChatModeSelect.value);
    const nextPromptTemplates = readPromptTemplateEditors();

    isSavingSettings = true;
    updateSaveButtonState();
    setStatus("Saving settings...", false);

    try {
        await chrome.storage.local.set({
            preferredLanguage: nextPreferredLanguage,
            preferredSendingMode: nextPreferredSendingMode,
            preferredChatMode: nextPreferredChatMode,
            promptTemplates: nextPromptTemplates
        });

        savedPreferredLanguage = nextPreferredLanguage;
        savedPreferredSendingMode = nextPreferredSendingMode;
        savedPreferredChatMode = nextPreferredChatMode;
        savedPromptTemplates = nextPromptTemplates;
        preferredLanguageInput.value = nextPreferredLanguage;
        preferredSendingModeSelect.value = nextPreferredSendingMode;
        preferredChatModeSelect.value = nextPreferredChatMode;
        renderPromptTemplates(nextPromptTemplates);

        if (savedCloudSyncEnabled) {
            try {
                await pushOptionsCloudSettings(
                    nextPreferredLanguage,
                    nextPreferredSendingMode,
                    nextPreferredChatMode,
                    nextPromptTemplates
                );
                setStatus("Settings saved and queued for cloud sync.");
            } catch (error) {
                console.error("[chatgpt-companion] cloud settings save failed", error);
                setStatus("Settings saved locally. Cloud sync failed.");
            }
        } else {
            setStatus("Settings saved.");
        }
    } catch (error) {
        console.error("[chatgpt-companion] save settings failed", error);
        setStatus(error instanceof Error ? error.message : "Save operation failed.");
    } finally {
        isSavingSettings = false;
        updateSaveButtonState();
    }
}

async function handleCloudSyncButtonClick(): Promise<void> {
    if (savedCloudSyncEnabled) {
        await disableCloudSync();
        return;
    }

    await enableCloudSync();
}

async function enableCloudSync(): Promise<void> {
    if (!cloudSyncBtn || !statusEl) {
        return;
    }

    isChangingCloudSync = true;
    renderCloudSyncButton();
    setStatus("Enabling cloud sync...", false);

    try {
        const profileUserInfo = await chrome.identity.getProfileUserInfo();
        const cloudSettings = await readOptionsCloudSettings();
        const isProfileSignedIn = profileUserInfo.email.trim().length > 0;

        await chrome.storage.local.set({
            cloudSyncEnabled: true
        });

        const warning = isProfileSignedIn ? "" : " Chrome profile is not signed in, so settings may stay local.";

        if (hasOptionsCloudSettings(cloudSettings)) {
            await applyOptionsCloudSettingsToLocal(cloudSettings);
            setStatus(`Cloud sync enabled. Remote settings loaded.${warning}`);
        } else {
            setStatus(`Cloud sync enabled. Save settings to upload them.${warning}`);
        }

        savedCloudSyncEnabled = true;
        renderCloudSyncButton();
        await loadSettings();
    } catch (error) {
        console.error("[chatgpt-companion] enable cloud sync failed", error);
        setStatus(error instanceof Error ? error.message : "Cloud sync enable failed.");
    } finally {
        isChangingCloudSync = false;
        renderCloudSyncButton();
    }
}

async function disableCloudSync(): Promise<void> {
    if (!cloudSyncBtn || !statusEl) {
        return;
    }

    isChangingCloudSync = true;
    renderCloudSyncButton();
    setStatus("Disabling cloud sync...", false);

    try {
        await chrome.storage.local.set({
            cloudSyncEnabled: false
        });
        savedCloudSyncEnabled = false;
        setStatus("Cloud sync disabled. Local settings kept.");
    } catch (error) {
        console.error("[chatgpt-companion] disable cloud sync failed", error);
        setStatus(error instanceof Error ? error.message : "Cloud sync disable failed.");
    } finally {
        isChangingCloudSync = false;
        renderCloudSyncButton();
    }
}

function renderCloudSyncButton(): void {
    if (!cloudSyncBtn) {
        return;
    }

    cloudSyncBtn.disabled = isChangingCloudSync;
    cloudSyncBtn.textContent = savedCloudSyncEnabled ? "Disable Cloud Sync" : "Enable Cloud Sync";
    cloudSyncBtn.classList.toggle("dangerButton", savedCloudSyncEnabled);
    cloudSyncBtn.classList.toggle("primaryButton", !savedCloudSyncEnabled);
}

function setStatus(message: string, autoClear = true): void {
    if (!statusEl) {
        return;
    }

    if (statusClearTimer !== undefined) {
        window.clearTimeout(statusClearTimer);
        statusClearTimer = undefined;
    }

    statusEl.textContent = message;

    if (!autoClear || !message) {
        return;
    }

    statusClearTimer = window.setTimeout(() => {
        if (statusEl.textContent === message) {
            statusEl.textContent = "";
        }
        statusClearTimer = undefined;
    }, 5000);
}

async function pullOptionsCloudSettingsToLocal(): Promise<void> {
    const cloudSettings = await readOptionsCloudSettings();

    if (!cloudSettings.cloudSyncEnabled && !hasOptionsCloudSettings(cloudSettings)) {
        return;
    }

    await applyOptionsCloudSettingsToLocal(cloudSettings);
}

async function applyOptionsCloudSettingsToLocal(cloudSettings: State): Promise<void> {
    await chrome.storage.local.set({
        preferredLanguage: normalizeOptionsPreferredLanguage(cloudSettings.preferredLanguage),
        preferredSendingMode: normalizeOptionsPreferredSendingMode(cloudSettings.preferredSendingMode),
        preferredChatMode: normalizeOptionsPreferredChatMode(cloudSettings.preferredChatMode),
        promptTemplates: normalizeOptionsPromptTemplates(cloudSettings.promptTemplates)
    });
}

function hasOptionsCloudSettings(cloudSettings: State): boolean {
    return typeof cloudSettings.preferredLanguage === "string" ||
        typeof cloudSettings.preferredSendingMode === "string" ||
        typeof cloudSettings.preferredChatMode === "string" ||
        Array.isArray(cloudSettings.promptTemplates);
}

async function pushOptionsCloudSettings(
    preferredLanguage: string,
    preferredSendingMode: PreferredSendingMode,
    preferredChatMode: PreferredChatMode,
    promptTemplates: PromptTemplate[]
): Promise<void> {
    await chrome.storage.sync.set({
        cloudSyncEnabled: true,
        preferredLanguage,
        preferredSendingMode,
        preferredChatMode,
        promptTemplates
    });
}

async function readOptionsCloudSettings(): Promise<State> {
    return (await chrome.storage.sync.get(SYNC_SETTING_KEYS)) as State;
}

function addPromptTemplateEditor(promptTemplate: PromptTemplate, expanded = false): void {
    if (!promptTemplatesListEl) {
        return;
    }

    const row = document.createElement("article");
    row.className = "promptTemplate";
    row.classList.toggle("expanded", expanded);
    row.dataset.templateId = promptTemplate.id;

    const header = document.createElement("div");
    header.className = "promptTemplateHeader";

    const title = document.createElement("span");
    title.className = "promptTemplateTitle";
    title.textContent = promptTemplate.name || "Prompt";

    const actions = document.createElement("div");
    actions.className = "promptTemplateActions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = expanded ? "Collapse" : "Edit";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";

    const body = document.createElement("div");
    body.className = "promptTemplateBody";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = promptTemplate.name;
    nameInput.placeholder = "Prompt name";
    nameInput.className = "promptTemplateName";

    const templateInput = document.createElement("textarea");
    templateInput.value = promptTemplate.template;
    templateInput.className = "promptTemplateText";
    templateInput.spellcheck = false;

    nameInput.addEventListener("input", () => {
        title.textContent = nameInput.value.trim() || "Prompt";
        updateSaveButtonState();
    });
    templateInput.addEventListener("input", () => {
        updateSaveButtonState();
    });
    editButton.addEventListener("click", () => {
        const isExpanded = row.classList.toggle("expanded");
        editButton.textContent = isExpanded ? "Collapse" : "Edit";
    });
    removeButton.addEventListener("click", () => {
        row.remove();
        updateSaveButtonState();
    });

    actions.append(editButton, removeButton);
    header.append(title, actions);
    body.append(nameInput, templateInput);
    row.append(header, body);
    promptTemplatesListEl.append(row);
}

function readPromptTemplateEditors(): PromptTemplate[] {
    if (!promptTemplatesListEl) {
        return getDefaultPromptTemplates();
    }

    const promptTemplates = Array.from(promptTemplatesListEl.querySelectorAll<HTMLElement>(".promptTemplate"))
        .map((row) => {
            const name = row.querySelector<HTMLInputElement>(".promptTemplateName")?.value.trim() || "Prompt";
            const template = (row.querySelector<HTMLTextAreaElement>(".promptTemplateText")?.value ?? "").trim() ||
                DEFAULT_PROMPT_TEMPLATE;

            return {
                id: row.dataset.templateId || crypto.randomUUID(),
                name,
                template
            };
        });

    return promptTemplates.length > 0 ? promptTemplates : getDefaultPromptTemplates();
}

async function requestClearDataAndCache(): Promise<void> {
    if (!clearDataBtn || !statusEl) {
        return;
    }

    clearDataBtn.disabled = true;
    setStatus("Clearing data...", false);

    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "clear-data-and-cache"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Clear operation failed");
        }

        setStatus("Data and cache cleared.");
        await loadSettings();
        await renderPersistedSessions();
    } catch (error) {
        console.error("[chatgpt-companion] clear data request failed", error);
        setStatus(error instanceof Error ? error.message : "Clear operation failed.");
    } finally {
        clearDataBtn.disabled = false;
    }
}

async function renderPersistedSessions(): Promise<void> {
    if (!sessionsListEl || !sessionCountEl) {
        return;
    }

    await requestSyncSessionTabs();

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const discussions = Object.entries(storage.discussions ?? {}).sort(([, left], [, right]) => {
        return right.stamp - left.stamp;
    }) as SessionEntry[];
    const tabSessionIds = storage.tabSessionIds ?? {};
    const openSessionEntries = discussions.filter(([sessionId]) => getMappedTabIds(sessionId, tabSessionIds).length > 0);
    const historySessionEntries = discussions.filter(([sessionId]) => getMappedTabIds(sessionId, tabSessionIds).length === 0);

    sessionCountEl.textContent = String(discussions.length);
    sessionsListEl.replaceChildren();

    if (discussions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No persisted sessions.";
        sessionsListEl.append(empty);
        return;
    }

    appendSessionGroup("Open Sessions", openSessionEntries, tabSessionIds, "No sessions are attached to open tabs.");
    appendSessionGroup("History", historySessionEntries, tabSessionIds, "No detached sessions.");
}

function appendSessionGroup(
    title: string,
    sessions: SessionEntry[],
    tabSessionIds: Record<string, string>,
    emptyMessage: string
): void {
    if (!sessionsListEl) {
        return;
    }

    const header = document.createElement("div");
    header.className = "sessionGroupHeader";
    header.textContent = `${title} (${sessions.length})`;
    sessionsListEl.append(header);

    if (sessions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = emptyMessage;
        sessionsListEl.append(empty);
        return;
    }

    for (const [sessionId, discussion] of sessions) {
        sessionsListEl.append(createSessionRow(sessionId, discussion, tabSessionIds));
    }
}

function createSessionRow(
    sessionId: string,
    discussion: DiscussionState,
    tabSessionIds: Record<string, string>
): HTMLElement {
    const row = document.createElement("article");
    row.className = "session";

    const title = document.createElement("h3");
    title.textContent = discussion.source.title || "Page title is missing";

    const sourceUrlRow = document.createElement("div");
    sourceUrlRow.className = "sessionUrl";

    const sourceUrlLabel = document.createElement("span");
    sourceUrlLabel.className = "sessionLabel";
    sourceUrlLabel.textContent = "Original URL:";

    const sourceUrl = document.createElement("a");
    sourceUrl.href = discussion.source.url || "#";
    sourceUrl.textContent = discussion.source.url || "URL is missing";
    sourceUrl.target = "_blank";
    sourceUrl.rel = "noreferrer";

    sourceUrlRow.append(sourceUrlLabel, sourceUrl);

    const chatUrlRow = document.createElement("div");
    chatUrlRow.className = "sessionUrl";

    const chatUrlLabel = document.createElement("span");
    chatUrlLabel.className = "sessionLabel";
    chatUrlLabel.textContent = "ChatGPT URL:";

    const chatUrl = document.createElement("a");
    chatUrl.href = discussion.chatUrl || "#";
    chatUrl.textContent = discussion.chatUrl || "Chat URL not saved yet";
    chatUrl.target = "_blank";
    chatUrl.rel = "noreferrer";
    if (!discussion.chatUrl) {
        chatUrl.removeAttribute("href");
    }

    chatUrlRow.append(chatUrlLabel, chatUrl);

    const mappedTabIds = getMappedTabIds(sessionId, tabSessionIds);
    const sessionHeader = document.createElement("div");
    sessionHeader.className = "sessionHeader";
    sessionHeader.append(title);

    if (mappedTabIds.length > 0) {
        const jumpButton = document.createElement("button");
        jumpButton.type = "button";
        jumpButton.className = "sessionJumpButton";
        jumpButton.textContent = "Jump to tab";
        jumpButton.addEventListener("click", () => {
            void requestFocusSessionTab(sessionId, Number(mappedTabIds[0]), jumpButton);
        });
        sessionHeader.append(jumpButton);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "sessionDeleteButton";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
        void requestDeleteSession(sessionId, deleteButton);
    });
    sessionHeader.append(deleteButton);

    const meta = document.createElement("div");
    meta.className = "sessionMeta";
    meta.textContent = [
        `session: ${sessionId}`,
        `language: ${discussion.responseLanguage}`,
        `prompt: ${discussion.promptTemplateName}`,
        `updated: ${new Date(discussion.stamp).toLocaleString()}`,
        `consumed: ${discussion.consumed ? "yes" : "no"}`,
        `tab: ${mappedTabIds.join(", ") || "not open"}`
    ].join(" | ");

    row.append(sessionHeader, sourceUrlRow, chatUrlRow, meta);
    return row;
}

async function requestDeleteSession(sessionId: string, button: HTMLButtonElement): Promise<void> {
    if (!confirm("Delete this persisted session?")) {
        return;
    }

    button.disabled = true;
    setStatus("Deleting session...", false);

    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "delete-session",
            sessionId
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Delete session failed");
        }

        setStatus("Session deleted.");
        await renderPersistedSessions();
    } catch (error) {
        console.error("[chatgpt-companion] delete session failed", error);
        setStatus(error instanceof Error ? error.message : "Delete session failed.");
    } finally {
        button.disabled = false;
    }
}

async function requestSyncSessionTabs(): Promise<void> {
    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "sync-session-tabs"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Session tab sync failed");
        }
    } catch (error) {
        console.error("[chatgpt-companion] session tab sync failed", error);
    }
}

async function requestFocusSessionTab(sessionId: string, tabId: number, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    openSidePanelForTab(tabId);

    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "focus-session-tab",
            sessionId
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Tab focus failed");
        }
    } catch (error) {
        console.error("[chatgpt-companion] focus session tab failed", error);
        setStatus(error instanceof Error ? error.message : "Tab is no longer open.");
        await renderPersistedSessions();
    } finally {
        button.disabled = false;
    }
}

function openSidePanelForTab(tabId: number): void {
    if (!Number.isInteger(tabId)) {
        return;
    }

    void chrome.sidePanel.setOptions({
        tabId,
        path: `sidepanel.html?tabId=${tabId}`,
        enabled: true
    }).catch((error) => {
        console.error("[chatgpt-companion] side panel configuration failed", error);
    });

    void chrome.sidePanel.open({ tabId }).catch((error) => {
        console.error("[chatgpt-companion] side panel open failed", error);
    });
}

function getMappedTabIds(sessionId: string, tabSessionIds: Record<string, string>): string[] {
    return Object.entries(tabSessionIds)
        .filter(([, mappedSessionId]) => mappedSessionId === sessionId)
        .map(([tabId]) => tabId);
}

function normalizeOptionsPreferredLanguage(value: unknown): string {
    if (typeof value !== "string") {
        return DEFAULT_PREFERRED_LANGUAGE;
    }

    return value.trim() || DEFAULT_PREFERRED_LANGUAGE;
}

function normalizeOptionsPreferredSendingMode(value: unknown): PreferredSendingMode {
    return value === "auto" ? "auto" : DEFAULT_PREFERRED_SENDING_MODE;
}

function normalizeOptionsPreferredChatMode(value: unknown): PreferredChatMode {
    return value === "temporary" ? "temporary" : DEFAULT_PREFERRED_CHAT_MODE;
}

function normalizeOptionsPromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) {
        return getDefaultPromptTemplates();
    }

    const promptTemplates = value
        .filter((promptTemplate): promptTemplate is PromptTemplate => {
            return typeof promptTemplate?.id === "string" &&
                typeof promptTemplate?.name === "string" &&
                typeof promptTemplate?.template === "string";
        })
        .map((promptTemplate) => ({
            id: promptTemplate.id,
            name: promptTemplate.name.trim() || "Prompt",
            template: promptTemplate.template.trim() || DEFAULT_PROMPT_TEMPLATE
        }));

    return promptTemplates.length > 0 ? promptTemplates : getDefaultPromptTemplates();
}

function updateSaveButtonState(): void {
    if (!preferredLanguageInput || !preferredSendingModeSelect || !preferredChatModeSelect || !saveSettingsBtn) {
        return;
    }

    const currentPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const currentPreferredSendingMode = normalizeOptionsPreferredSendingMode(preferredSendingModeSelect.value);
    const currentPreferredChatMode = normalizeOptionsPreferredChatMode(preferredChatModeSelect.value);
    const promptTemplatesChanged = serializePromptTemplates(readPromptTemplateEditors()) !==
        serializePromptTemplates(savedPromptTemplates);

    saveSettingsBtn.disabled = isSavingSettings ||
        (
            currentPreferredLanguage === savedPreferredLanguage &&
            currentPreferredSendingMode === savedPreferredSendingMode &&
            currentPreferredChatMode === savedPreferredChatMode &&
            !promptTemplatesChanged
        );
}

function serializePromptTemplates(promptTemplates: PromptTemplate[]): string {
    return JSON.stringify(promptTemplates.map((promptTemplate) => ({
        id: promptTemplate.id,
        name: promptTemplate.name,
        template: promptTemplate.template
    })));
}
