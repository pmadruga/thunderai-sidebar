import { providerConfig } from '../js/api/provider-config.js';
import { OpenAI } from '../js/api/openai_responses.js';
import { GoogleGemini } from '../js/api/google_gemini.js';
import { Ollama } from '../js/api/ollama.js';
import { OpenAIComp } from '../js/api/openai_comp.js';
import { Anthropic } from '../js/api/anthropic.js';

const clients = { chatgpt: OpenAI, google_gemini: GoogleGemini, ollama: Ollama,
    openai_comp: OpenAIComp, anthropic: Anthropic };

// Use the effective chat settings, including any per-prompt host/key override.
export async function fetchChatModels(integration, prefs) {
    const config = providerConfig(integration, prefs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const data = await new clients[integration](config).fetchModels(controller.signal);
        if (!data.ok) throw new Error('Model list unavailable');
        const models = integration === 'ollama' ? data.response.models : data.response;
        if (!Array.isArray(models)) throw new Error('Invalid model list');
        const unique = new Map();
        for (const model of models) {
            // Gemini also lists embeddings and other models that cannot chat.
            if (integration === 'google_gemini' &&
                !model.supportedGenerationMethods?.includes('generateContent')) continue;
            const id = integration === 'google_gemini' ? model.name?.split('/').pop()
                : integration === 'ollama' ? model.name : model.id;
            if (typeof id !== 'string' || !id) continue;
            unique.set(id, { id, label: model.display_name || model.displayName || id });
        }
        return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
    } finally {
        clearTimeout(timer);
    }
}
