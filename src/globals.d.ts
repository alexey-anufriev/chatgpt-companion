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
};

type StorageShape = {
    discussions?: Record<string, DiscussionState>;
    tabSessionIds?: Record<string, string>;
    closeDiscussionSessionId?: string;
    clearAllDiscussionDraftsStamp?: number;
};

type RuntimeMessage = {
    type: "clear-data-and-cache";
};

type RuntimeResponse = {
    ok: boolean;
    error?: string;
};
