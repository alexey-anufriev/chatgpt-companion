import type {
    PromptTemplate
} from "./settings.js";

export const PAGE_ANALYSIS_PROMPT_TEMPLATE = [
    "Hi, I’d like to discuss the following content.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Selected excerpt:",
    "{selected_text}",
    "{/if}",
    "",
    "Please:",
    "- Provide a concise summary",
    "- Identify the main idea",
    "- Highlight what is actually important",
    "- Point out weak or questionable parts",
    "- Is it worth spending the time to get familiar with the full content?",
    "Use the language of the original material for your response."
].join("\n");

export const PAGE_ANALYSIS_TRANSLATED_PROMPT_TEMPLATE = [
    "Hi, I’d like to discuss the following content.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Selected excerpt:",
    "{selected_text}",
    "{/if}",
    "",
    "Please:",
    "- Provide a concise summary",
    "- Identify the main idea",
    "- Highlight what is actually important",
    "- Point out weak or questionable parts",
    "- Is it worth spending the time to get familiar with the full content?",
    "Use {preferred_language} for your response."
].join("\n");

export const SHORT_SUMMARY_PROMPT_TEMPLATE = [
    "Compact the following material into a short summary.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Material:",
    "{selected_text}",
    "{/if}",
    "",
    "Do not analyze or critique it.",
    "Advice: is it worth spending the time to get familiar with the full content?",
    "Use the language of the original material for your response."
].join("\n");

export const SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE = [
    "Compact the following material into a short summary.",
    "Title: {page_title}",
    "URL: {page_url}",
    "",
    "{if selected_text}",
    "Material:",
    "{selected_text}",
    "{/if}",
    "",
    "Do not analyze or critique it.",
    "Advice: is it worth spending the time to get familiar with the full content?",
    "Use {preferred_language} for your response."
].join("\n");

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
    {
        id: "page-analysis",
        name: "Page Analysis",
        template: PAGE_ANALYSIS_PROMPT_TEMPLATE
    },
    {
        id: "page-analysis-translated",
        name: "Page Analysis translated",
        template: PAGE_ANALYSIS_TRANSLATED_PROMPT_TEMPLATE
    },
    {
        id: "short-summary",
        name: "Short summary",
        template: SHORT_SUMMARY_PROMPT_TEMPLATE
    },
    {
        id: "short-summary-translated",
        name: "Short summary translated",
        template: SHORT_SUMMARY_TRANSLATED_PROMPT_TEMPLATE
    }
];

export function getDefaultPromptTemplates(): PromptTemplate[] {
    return DEFAULT_PROMPT_TEMPLATES.map((promptTemplate) => ({ ...promptTemplate }));
}
