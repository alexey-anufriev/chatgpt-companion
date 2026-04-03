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
    });
}

async function tryApplyLatestPrompt(): Promise<void> {
    const data = (await chrome.storage.local.get([
        "discussPrompt",
        "discussPromptStamp"
    ])) as StorageShape;

    const prompt = data.discussPrompt;
    const stamp = data.discussPromptStamp;

    if (!prompt || !stamp) {
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