/**
 * Page metadata collected from the source tab when a discussion starts.
 */
export type DiscussionSource = {
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
export type DiscussionState = {
    /** generated prompt inserted into ChatGPT */
    prompt: string;
    /** last prompt update timestamp used for ordering and reinsertion */
    stamp: number;
    /** original page metadata used to create and restore the discussion */
    source: DiscussionSource;
    /** whether the ChatGPT content script already inserted this prompt */
    consumed: boolean;
    /** ChatGPT conversation URL captured after ChatGPT creates a thread */
    chatUrl?: string;
    /** whether this discussion is only valid while its side panel is open */
    temporary?: boolean;
    /** response language requested when this discussion was created */
    responseLanguage: string;
    /** prompt template id used when this discussion was created */
    promptTemplateId?: string;
    /** prompt template name used when this discussion was created */
    promptTemplateName: string;
};

/**
 * Tab-scoped decision shown when a restored session differs from a new
 * discussion request.
 */
export type DiscussionMismatch = {
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
    /** whether the new request targets different source text or URL */
    requestedSourceChanged: boolean;
    /** selection text to reuse if the user restarts the discussion */
    selectionText: string;
};
