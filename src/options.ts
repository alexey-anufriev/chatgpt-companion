const OPTIONS_DEFAULT_PREFERRED_LANGUAGE = "English";
const OPTIONS_ORIGINAL_LANGUAGE_LABEL = "Original language";
const OPTIONS_DEFAULT_PROMPT_TEMPLATE = [
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
const OPTIONS_DEFAULT_TRANSLATED_PROMPT_TEMPLATE = [
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
const OPTIONS_SHORT_SUMMARY_PROMPT_TEMPLATE = [
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
const OPTIONS_SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE = [
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
const OPTIONS_PROMPT_TEMPLATE_IDS_BEFORE_TRANSLATED_SUMMARY = new Set([
    "default",
    "default-translated",
    "short-summary"
]);
const OPTIONS_SYNC_SETTING_KEYS: (keyof StorageShape)[] = [
    "cloudSyncEnabled",
    "preferredLanguage",
    "promptTemplates"
];

const preferredLanguageInput = document.getElementById("preferredLanguage") as HTMLInputElement | null;
const cloudSyncBtn = document.getElementById("cloudSyncBtn") as HTMLButtonElement | null;
const saveSettingsBtn = document.getElementById("saveSettingsBtn") as HTMLButtonElement | null;
const addPromptTemplateBtn = document.getElementById("addPromptTemplateBtn") as HTMLButtonElement | null;
const promptTemplatesListEl = document.getElementById("promptTemplatesList") as HTMLDivElement | null;
const clearDataBtn = document.getElementById("clearDataBtn") as HTMLButtonElement | null;
const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
const sessionsListEl = document.getElementById("sessionsList") as HTMLDivElement | null;
const sessionCountEl = document.getElementById("sessionCount") as HTMLSpanElement | null;

let savedPreferredLanguage = OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
let savedPromptTemplates: PromptTemplate[] = [getOptionsDefaultPromptTemplate()];
let savedCloudSyncEnabled = false;
let isLoadingSettings = false;
let isChangingCloudSync = false;
let isSavingSettings = false;

if (
    !preferredLanguageInput ||
    !cloudSyncBtn ||
    !saveSettingsBtn ||
    !addPromptTemplateBtn ||
    !promptTemplatesListEl ||
    !clearDataBtn ||
    !statusEl ||
    !sessionsListEl ||
    !sessionCountEl
) {
    console.error("[discuss-with-chatgpt-ext] options DOM elements not found");
} else {
    preferredLanguageInput.addEventListener("input", () => {
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
        });
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
            (changes["preferredLanguage"] || changes["promptTemplates"] || changes["cloudSyncEnabled"])
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
        const syncState = (await chrome.storage.local.get("cloudSyncEnabled")) as StorageShape;

        if (syncState.cloudSyncEnabled) {
            await pullOptionsCloudSettingsToLocal().catch((error) => {
                console.error("[discuss-with-chatgpt-ext] cloud settings pull failed", error);
            });
        }

        const storage = (await chrome.storage.local.get(OPTIONS_SYNC_SETTING_KEYS)) as StorageShape;

        savedCloudSyncEnabled = storage.cloudSyncEnabled === true;
        renderCloudSyncButton();
        renderPreferredLanguage(storage.preferredLanguage);
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
    if (!preferredLanguageInput || !saveSettingsBtn || !statusEl) {
        return;
    }

    const nextPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const nextPromptTemplates = readPromptTemplateEditors();

    isSavingSettings = true;
    updateSaveButtonState();
    statusEl.textContent = "Saving settings...";

    try {
        await chrome.storage.local.set({
            preferredLanguage: nextPreferredLanguage,
            promptTemplates: nextPromptTemplates
        });

        savedPreferredLanguage = nextPreferredLanguage;
        savedPromptTemplates = nextPromptTemplates;
        preferredLanguageInput.value = nextPreferredLanguage;
        renderPromptTemplates(nextPromptTemplates);

        if (savedCloudSyncEnabled) {
            try {
                await pushOptionsCloudSettings(nextPreferredLanguage, nextPromptTemplates);
                statusEl.textContent = "Settings saved and queued for cloud sync.";
            } catch (error) {
                console.error("[discuss-with-chatgpt-ext] cloud settings save failed", error);
                statusEl.textContent = "Settings saved locally. Cloud sync failed.";
            }
        } else {
            statusEl.textContent = "Settings saved.";
        }
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] save settings failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Save operation failed.";
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
    statusEl.textContent = "Enabling cloud sync...";

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
            statusEl.textContent = `Cloud sync enabled. Remote settings loaded.${warning}`;
        } else {
            statusEl.textContent = `Cloud sync enabled. Save settings to upload them.${warning}`;
        }

        savedCloudSyncEnabled = true;
        renderCloudSyncButton();
        await loadSettings();
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] enable cloud sync failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Cloud sync enable failed.";
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
    statusEl.textContent = "Disabling cloud sync...";

    try {
        await chrome.storage.local.set({
            cloudSyncEnabled: false
        });
        savedCloudSyncEnabled = false;
        statusEl.textContent = "Cloud sync disabled. Local settings kept.";
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] disable cloud sync failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Cloud sync disable failed.";
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
}

async function pullOptionsCloudSettingsToLocal(): Promise<void> {
    const cloudSettings = await readOptionsCloudSettings();

    if (!cloudSettings.cloudSyncEnabled && !hasOptionsCloudSettings(cloudSettings)) {
        return;
    }

    await applyOptionsCloudSettingsToLocal(cloudSettings);
}

async function applyOptionsCloudSettingsToLocal(cloudSettings: StorageShape): Promise<void> {
    await chrome.storage.local.set({
        preferredLanguage: normalizeOptionsPreferredLanguage(cloudSettings.preferredLanguage),
        promptTemplates: normalizeOptionsPromptTemplates(cloudSettings.promptTemplates)
    });
}

function hasOptionsCloudSettings(cloudSettings: StorageShape): boolean {
    return typeof cloudSettings.preferredLanguage === "string" || Array.isArray(cloudSettings.promptTemplates);
}

async function pushOptionsCloudSettings(preferredLanguage: string, promptTemplates: PromptTemplate[]): Promise<void> {
    await chrome.storage.sync.set({
        cloudSyncEnabled: true,
        preferredLanguage,
        promptTemplates
    });
}

async function readOptionsCloudSettings(): Promise<StorageShape> {
    return (await chrome.storage.sync.get(OPTIONS_SYNC_SETTING_KEYS)) as StorageShape;
}

function addPromptTemplateEditor(promptTemplate: PromptTemplate): void {
    if (!promptTemplatesListEl) {
        return;
    }

    const row = document.createElement("article");
    row.className = "promptTemplate";
    row.dataset.templateId = promptTemplate.id;

    const header = document.createElement("div");
    header.className = "promptTemplateHeader";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = promptTemplate.name;
    nameInput.placeholder = "Prompt name";
    nameInput.className = "promptTemplateName";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";

    const templateInput = document.createElement("textarea");
    templateInput.value = promptTemplate.template;
    templateInput.className = "promptTemplateText";
    templateInput.spellcheck = false;

    nameInput.addEventListener("input", () => {
        updateSaveButtonState();
    });
    templateInput.addEventListener("input", () => {
        updateSaveButtonState();
    });
    removeButton.addEventListener("click", () => {
        row.remove();
        updateSaveButtonState();
    });

    header.append(nameInput, removeButton);
    row.append(header, templateInput);
    promptTemplatesListEl.append(row);
}

function readPromptTemplateEditors(): PromptTemplate[] {
    if (!promptTemplatesListEl) {
        return getOptionsDefaultPromptTemplates();
    }

    const promptTemplates = Array.from(promptTemplatesListEl.querySelectorAll<HTMLElement>(".promptTemplate"))
        .map((row) => {
            const name = row.querySelector<HTMLInputElement>(".promptTemplateName")?.value.trim() || "Prompt";
            const template = sanitizeOptionsPromptTemplate(
                row.querySelector<HTMLTextAreaElement>(".promptTemplateText")?.value ?? ""
            ) ||
                OPTIONS_DEFAULT_PROMPT_TEMPLATE;

            return {
                id: row.dataset.templateId || crypto.randomUUID(),
                name,
                template
            };
        });

    return promptTemplates.length > 0 ?
        appendMissingOptionsTranslatedSummaryTemplate(promptTemplates) :
        getOptionsDefaultPromptTemplates();
}

async function requestClearDataAndCache(): Promise<void> {
    if (!clearDataBtn || !statusEl) {
        return;
    }

    clearDataBtn.disabled = true;
    statusEl.textContent = "Clearing data...";

    try {
        const response = await chrome.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
            type: "clear-data-and-cache"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "Clear operation failed");
        }

        statusEl.textContent = "Data and cache cleared.";
        await loadSettings();
        await renderPersistedSessions();
    } catch (error) {
        console.error("[discuss-with-chatgpt-ext] clear data request failed", error);
        statusEl.textContent = error instanceof Error ? error.message : "Clear operation failed.";
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
    ])) as StorageShape;
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
        `language: ${discussion.responseLanguage || OPTIONS_ORIGINAL_LANGUAGE_LABEL}`,
        `prompt: ${discussion.promptTemplateName || "Default"}`,
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
        return OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
    }

    return value.trim() || OPTIONS_DEFAULT_PREFERRED_LANGUAGE;
}

function normalizeOptionsPromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) {
        return getOptionsDefaultPromptTemplates();
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
            template: sanitizeOptionsPromptTemplate(promptTemplate.template) || OPTIONS_DEFAULT_PROMPT_TEMPLATE
        }));

    return promptTemplates.length > 0 ? promptTemplates : getOptionsDefaultPromptTemplates();
}

function getOptionsDefaultPromptTemplate(): PromptTemplate {
    return getOptionsDefaultPromptTemplates()[0];
}

function getOptionsDefaultPromptTemplates(): PromptTemplate[] {
    return [
        {
            id: "default",
            name: "Default",
            template: OPTIONS_DEFAULT_PROMPT_TEMPLATE
        },
        {
            id: "default-translated",
            name: "Default translated",
            template: OPTIONS_DEFAULT_TRANSLATED_PROMPT_TEMPLATE
        },
        {
            id: "short-summary",
            name: "Short summary",
            template: OPTIONS_SHORT_SUMMARY_PROMPT_TEMPLATE
        },
        {
            id: "short-summary-translated",
            name: "Short summary translated",
            template: OPTIONS_SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE
        }
    ];
}

function appendMissingOptionsTranslatedSummaryTemplate(promptTemplates: PromptTemplate[]): PromptTemplate[] {
    const hasOlderBuiltInTemplate = promptTemplates.some((promptTemplate) => {
        return OPTIONS_PROMPT_TEMPLATE_IDS_BEFORE_TRANSLATED_SUMMARY.has(promptTemplate.id);
    });
    const hasTranslatedSummaryTemplate = promptTemplates.some((promptTemplate) => {
        return promptTemplate.id === "short-summary-translated";
    });

    if (!hasOlderBuiltInTemplate || hasTranslatedSummaryTemplate) {
        return promptTemplates;
    }

    return [
        ...promptTemplates,
        {
            id: "short-summary-translated",
            name: "Short summary translated",
            template: OPTIONS_SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE
        }
    ];
}

function sanitizeOptionsPromptTemplate(template: string): string {
    return addSelectionConditionalsToLegacyOptionsTemplate(template)
        .replace(/\{response_language_instruction}/g, "")
        .replace(/\{response_language}/g, "")
        .trim();
}

function addSelectionConditionalsToLegacyOptionsTemplate(template: string): string {
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

function updateSaveButtonState(): void {
    if (!preferredLanguageInput || !saveSettingsBtn) {
        return;
    }

    const currentPreferredLanguage = normalizeOptionsPreferredLanguage(preferredLanguageInput.value);
    const promptTemplatesChanged = serializePromptTemplates(readPromptTemplateEditors()) !==
        serializePromptTemplates(savedPromptTemplates);

    saveSettingsBtn.disabled = isSavingSettings ||
        (currentPreferredLanguage === savedPreferredLanguage && !promptTemplatesChanged);
}

function serializePromptTemplates(promptTemplates: PromptTemplate[]): string {
    return JSON.stringify(promptTemplates.map((promptTemplate) => ({
        id: promptTemplate.id,
        name: promptTemplate.name,
        template: promptTemplate.template
    })));
}
