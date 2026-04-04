let lastAppliedStamp: number | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
    console.log("[discuss-with-chatgpt-ext] bootstrapper loaded", location.href);

    await waitForDocumentReady();
    await tryApplyLatestPrompt();

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes["discussPromptStamp"]) {
            await tryApplyLatestPrompt();
        }

        if (changes["closeDiscussion"]?.newValue === true) {
            await clearChatGPTNullThreadDraft();
        }
    });
}

async function clearChatGPTNullThreadDraft(): Promise<void> {
    const { closeDiscussion } = await chrome.storage.local.get("closeDiscussion");
    if (!closeDiscussion) {
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
    } catch (e) {
        console.warn("[discuss-with-chatgpt-ext] failed to clear null_thread draft", e);
    } finally {
        await chrome.storage.local.set({
            closeDiscussion: false
        });
    }
}

async function tryApplyLatestPrompt(): Promise<void> {
    const data = (await chrome.storage.local.get([
        "discussPrompt",
        "discussPromptStamp",
        "discussConsumed"
    ])) as StorageShape;

    const prompt = data.discussPrompt;
    const stamp = data.discussPromptStamp;
    const consumed = data.discussConsumed;

    if (!prompt || !stamp || consumed) {
        return;
    }

    if (lastAppliedStamp === stamp) {
        return;
    }

    const input = await waitForComposer();
    if (!input) {
        console.warn("[discuss-with-chatgpt-ext] ChatGPT composer not found");
        return;
    }

    insertPrompt(input, prompt);
    lastAppliedStamp = stamp;

    await chrome.storage.local.set({
        discussConsumed: true
    });

    console.log("[discuss-with-chatgpt-ext] prompt inserted");
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
        '[contenteditable="true"][role="textbox"]',
        '#prompt-textarea[contenteditable="true"]',
        '#prompt-textarea',
        'div[contenteditable="true"]',
        "textarea"
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

    if (element instanceof HTMLTextAreaElement) {
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }

    // TODO: test without this tricky insertion
    try {
        const selection = window.getSelection();
        if (!selection) {
            throw new Error("No selection available");
        }

        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);

        document.execCommand("delete", false);
        document.execCommand("insertText", false, text);
    } catch {
        element.textContent = text;
    }

    element.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: text
        })
    );
}

function isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}