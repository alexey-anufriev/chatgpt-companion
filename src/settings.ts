import type {
    DiscussionMismatch,
    DiscussionState
} from "./context.js";

export const DEFAULT_PREFERRED_LANGUAGE = "English";
export const DEFAULT_PREFERRED_CHAT_MODE = "normal";
export const DEFAULT_PREFERRED_SENDING_MODE = "manual";

export type PreferredChatMode = "normal" | "temporary";
export type PreferredSendingMode = "manual" | "auto";

/**
 * User-editable prompt template stored in extension settings.
 */
export type PromptTemplate = {
    /** stable id used by settings and context menu parsing */
    id: string;
    /** display name shown in settings and context menus */
    name: string;
    /** raw template text rendered with page, date, time, and preferred language macros */
    template: string;
};

/**
 * chrome.storage.local shape owned by the extension.
 */
export type State = {
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
    /** preferred ChatGPT entry mode for new side panel loads */
    preferredChatMode?: PreferredChatMode;
    /** whether injected prompts should stay in the composer or submit automatically */
    preferredSendingMode?: PreferredSendingMode;
    /** stored prompt templates that override the hardcoded default */
    promptTemplates?: PromptTemplate[];
    /** whether extension settings should mirror to chrome.storage.sync */
    cloudSyncEnabled?: boolean;
    /** source tab id to pending discussion mismatch prompt */
    discussionMismatches?: Record<string, DiscussionMismatch>;
};

export const SYNC_SETTING_KEYS: (keyof State)[] = [
    "cloudSyncEnabled",
    "preferredLanguage",
    "preferredSendingMode",
    "preferredChatMode",
    "promptTemplates"
];
