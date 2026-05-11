/**
 * Page metadata collected from the source tab when a discussion starts.
 */
type DiscussSource = {
    /** page title at the moment the context menu action was clicked */
    title: string;
    /** full source page URL used to rebind restored tabs to sessions */
    url: string;
    /** selected page text passed from the context menu action */
    selection: string;
};

/**
 * Persisted extension discussion bound to one source page.
 */
type DiscussionState = {
    /** generated prompt inserted into ChatGPT */
    prompt: string;
    /** last prompt update timestamp used for ordering and reinsertion */
    stamp: number;
    /** original page metadata used to create and restore the discussion */
    source: DiscussSource;
    /** whether the ChatGPT content script already inserted this prompt */
    consumed: boolean;
    /** ChatGPT conversation URL captured after ChatGPT creates a thread */
    chatUrl?: string;
    /** response language requested when this discussion was created */
    responseLanguage: string;
    /** prompt template name used when this discussion was created */
    promptTemplateName: string;
};

/**
 * User-editable prompt template stored in extension settings.
 */
type PromptTemplate = {
    /** stable id used by settings and context menu parsing */
    id: string;
    /** display name shown in settings and context menus */
    name: string;
    /** raw template text rendered with page, date, time, and preferred language macros */
    template: string;
};

/**
 * Tab-scoped decision shown when a restored session differs from the selected
 * prompt settings.
 */
type PendingLanguageMismatch = {
    /** source tab id that should show the mismatch prompt */
    tabId: number;
    /** language stored on the restored session */
    currentLanguage: string;
    /** prompt template stored on the restored session */
    currentPromptTemplateName: string;
    /** response language implied by the selected prompt template */
    requestedLanguage: string;
    /** prompt template selected from the context menu */
    requestedPromptTemplateId: string;
    /** display name for the selected prompt template */
    requestedPromptTemplateName: string;
    /** linked page URL to reuse if the user restarts a linked discussion */
    requestedLinkUrl?: string;
    /** selection text to reuse if the user restarts the discussion */
    selectionText: string;
    /** creation timestamp used to distinguish newer prompts */
    stamp: number;
};

/**
 * chrome.storage.local shape owned by the extension.
 */
type StorageShape = {
    /** session id to persisted discussion */
    discussions?: Record<string, DiscussionState>;
    /** source tab id to session id */
    tabSessionIds?: Record<string, string>;
    /** session id whose transient ChatGPT draft should be cleared */
    closeDiscussionSessionId?: string;
    /** timestamp used to ask content scripts to clear all extension drafts */
    clearAllDiscussionDraftsStamp?: number;
    /** preferred response language used by preferred-language templates */
    preferredLanguage?: string;
    /** stored prompt templates that override the hardcoded default */
    promptTemplates?: PromptTemplate[];
    /** whether extension settings should mirror to chrome.storage.sync */
    cloudSyncEnabled?: boolean;
    /** source tab id to pending settings mismatch prompt */
    pendingLanguageMismatches?: Record<string, PendingLanguageMismatch>;
};

/**
 * Runtime messages accepted by the background service worker.
 */
type RuntimeMessage =
    | {
        /** close panels and wipe extension-owned storage, session data, and caches */
        type: "clear-data-and-cache";
    }
    | {
        /** replace the current tab discussion with selected prompt settings */
        type: "restart-discussion";
        /** source tab id whose discussion should restart */
        tabId: number;
        /** prompt template id for the restarted discussion */
        requestedPromptTemplateId: string;
        /** linked page URL to use when restarting a linked discussion */
        requestedLinkUrl?: string;
        /** source text to pass into the regenerated prompt */
        selectionText: string;
    };

/**
 * Generic runtime response for side panel and options requests.
 */
type RuntimeResponse = {
    /** whether the request completed successfully */
    ok: boolean;
    /** normalized error message when ok is false */
    error?: string;
};
