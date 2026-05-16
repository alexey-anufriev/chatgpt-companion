{
    type PromptPickerTemplate = {
        id: string;
        name: string;
    };

    type PromptPickerMessage = {
        type: "show-prompt-picker";
        promptTemplates: PromptPickerTemplate[];
    };

    type RuntimePromptPickerSelectedMessage = {
        type: "prompt-picker-selected";
        requestedPromptTemplateId: string;
        selectionText: string;
    };

    const promptPickerWindow = window as Window & {
        __chatgptCompanionPromptPickerAttached?: boolean;
    };

    if (!promptPickerWindow.__chatgptCompanionPromptPickerAttached) {
        promptPickerWindow.__chatgptCompanionPromptPickerAttached = true;

        chrome.runtime.onMessage.addListener((message: Partial<PromptPickerMessage> | undefined) => {
            if (message?.type !== "show-prompt-picker" || !Array.isArray(message.promptTemplates)) {
                return false;
            }

            void showPromptPickerOverlay(message.promptTemplates).catch((error) => {
                console.error("[chatgpt-companion] prompt picker render failed", error);
            });
            return false;
        });
    }

    async function showPromptPickerOverlay(promptTemplates: PromptPickerTemplate[]): Promise<void> {
        const hostId = "chatgpt-companion-prompt-picker";
        const existingHost = document.getElementById(hostId);
        if (existingHost) {
            existingHost.remove();
            return;
        }

        const selectedText = window.getSelection()?.toString() ?? "";
        const host = document.createElement("div");
        host.id = hostId;
        const root = host.attachShadow({ mode: "closed" });
        let selectedIndex = 0;

        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = chrome.runtime.getURL("prompt-picker/index.css");

        const template = document.createElement("template");
        const markupResponse = await fetch(chrome.runtime.getURL("prompt-picker/index.html"));
        template.innerHTML = await markupResponse.text();
        const content = template.content.cloneNode(true) as DocumentFragment;
        const backdrop = content.querySelector<HTMLDivElement>(".backdrop");
        const panel = content.querySelector<HTMLDivElement>(".panel");
        const list = content.querySelector<HTMLDivElement>(".list");

        if (!backdrop || !panel || !list) {
            throw new Error("Prompt picker template is invalid");
        }

        const buttons = promptTemplates.map((promptTemplate, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = promptTemplate.name || "Prompt";
            button.addEventListener("mouseenter", () => {
                setSelectedIndex(index);
            });
            button.addEventListener("click", () => {
                choosePromptTemplate(promptTemplate.id);
            });
            list.append(button);
            return button;
        });

        function close(): void {
            document.removeEventListener("keydown", handleKeydown, true);
            host.remove();
        }

        function setSelectedIndex(nextIndex: number): void {
            selectedIndex = Math.max(0, Math.min(buttons.length - 1, nextIndex));
            buttons.forEach((button, index) => {
                button.classList.toggle("active", index === selectedIndex);
            });
            buttons[selectedIndex]?.scrollIntoView({ block: "nearest" });
        }

        function choosePromptTemplate(promptTemplateId: string): void {
            const message: RuntimePromptPickerSelectedMessage = {
                type: "prompt-picker-selected",
                requestedPromptTemplateId: promptTemplateId,
                selectionText: selectedText
            };

            void chrome.runtime.sendMessage(message).finally(close);
        }

        function handleKeydown(event: KeyboardEvent): void {
            if (event.key === "Escape") {
                event.preventDefault();
                close();
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex(selectedIndex + 1);
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex(selectedIndex - 1);
                return;
            }

            if (event.key === "Enter" && promptTemplates[selectedIndex]) {
                event.preventDefault();
                choosePromptTemplate(promptTemplates[selectedIndex].id);
            }
        }

        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop) {
                close();
            }
        });

        root.append(stylesheet, content);
        document.documentElement.append(host);
        document.addEventListener("keydown", handleKeydown, true);
        setSelectedIndex(0);
        panel.focus();
    }
}
