/**
 * Runtime messages accepted by the background service worker.
 */
export type RuntimeMessage =
    | {
        /** close panels and wipe extension-owned storage, session data, and caches */
        type: "clear-data-and-cache";
    }
    | {
        /** add selected prompt settings as a continuation in the current chat */
        type: "continue-discussion";
        /** source tab id whose discussion should continue */
        tabId: number;
        /** prompt template id for the continuation */
        requestedPromptTemplateId: string;
        /** linked page URL to use when continuing from a linked discussion */
        requestedLinkUrl?: string;
        /** source text to pass into the continuation prompt */
        selectionText: string;
    }
    | {
        /** replace the current tab discussion with a separate new chat */
        type: "start-new-discussion";
        /** source tab id whose discussion should be replaced */
        tabId: number;
        /** prompt template id for the new discussion */
        requestedPromptTemplateId: string;
        /** linked page URL to use when starting from a linked discussion */
        requestedLinkUrl?: string;
        /** source text to pass into the new prompt */
        selectionText: string;
    };

/**
 * Generic runtime response for side panel and options requests.
 */
export type RuntimeResponse = {
    /** whether the request completed successfully */
    ok: boolean;
    /** normalized error message when ok is false */
    error?: string;
};
