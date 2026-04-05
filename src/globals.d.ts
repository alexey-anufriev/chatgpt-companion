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
};

type StorageShape = {
    discussions?: Record<string, DiscussionState>;
    tabSessionIds?: Record<string, string>;
    closeDiscussionSessionId?: string;
};
