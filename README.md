# ChatGPT Companion

Discuss the current page with ChatGPT from a Chrome side panel.

Example: open any webpage, choose a prompt template from the context menu, and ChatGPT Companion inserts a structured prompt with the page title, URL, selected text, and your preferred response language.

---

## Features

- Discuss any webpage without leaving the tab: ChatGPT opens directly in the Chrome side panel
- Send the full page context, a selected excerpt, or a clicked link into a structured ChatGPT prompt
- Use ready-made prompts for page analysis and short summaries, or rewrite them for your own workflow
- Choose whether prompts should wait for review or be submitted automatically
- Start normal chats when you want history, or temporary chats when you want a quick session
- Reopen previous page discussions along with related ChatGPT conversation links
- Trigger your favorite prompt templates quickly with the keyboard shortcut
- Sync preferred language, sending mode, chat mode, and prompt templates across other devices
- Keep it lightweight: no runtime dependencies, just a focused browser extension

---

## Installation

### From source

1. Clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Open Chrome `->` `chrome://extensions`
5. Enable Developer mode
6. Click "Load unpacked"
7. Select the `dist` folder

---

## How it works

- Adds context menu actions for pages, selections, and links
- Builds a prompt from the selected template and page metadata
- Stores each discussion in extension local storage
- Opens a tab-scoped side panel with ChatGPT embedded
- Uses a ChatGPT content script to insert the generated prompt into the composer
- Saves created ChatGPT conversation URLs so discussions can be reopened later

---

## Settings

- `Preferred language`: used by templates that include `{preferred_language}` macro
- `Sending mode`: choose whether prompts stay in the composer or submit automatically
- `Preferred chat mode`: choose normal or temporary ChatGPT conversations
- `Prompt Templates`: edit built-in prompts, hide default prompts, or add custom prompts
- `Cloud Sync`: optionally sync settings and prompt templates through Chrome sync
- `Persisted Sessions`: view, reopen, or delete saved discussion sessions
- `Prompt picker shortcut`: configure the keyboard shortcut at `chrome://extensions/shortcuts`

---

## Template macros

- `{page_title}`: current page or clicked link title
- `{page_url}`: current page or clicked link URL
- `{selected_text}`: selected page text, capped before insertion
- `{preferred_language}`: language configured in settings
- `{current_date}`: current local date
- `{current_time}`: current local time
- `{if macro_name}...{/if}`: includes a block only when the macro has a value

---

## License

MIT

---

## Support

Enjoying this extension?

<a href="https://www.buymeacoffee.com/alexey.anufriev" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
