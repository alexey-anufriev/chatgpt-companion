type DiscussSource = {
    title: string;
    url: string;
    selection: string;
};

type DiscussionState = {
    prompt: string;
    stamp: number;
    source: DiscussSource;
    consumed: boolean;
    chatUrl?: string;
    responseLanguage?: string;
};

type PendingLanguageMismatch = {
    tabId: number;
    currentLanguage: string;
    requestedLanguage: string;
    selectionText: string;
    stamp: number;
};

type StorageShape = {
    discussions?: Record<string, DiscussionState>;
    tabSessionIds?: Record<string, string>;
    closeDiscussionSessionId?: string;
    clearAllDiscussionDraftsStamp?: number;
    preferredLanguage?: string;
    pendingLanguageMismatches?: Record<string, PendingLanguageMismatch>;
};

type RuntimeMessage =
    | { type: "clear-data-and-cache" }
    | {
        type: "restart-discussion";
        tabId: number;
        requestedLanguage: string;
        selectionText: string;
    };

type RuntimeResponse = {
    ok: boolean;
    error?: string;
};
