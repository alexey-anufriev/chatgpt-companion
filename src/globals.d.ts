type DiscussSource = {
    title: string;
    url: string;
    selection: string;
};

type StorageShape = {
    discussPrompt?: string;
    discussPromptStamp?: number;
    discussSource?: DiscussSource;
};