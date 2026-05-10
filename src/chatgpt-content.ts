/**
 * Stamp of the last prompt written into the composer, used as an in-page guard
 * against duplicate insertions from repeated storage notifications.
 */
let lastAppliedStamp: number | null = null;

/**
 * Extension session id owned by this ChatGPT document.
 */
let currentExtensionSessionId: string | null = null;

/**
 * Prevents duplicate storage listeners if the script is evaluated more than
 * once in the same ChatGPT document.
 */
let isStorageListenerAttached = false;

/**
 * Prevents duplicate hashchange listeners if the script is evaluated more than
 * once in the same ChatGPT document.
 */
let isHashListenerAttached = false;

/**
 * Prevents duplicate location listeners if the script is evaluated more than
 * once in the same ChatGPT document.
 */
let isLocationListenerAttached = false;

/**
 * Last URL observed by the content script's location poller.
 */
let lastObservedUrl = location.href;

/**
 * Starts the ChatGPT content-script integration once the script is evaluated.
 */
void bootstrap();

/**
 * Prepares the ChatGPT page integration and applies any prompt for the current
 * extension session once the composer is available.
 */
async function bootstrap(): Promise<void> {
    console.log("[chatgpt-companion] bootstrapper loaded", location.href);

    await waitForDocumentReady();

    // the listener must be attached before the initial storage read so a prompt
    // update cannot be missed while ChatGPT is still loading
    attachStorageListenerOnce();
    attachHashListenerOnce();
    attachLocationChangeListenerOnce();

    await syncComposerWithLocation();
    await rememberCurrentChatUrl();
}

/**
 * Attaches a single storage listener that reacts to prompt updates and side
 * panel close notifications.
 */
function attachStorageListenerOnce(): void {
    if (isStorageListenerAttached) {
        return;
    }

    // chatGPT integration only cares about extension-local storage; synced or
    // managed storage updates are ignored
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes["discussions"]) {
            await tryApplyLatestPrompt();
        }

        if (changes["closeDiscussionSessionId"]) {
            await clearChatGPTNullThreadDraft();
        }

        if (changes["clearAllDiscussionDraftsStamp"] && isEmbeddedFrame()) {
            await clearComposer();
        }
    });

    isStorageListenerAttached = true;
}

/**
 * Attaches a single listener for iframe hash changes initiated by the side panel.
 */
function attachHashListenerOnce(): void {
    if (isHashListenerAttached) {
        return;
    }

    window.addEventListener("hashchange", () => {
        void syncComposerWithLocation();
        void rememberCurrentChatUrl();
    });

    isHashListenerAttached = true;
}

/**
 * Attaches a single listener for ChatGPT's single-page-app URL changes.
 */
function attachLocationChangeListenerOnce(): void {
    if (isLocationListenerAttached) {
        return;
    }

    window.setInterval(() => {
        if (location.href === lastObservedUrl) {
            return;
        }

        lastObservedUrl = location.href;
        void rememberCurrentChatUrl();
    }, 500);

    isLocationListenerAttached = true;
}

/**
 * Applies the extension-owned ChatGPT iframe state from the current URL hash.
 */
async function syncComposerWithLocation(): Promise<void> {
    if (!getCurrentSessionId()) {
        if (isEmbeddedFrame() && !isConversationUrl()) {
            await clearComposer();
        }

        return;
    }

    await clearChatGPTNullThreadDraft();
    await tryApplyLatestPrompt();
}

/**
 * Returns true when the content script is running inside the side panel iframe.
 */
function isEmbeddedFrame(): boolean {
    return window.top !== window;
}

/**
 * Stores the real ChatGPT conversation URL created after the prompt is submitted.
 */
async function rememberCurrentChatUrl(): Promise<void> {
    const currentSessionId = getCurrentSessionId();
    if (!currentSessionId || !isConversationUrl()) {
        return;
    }

    const data = (await chrome.storage.local.get("discussions")) as StorageShape;
    const discussion = data.discussions?.[currentSessionId];
    if (!discussion) {
        return;
    }

    const chatUrl = `${location.origin}${location.pathname}${location.search}`;
    if (discussion.chatUrl === chatUrl) {
        return;
    }

    await chrome.storage.local.set({
        discussions: {
            ...(data.discussions ?? {}),
            [currentSessionId]: {
                ...discussion,
                chatUrl
            }
        }
    });

    console.log("[chatgpt-companion] chat URL saved", { currentSessionId, chatUrl });
}

/**
 * Checks whether ChatGPT is showing a real conversation route.
 */
function isConversationUrl(): boolean {
    return /^\/c\/[^/]+/.test(location.pathname);
}

/**
 * Clears the visible composer for a side panel iframe with no discussion session.
 */
async function clearComposer(): Promise<void> {
    lastAppliedStamp = null;

    try {
        removeNullThreadDraft();
    } catch (error) {
        console.warn("[chatgpt-companion] failed to clear null_thread draft", error);
    }

    const input = await waitForComposer();
    if (!input) {
        return;
    }

    insertPrompt(input, "");
    console.log("[chatgpt-companion] composer cleared for unbound side panel frame");
}

/**
 * Reads the current session prompt from extension storage, inserts it into the
 * ChatGPT composer, and marks it as consumed.
 */
async function tryApplyLatestPrompt(): Promise<void> {
    const currentSessionId = getCurrentSessionId();
    if (!currentSessionId) {
        if (isEmbeddedFrame() && !isConversationUrl()) {
            await clearComposer();
        }

        return;
    }

    const data = (await chrome.storage.local.get("discussions")) as StorageShape;
    const discussion = data.discussions?.[currentSessionId];

    if (!discussion || !discussion.stamp || discussion.consumed) {
        return;
    }

    // storage updates can arrive more than once for the same state; the stamp
    // guard avoids retyping an already-applied prompt
    if (lastAppliedStamp === discussion.stamp) {
        return;
    }

    const input = await waitForComposer();
    if (!input) {
        console.debug("[chatgpt-companion] ChatGPT composer not found");
        return;
    }

    insertPrompt(input, discussion.prompt);
    lastAppliedStamp = discussion.stamp;

    // mark the prompt consumed in extension storage so later page events do not
    // replay it into the composer
    const nextDiscussions = { ...(data.discussions ?? {}) };
    nextDiscussions[currentSessionId] = {
        ...discussion,
        consumed: true
    };

    await chrome.storage.local.set({
        discussions: nextDiscussions
    });

    if (discussion.prompt) {
        console.log("[chatgpt-companion] prompt inserted", { currentSessionId });
    } else {
        console.log("[chatgpt-companion] composer cleared", { currentSessionId });
    }
}

/**
 * Removes ChatGPT's transient null-thread draft when the matching extension
 * session is closed.
 */
async function clearChatGPTNullThreadDraft(): Promise<void> {
    const { closeDiscussionSessionId } = (await chrome.storage.local.get(
        "closeDiscussionSessionId"
    )) as StorageShape;
    const currentSessionId = getCurrentSessionId();

    if (!closeDiscussionSessionId || !currentSessionId || closeDiscussionSessionId !== currentSessionId) {
        return;
    }

    try {
        removeNullThreadDraft();
    } catch (error) {
        console.warn("[chatgpt-companion] failed to clear null_thread draft", error);
    } finally {
        // clear the close signal only if this page still owns it; a newer close
        // event for another session should remain visible to that tab
        const latest = (await chrome.storage.local.get("closeDiscussionSessionId")) as StorageShape;
        if (latest.closeDiscussionSessionId === currentSessionId) {
            await chrome.storage.local.set({
                closeDiscussionSessionId: undefined
            });
        }
    }
}

/**
 * Removes ChatGPT's stored new-thread draft without touching real conversations.
 */
function removeNullThreadDraft(): void {
    // chatGPT stores unsent new-thread composer drafts under this app-local key
    const key = "oai/apps/conversationDrafts";
    const raw = localStorage.getItem(key);
    if (!raw) {
        return;
    }

    const parsed = JSON.parse(raw) as {
        drafts?: { id?: string }[];
    };

    if (!Array.isArray(parsed.drafts)) {
        return;
    }

    // only remove ChatGPT's placeholder thread draft; leave real draft
    // entries untouched
    const nextDrafts = parsed.drafts.filter((draft) => draft.id !== "null_thread");

    if (nextDrafts.length === parsed.drafts.length) {
        return;
    }

    const nextValue = {
        ...parsed,
        drafts: nextDrafts
    };

    if (nextDrafts.length === 0) {
        localStorage.removeItem(key);
    } else {
        localStorage.setItem(key, JSON.stringify(nextValue));
    }

    console.log("[chatgpt-companion] null_thread draft cleared");
}

/**
 * Extracts the extension session id from ChatGPT's location hash.
 */
function getCurrentSessionId(): string | null {
    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

    const params = new URLSearchParams(hash);
    const sessionId = params.get("dwc_session");
    if (sessionId) {
        currentExtensionSessionId = sessionId;
    }

    return currentExtensionSessionId;
}

/**
 * Resolves when the ChatGPT document is ready enough for DOM queries.
 */
async function waitForDocumentReady(): Promise<void> {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        return;
    }

    await new Promise<void>((resolve) => {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
}

/**
 * Polls known ChatGPT composer selectors until a visible input is found or the
 * timeout expires.
 */
async function waitForComposer(
    timeoutMs = 15000
): Promise<HTMLElement | HTMLTextAreaElement | null> {
    const selectors = [
        'form [contenteditable="true"][role="textbox"]',
        'form #prompt-textarea[contenteditable="true"]',
        'form #prompt-textarea',
        '[data-testid="composer"] [contenteditable="true"][role="textbox"]',
        '[data-testid="composer"] textarea'
    ];

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        // chatGPT has used multiple composer DOM shapes, so try selectors from
        // most specific/current to broader fallbacks
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el instanceof HTMLElement && isVisible(el)) {
                return el as HTMLElement | HTMLTextAreaElement;
            }
        }

        await sleep(500);
    }

    return null;
}

/**
 * Inserts text into either ChatGPT composer implementation and dispatches the
 * input events React expects.
 */
function insertPrompt(element: HTMLElement | HTMLTextAreaElement, text: string): void {
    element.focus();

    const isClear = text.length === 0;

    if (element instanceof HTMLTextAreaElement) {
        // use the native setter so React observes the value change as if the
        // user typed into the textarea
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
        descriptor?.set?.call(element, text);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }

    replaceContentEditableText(element, text);

    // dispatch the input shape expected by contenteditable composer handlers
    element.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: isClear ? "deleteContentBackward" : "insertText",
            data: isClear ? null : text
        })
    );
}

/**
 * Replaces contenteditable composer contents while preserving line breaks and
 * placing the caret at the end.
 */
function replaceContentEditableText(element: HTMLElement, text: string): void {
    const selection = window.getSelection();
    const range = document.createRange();

    element.replaceChildren();

    if (text.length > 0) {
        const paragraphNodes = parsePromptParagraphs(text);

        if (paragraphNodes.length > 0) {
            element.append(...paragraphNodes);
        } else {
            // contenteditable composers need explicit BR nodes to preserve newlines
            const lines = text.split("\n");
            lines.forEach((line, index) => {
                if (index > 0) {
                    element.append(document.createElement("br"));
                }

                element.append(document.createTextNode(line));
            });
        }
    }

    // move the caret after the inserted text so the composer behaves like a
    // normal paste/type operation
    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/**
 * Parses extension-generated prompt HTML into real composer paragraph nodes.
 */
function parsePromptParagraphs(text: string): HTMLParagraphElement[] {
    const template = document.createElement("template");
    template.innerHTML = text.trim();

    const nodes = Array.from(template.content.childNodes).filter((node) => {
        return node.nodeType !== Node.TEXT_NODE || node.textContent?.trim();
    });

    if (nodes.length === 0 || nodes.some((node) => node.nodeName.toLowerCase() !== "p")) {
        return [];
    }

    return nodes.map((node) => node.cloneNode(true) as HTMLParagraphElement);
}

/**
 * Checks whether an element has a measurable rendered box.
 */
function isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

/**
 * Delays async polling loops.
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
