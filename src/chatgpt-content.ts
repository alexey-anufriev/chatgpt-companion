let lastAppliedStamp: number | null = null;
let isStorageListenerAttached = false;

void bootstrap();

async function bootstrap(): Promise<void> {
    console.log("[discuss-with-chatgpt-ext] bootstrapper loaded", location.href);

    await waitForDocumentReady();

    attachStorageListenerOnce();

    await clearChatGPTNullThreadDraft();
    await tryApplyLatestPrompt();
}

function attachStorageListenerOnce(): void {
    if (isStorageListenerAttached) {
        return;
    }

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
    });

    isStorageListenerAttached = true;
}

async function tryApplyLatestPrompt(): Promise<void> {
    const currentSessionId = getCurrentSessionId();
    if (!currentSessionId) {
        return;
    }

    const data = (await chrome.storage.local.get("discussions")) as StorageShape;
    const discussion = data.discussions?.[currentSessionId];

    if (!discussion || !discussion.stamp || discussion.consumed) {
        return;
    }

    if (lastAppliedStamp === discussion.stamp) {
        return;
    }

    const input = await waitForComposer();
    if (!input) {
        console.warn("[discuss-with-chatgpt-ext] ChatGPT composer not found");
        return;
    }

    insertPrompt(input, discussion.prompt);
    lastAppliedStamp = discussion.stamp;

    const nextDiscussions = { ...(data.discussions ?? {}) };
    nextDiscussions[currentSessionId] = {
        ...discussion,
        consumed: true
    };

    await chrome.storage.local.set({
        discussions: nextDiscussions
    });

    if (discussion.prompt) {
        console.log("[discuss-with-chatgpt-ext] prompt inserted", { currentSessionId });
    } else {
        console.log("[discuss-with-chatgpt-ext] composer cleared", { currentSessionId });
    }
}

async function clearChatGPTNullThreadDraft(): Promise<void> {
    const { closeDiscussionSessionId } = (await chrome.storage.local.get(
        "closeDiscussionSessionId"
    )) as StorageShape;
    const currentSessionId = getCurrentSessionId();

    if (!closeDiscussionSessionId || !currentSessionId || closeDiscussionSessionId !== currentSessionId) {
        return;
    }

    const key = "oai/apps/conversationDrafts";

    try {
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

        console.log("[discuss-with-chatgpt-ext] null_thread draft cleared");
    } catch (error) {
        console.warn("[discuss-with-chatgpt-ext] failed to clear null_thread draft", error);
    } finally {
        const latest = (await chrome.storage.local.get("closeDiscussionSessionId")) as StorageShape;
        if (latest.closeDiscussionSessionId === currentSessionId) {
            await chrome.storage.local.set({
                closeDiscussionSessionId: undefined
            });
        }
    }
}

function getCurrentSessionId(): string | null {
    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

    const params = new URLSearchParams(hash);
    return params.get("dwc_session");
}

async function waitForDocumentReady(): Promise<void> {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        return;
    }

    await new Promise<void>((resolve) => {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
}

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

function insertPrompt(element: HTMLElement | HTMLTextAreaElement, text: string): void {
    element.focus();

    const isClear = text.length === 0;

    if (element instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
        descriptor?.set?.call(element, text);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }

    replaceContentEditableText(element, text);

    element.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: isClear ? "deleteContentBackward" : "insertText",
            data: isClear ? null : text
        })
    );
}

function replaceContentEditableText(element: HTMLElement, text: string): void {
    const selection = window.getSelection();
    const range = document.createRange();

    element.replaceChildren();

    if (text.length > 0) {
        const lines = text.split("\n");
        lines.forEach((line, index) => {
            if (index > 0) {
                element.append(document.createElement("br"));
            }

            element.append(document.createTextNode(line));
        });
    }

    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
