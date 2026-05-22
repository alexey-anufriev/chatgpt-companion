import {
    getDefaultPromptTemplates
} from "../prompts.js";
import {
    hasSyncedSettings,
    normalizeHiddenDefaultPromptTemplateIds,
    normalizePreferredChatMode,
    normalizePreferredLanguage,
    normalizePreferredSendingMode,
    SYNC_SETTING_KEYS
} from "../settings.js";
import type {
    PreferredChatMode,
    PreferredSendingMode,
    PromptTemplate,
    State
} from "../settings.js";
import type {
    RuntimeMessage,
    RuntimeResponse
} from "../events.js";
import type {
    DiscussionState
} from "../context.js";

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
const shortcutHintEl = document.getElementById("shortcutHint") as HTMLSpanElement | null;
const cloudSyncBtn = document.getElementById("cloudSyncBtn") as HTMLButtonElement | null;
const saveSettingsBtn = document.getElementById("saveSettingsBtn") as HTMLButtonElement | null;
const addPromptTemplateBtn = document.getElementById("addPromptTemplateBtn") as HTMLButtonElement | null;
const promptTemplatesListEl = document.getElementById("promptTemplatesList") as HTMLDivElement | null;
const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

type SessionEntry = [string, DiscussionState];
type OptionsPreferences = {
    preferredLanguage: string;
    preferredSendingMode: PreferredSendingMode;
    preferredChatMode: PreferredChatMode;
    hiddenDefaultPromptTemplateIds: string[];
};

let savedPreferences = normalizeOptionsPreferences({});
let savedPromptTemplates: PromptTemplate[] = getDefaultPromptTemplates();
const defaultPromptTemplatesById = new Map(
    getDefaultPromptTemplates().map((promptTemplate) => [promptTemplate.id, promptTemplate])
);
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
    !shortcutHintEl ||
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
        const customPromptTemplateGroup = promptTemplatesListEl.querySelector<HTMLElement>(
            "[data-prompt-template-group='custom']"
        );
        customPromptTemplateGroup?.querySelector(".promptTemplateGroupEmpty")?.remove();
        addPromptTemplateEditor({
            id: crypto.randomUUID(),
            name: "New Prompt",
            template: OPTIONS_NEW_PROMPT_TEMPLATE
        }, true, customPromptTemplateGroup ?? promptTemplatesListEl);
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
            !isSavingSettings &&
            !isChangingCloudSync &&
            areaName === "local" &&
            (
                changes["preferredLanguage"] ||
                changes["preferredSendingMode"] ||
                changes["preferredChatMode"] ||
                changes["hiddenDefaultPromptTemplateIds"] ||
                changes["promptTemplates"] ||
                changes["cloudSyncEnabled"]
            )
        ) {
            void loadSettings({ pullCloud: false });
        }
    });

    void loadSettings();
    void renderShortcutHint();
    void renderPersistedSessions();
}

async function renderShortcutHint(): Promise<void> {
    if (!shortcutHintEl) {
        return;
    }

    try {
        const commands = await chrome.commands.getAll();
        const command = commands.find((item) => item.name === "open-prompt-picker");
        shortcutHintEl.textContent = `Current hotkey: ${command?.shortcut || "not assigned"}`;
    } catch (error) {
        console.error("[chatgpt-companion] shortcut hint read failed", error);
    }
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

async function loadSettings(options: { pullCloud?: boolean } = {}): Promise<void> {
    if (isLoadingSettings) {
        return;
    }

    isLoadingSettings = true;

    try {
        const shouldPullCloud = options.pullCloud ?? true;
        const syncState = (await chrome.storage.local.get("cloudSyncEnabled")) as State;

        if (shouldPullCloud && syncState.cloudSyncEnabled) {
            await pullOptionsCloudSettingsToLocal().catch((error) => {
                console.error("[chatgpt-companion] cloud settings pull failed", error);
            });
        }

        const storage = (await chrome.storage.local.get(SYNC_SETTING_KEYS)) as State;

        savedCloudSyncEnabled = storage.cloudSyncEnabled === true;
        renderCloudSyncButton();
        renderPreferences(storage);
        renderPromptTemplates(storage.promptTemplates);
    } finally {
        isLoadingSettings = false;
    }
}

function renderPreferences(
    state: Pick<State, "preferredLanguage" | "preferredSendingMode" | "preferredChatMode" | "hiddenDefaultPromptTemplateIds">
): void {
    if (!preferredLanguageInput || !preferredSendingModeSelect || !preferredChatModeSelect) {
        return;
    }

    savedPreferences = normalizeOptionsPreferences(state);
    preferredLanguageInput.value = savedPreferences.preferredLanguage;
    preferredSendingModeSelect.value = savedPreferences.preferredSendingMode;
    preferredChatModeSelect.value = savedPreferences.preferredChatMode;
    updateSaveButtonState();
}

function renderPromptTemplates(promptTemplates: unknown): void {
    if (!promptTemplatesListEl) {
        return;
    }

    savedPromptTemplates = normalizeOptionsPromptTemplates(promptTemplates);
    promptTemplatesListEl.replaceChildren();

    const defaultPromptTemplates = savedPromptTemplates.filter((promptTemplate) => {
        return defaultPromptTemplatesById.has(promptTemplate.id);
    });
    const customPromptTemplates = savedPromptTemplates.filter((promptTemplate) => {
        return !defaultPromptTemplatesById.has(promptTemplate.id);
    });

    appendPromptTemplateGroup(
        "Default prompts",
        defaultPromptTemplates,
        "Default prompts are provided by the extension.",
        "default"
    );
    appendPromptTemplateGroup("Custom prompts", customPromptTemplates, "No custom prompts yet.", "custom");

    updateSaveButtonState();
}

function appendPromptTemplateGroup(
    title: string,
    promptTemplates: PromptTemplate[],
    emptyText: string,
    groupId: string
): void {
    if (!promptTemplatesListEl) {
        return;
    }

    const group = document.createElement("section");
    group.className = "promptTemplateGroup";
    group.dataset.promptTemplateGroup = groupId;

    const heading = document.createElement("h3");
    heading.className = "promptTemplateGroupTitle";
    heading.textContent = title;
    group.append(heading);

    if (promptTemplates.length === 0) {
        const empty = document.createElement("p");
        empty.className = "promptTemplateGroupEmpty";
        empty.textContent = emptyText;
        group.append(empty);
    }

    for (const promptTemplate of promptTemplates) {
        addPromptTemplateEditor(promptTemplate, false, group);
    }

    promptTemplatesListEl.append(group);
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

    const nextPreferences = readPreferenceControls();
    if (!nextPreferences) {
        return;
    }

    const promptTemplateValidationError = getPromptTemplateEditorValidationError();
    if (promptTemplateValidationError) {
        setStatus(promptTemplateValidationError);
        return;
    }

    const nextPromptTemplates = readPromptTemplateEditors();

    isSavingSettings = true;
    updateSaveButtonState();
    setStatus("Saving settings...", false);

    try {
        console.log("[chatgpt-companion] saving settings", {
            promptTemplateCount: nextPromptTemplates.length,
            promptTemplateIds: nextPromptTemplates.map((promptTemplate) => promptTemplate.id),
            cloudSyncEnabled: savedCloudSyncEnabled
        });

        await chrome.storage.local.set({
            ...nextPreferences,
            promptTemplates: nextPromptTemplates
        });

        savedPreferences = nextPreferences;
        savedPromptTemplates = nextPromptTemplates;
        renderPreferences(nextPreferences);
        renderPromptTemplates(nextPromptTemplates);

        if (savedCloudSyncEnabled) {
            try {
                await pushOptionsCloudSettings(
                    nextPreferences,
                    nextPromptTemplates
                );
                console.log("[chatgpt-companion] cloud settings pushed", {
                    promptTemplateCount: nextPromptTemplates.length,
                    promptTemplateIds: nextPromptTemplates.map((promptTemplate) => promptTemplate.id)
                });
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

        if (hasSyncedSettings(cloudSettings)) {
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

    if (!cloudSettings.cloudSyncEnabled && !hasSyncedSettings(cloudSettings)) {
        return;
    }

    await applyOptionsCloudSettingsToLocal(cloudSettings);
}

async function applyOptionsCloudSettingsToLocal(cloudSettings: State): Promise<void> {
    await chrome.storage.local.set({
        ...normalizeOptionsPreferences(cloudSettings),
        promptTemplates: normalizeOptionsPromptTemplates(cloudSettings.promptTemplates)
    });
}

async function pushOptionsCloudSettings(
    preferences: OptionsPreferences,
    promptTemplates: PromptTemplate[]
): Promise<void> {
    await chrome.storage.sync.set({
        cloudSyncEnabled: true,
        ...preferences,
        promptTemplates
    });
}

async function readOptionsCloudSettings(): Promise<State> {
    return (await chrome.storage.sync.get(SYNC_SETTING_KEYS)) as State;
}

function addPromptTemplateEditor(
    promptTemplate: PromptTemplate,
    expanded = false,
    container: HTMLElement | null = promptTemplatesListEl
): void {
    if (!container) {
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
    const defaultPromptTemplate = defaultPromptTemplatesById.get(promptTemplate.id);
    const isDefaultPromptHidden = savedPreferences.hiddenDefaultPromptTemplateIds.includes(promptTemplate.id);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = expanded ? "Collapse" : "Edit";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";

    const visibilityButton = document.createElement("button");
    visibilityButton.type = "button";

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

    const updateVisibilityButtonState = () => {
        if (!defaultPromptTemplate) {
            return;
        }

        const isHidden = row.dataset.defaultPromptHidden === "true";
        visibilityButton.textContent = isHidden ? "Show" : "Hide";
        row.classList.toggle("hiddenPromptTemplate", isHidden);
    };

    const updateResetButtonState = () => {
        if (!defaultPromptTemplate) {
            return;
        }

        resetButton.disabled = nameInput.value.trim() === defaultPromptTemplate.name &&
            templateInput.value.trim() === defaultPromptTemplate.template;
    };

    nameInput.addEventListener("input", () => {
        title.textContent = nameInput.value.trim() || "Prompt";
        updateResetButtonState();
        updateSaveButtonState();
    });
    templateInput.addEventListener("input", () => {
        updateResetButtonState();
        updateSaveButtonState();
    });
    editButton.addEventListener("click", () => {
        const isExpanded = row.classList.toggle("expanded");
        editButton.textContent = isExpanded ? "Collapse" : "Edit";
    });
    resetButton.addEventListener("click", () => {
        if (!defaultPromptTemplate) {
            return;
        }

        nameInput.value = defaultPromptTemplate.name;
        templateInput.value = defaultPromptTemplate.template;
        title.textContent = defaultPromptTemplate.name;
        row.classList.add("expanded");
        editButton.textContent = "Collapse";
        updateResetButtonState();
        updateSaveButtonState();
    });
    visibilityButton.addEventListener("click", () => {
        if (!defaultPromptTemplate) {
            return;
        }

        row.dataset.defaultPromptHidden = row.dataset.defaultPromptHidden === "true" ? "false" : "true";
        updateVisibilityButtonState();
        updateSaveButtonState();
    });
    removeButton.addEventListener("click", () => {
        row.remove();
        updateSaveButtonState();
    });

    actions.append(editButton);
    if (defaultPromptTemplate) {
        row.dataset.defaultPromptHidden = isDefaultPromptHidden ? "true" : "false";
        updateVisibilityButtonState();
        updateResetButtonState();
        actions.append(visibilityButton);
        actions.append(resetButton);
    }
    if (!defaultPromptTemplate) {
        actions.append(removeButton);
    }
    header.append(title, actions);
    body.append(nameInput, templateInput);
    row.append(header, body);
    container.append(row);
}

function readPromptTemplateEditors(): PromptTemplate[] {
    if (!promptTemplatesListEl) {
        return getDefaultPromptTemplates();
    }

    const promptTemplates = Array.from(promptTemplatesListEl.querySelectorAll<HTMLElement>(".promptTemplate"))
        .map((row) => {
            const name = row.querySelector<HTMLInputElement>(".promptTemplateName")?.value.trim() ?? "";
            const template = row.querySelector<HTMLTextAreaElement>(".promptTemplateText")?.value.trim() ?? "";

            return {
                id: row.dataset.templateId || crypto.randomUUID(),
                name,
                template
            };
        });

    return promptTemplates.length > 0 ? promptTemplates : getDefaultPromptTemplates();
}

function getPromptTemplateEditorValidationError(): string | null {
    if (!promptTemplatesListEl) {
        return null;
    }

    const rows = Array.from(promptTemplatesListEl.querySelectorAll<HTMLElement>(".promptTemplate"));
    const invalidIndex = rows.findIndex((row) => {
        const name = row.querySelector<HTMLInputElement>(".promptTemplateName")?.value.trim() ?? "";
        const template = row.querySelector<HTMLTextAreaElement>(".promptTemplateText")?.value.trim() ?? "";

        return !name || !template;
    });

    if (invalidIndex === -1) {
        return null;
    }

    return `Prompt template ${invalidIndex + 1} needs both a name and prompt text.`;
}

async function requestClearDataAndCache(): Promise<void> {
    if (!clearDataBtn || !statusEl) {
        return;
    }

    if (!confirm("Clear all persisted sessions, tab mappings, and discussion drafts?")) {
        return;
    }

    clearDataBtn.disabled = true;
    setStatus("Clearing sessions...", false);

    try {
        await sendRuntimeRequest({ type: "clear-data-and-cache" }, "Clear operation failed");
        setStatus("Sessions cleared.");
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
    chatUrl.textContent = discussion.chatUrl || (
        discussion.temporary ? "Temporary chat URL is not saved" : "Chat URL not saved yet"
    );
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
        await sendRuntimeRequest({
            type: "delete-session",
            sessionId
        }, "Delete session failed");
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
        await sendRuntimeRequest({ type: "sync-session-tabs" }, "Session tab sync failed");
    } catch (error) {
        console.error("[chatgpt-companion] session tab sync failed", error);
    }
}

async function requestFocusSessionTab(sessionId: string, tabId: number, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    openSidePanelForTab(tabId);

    try {
        await sendRuntimeRequest({
            type: "focus-session-tab",
            sessionId
        }, "Tab focus failed");
    } catch (error) {
        console.error("[chatgpt-companion] focus session tab failed", error);
        setStatus(error instanceof Error ? error.message : "Tab is no longer open.");
        await renderPersistedSessions();
    } finally {
        button.disabled = false;
    }
}

async function sendRuntimeRequest(message: RuntimeMessage, fallbackError: string): Promise<RuntimeResponse> {
    const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>(message);
    if (!response?.ok) {
        throw new Error(response?.error || fallbackError);
    }

    return response;
}

function openSidePanelForTab(tabId: number): void {
    if (!Number.isInteger(tabId)) {
        return;
    }

    void chrome.sidePanel.setOptions({
        tabId,
        path: `sidepanel/index.html?tabId=${tabId}`,
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

function normalizeOptionsPreferences(
    state: {
        preferredLanguage?: unknown;
        preferredSendingMode?: unknown;
        preferredChatMode?: unknown;
        hiddenDefaultPromptTemplateIds?: unknown;
    }
): OptionsPreferences {
    return {
        preferredLanguage: normalizePreferredLanguage(state.preferredLanguage),
        preferredSendingMode: normalizePreferredSendingMode(state.preferredSendingMode),
        preferredChatMode: normalizePreferredChatMode(state.preferredChatMode),
        hiddenDefaultPromptTemplateIds: normalizeHiddenDefaultPromptTemplateIds(state.hiddenDefaultPromptTemplateIds)
    };
}

function readPreferenceControls(): OptionsPreferences | null {
    if (!preferredLanguageInput || !preferredSendingModeSelect || !preferredChatModeSelect) {
        return null;
    }

    return normalizeOptionsPreferences({
        preferredLanguage: preferredLanguageInput.value,
        preferredSendingMode: preferredSendingModeSelect.value,
        preferredChatMode: preferredChatModeSelect.value,
        hiddenDefaultPromptTemplateIds: readHiddenDefaultPromptTemplateIds()
    });
}

function arePreferencesEqual(left: OptionsPreferences, right: OptionsPreferences): boolean {
    return left.preferredLanguage === right.preferredLanguage &&
        left.preferredSendingMode === right.preferredSendingMode &&
        left.preferredChatMode === right.preferredChatMode &&
        areStringArraysEqual(left.hiddenDefaultPromptTemplateIds, right.hiddenDefaultPromptTemplateIds);
}

function readHiddenDefaultPromptTemplateIds(): string[] {
    if (!promptTemplatesListEl) {
        return savedPreferences.hiddenDefaultPromptTemplateIds;
    }

    return Array.from(promptTemplatesListEl.querySelectorAll<HTMLElement>(".promptTemplate"))
        .filter((row) => row.dataset.defaultPromptHidden === "true")
        .map((row) => row.dataset.templateId)
        .filter((templateId): templateId is string => {
            return typeof templateId === "string" && defaultPromptTemplatesById.has(templateId);
        });
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const rightValues = new Set(right);
    return left.every((value) => rightValues.has(value));
}

function normalizeOptionsPromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) {
        return getDefaultPromptTemplates();
    }

    const defaultPromptTemplates = getDefaultPromptTemplates();
    const defaultPromptTemplateIds = new Set(defaultPromptTemplates.map((promptTemplate) => promptTemplate.id));
    const storedPromptTemplates = value
        .filter((promptTemplate): promptTemplate is PromptTemplate => {
            return typeof promptTemplate?.id === "string" &&
                typeof promptTemplate?.name === "string" &&
                typeof promptTemplate?.template === "string" &&
                promptTemplate.name.trim().length > 0 &&
                promptTemplate.template.trim().length > 0;
        })
        .map((promptTemplate) => ({
            id: promptTemplate.id.trim() || crypto.randomUUID(),
            name: promptTemplate.name.trim(),
            template: promptTemplate.template.trim()
        }));
    const storedPromptTemplatesById = new Map(
        storedPromptTemplates.map((promptTemplate) => [promptTemplate.id, promptTemplate])
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

function updateSaveButtonState(): void {
    if (!saveSettingsBtn) {
        return;
    }

    const currentPreferences = readPreferenceControls();
    const promptTemplatesChanged = serializePromptTemplates(readPromptTemplateEditors()) !==
        serializePromptTemplates(savedPromptTemplates);

    saveSettingsBtn.disabled = isSavingSettings ||
        !currentPreferences ||
        (arePreferencesEqual(currentPreferences, savedPreferences) && !promptTemplatesChanged);
}

function serializePromptTemplates(promptTemplates: PromptTemplate[]): string {
    return JSON.stringify(promptTemplates.map((promptTemplate) => ({
        id: promptTemplate.id,
        name: promptTemplate.name,
        template: promptTemplate.template
    })));
}
