import {
    DEFAULT_PROMPT_TEMPLATE,
    getDefaultPromptTemplates
} from "./prompts.js";
import {
    DEFAULT_PREFERRED_CHAT_MODE,
    DEFAULT_PREFERRED_LANGUAGE,
    SYNC_SETTING_KEYS
} from "./settings.js";
import type {
    PreferredChatMode,
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
const preferredChatModeSelect = document.getElementById("preferredChatMode") as HTMLSelectElement | null;
const cloudSyncBtn = document.getElementById("cloudSyncBtn") as HTMLButtonElement | null;
const saveSettingsBtn = document.getElementById("saveSettingsBtn") as HTMLButtonElement | null;
const addPromptTemplateBtn = document.getElementById("addPromptTemplateBtn") as HTMLButtonElement | null;
const promptTemplatesListEl = document.getElementById("promptTemplatesList") as HTMLDivElement | null;
const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

let savedPreferredLanguage = DEFAULT_PREFERRED_LANGUAGE;
let savedPreferredChatMode: PreferredChatMode = DEFAULT_PREFERRED_CHAT_MODE;
let savedPromptTemplates: PromptTemplate[] = getDefaultPromptTemplates();
let savedCloudSyncEnabled = false;
let isLoadingSettings = false;
let isChangingCloudSync = false;
let isSavingSettings = false;
let statusClearTimer: number | undefined;

if (
    !preferredLanguageInput ||
    !preferredChatModeSelect ||
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
    preferredChatModeSelect.addEventListener("change", () => {
        updateSaveButtonState();
    });

    saveSettingsBtn.addEventListener("click", () => {
        void saveSettings();
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
    if (!preferredLanguageInput || !preferredChatModeSelect || !saveSettingsBtn || !statusEl) {
        return;
    }

    const nextPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const nextPreferredChatMode = normalizeOptionsPreferredChatMode(preferredChatModeSelect.value);
    const nextPromptTemplates = readPromptTemplateEditors();

    isSavingSettings = true;
    updateSaveButtonState();
    setStatus("Saving settings...", false);

    try {
        await chrome.storage.local.set({
            preferredLanguage: nextPreferredLanguage,
            preferredChatMode: nextPreferredChatMode,
            promptTemplates: nextPromptTemplates
        });

        savedPreferredLanguage = nextPreferredLanguage;
        savedPreferredChatMode = nextPreferredChatMode;
        savedPromptTemplates = nextPromptTemplates;
        preferredLanguageInput.value = nextPreferredLanguage;
        preferredChatModeSelect.value = nextPreferredChatMode;
        renderPromptTemplates(nextPromptTemplates);

        if (savedCloudSyncEnabled) {
            try {
                await pushOptionsCloudSettings(nextPreferredLanguage, nextPreferredChatMode, nextPromptTemplates);
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
        preferredChatMode: normalizeOptionsPreferredChatMode(cloudSettings.preferredChatMode),
        promptTemplates: normalizeOptionsPromptTemplates(cloudSettings.promptTemplates)
    });
}

function hasOptionsCloudSettings(cloudSettings: State): boolean {
    return typeof cloudSettings.preferredLanguage === "string" ||
        typeof cloudSettings.preferredChatMode === "string" ||
        Array.isArray(cloudSettings.promptTemplates);
}

async function pushOptionsCloudSettings(
    preferredLanguage: string,
    preferredChatMode: PreferredChatMode,
    promptTemplates: PromptTemplate[]
): Promise<void> {
    await chrome.storage.sync.set({
        cloudSyncEnabled: true,
        preferredLanguage,
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

    const storage = (await chrome.storage.local.get([
        "discussions",
        "tabSessionIds"
    ])) as State;
    const discussions = Object.entries(storage.discussions ?? {}).sort(([, left], [, right]) => {
        return right.stamp - left.stamp;
    });
    const tabSessionIds = storage.tabSessionIds ?? {};

    sessionCountEl.textContent = String(discussions.length);
    sessionsListEl.replaceChildren();

    if (discussions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No persisted sessions.";
        sessionsListEl.append(empty);
        return;
    }

    for (const [sessionId, discussion] of discussions) {
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

    const meta = document.createElement("div");
    meta.className = "sessionMeta";
    meta.textContent = [
        `session: ${sessionId}`,
        `language: ${discussion.responseLanguage}`,
        `prompt: ${discussion.promptTemplateName}`,
        `updated: ${new Date(discussion.stamp).toLocaleString()}`,
        `consumed: ${discussion.consumed ? "yes" : "no"}`,
        `tab: ${getMappedTabIds(sessionId, tabSessionIds).join(", ") || "none"}`
    ].join(" | ");

    row.append(title, sourceUrlRow, chatUrlRow, meta);
    return row;
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
    if (!preferredLanguageInput || !preferredChatModeSelect || !saveSettingsBtn) {
        return;
    }

    const currentPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const currentPreferredChatMode = normalizeOptionsPreferredChatMode(preferredChatModeSelect.value);
    const promptTemplatesChanged = serializePromptTemplates(readPromptTemplateEditors()) !==
        serializePromptTemplates(savedPromptTemplates);

    saveSettingsBtn.disabled = isSavingSettings ||
        (
            currentPreferredLanguage === savedPreferredLanguage &&
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
