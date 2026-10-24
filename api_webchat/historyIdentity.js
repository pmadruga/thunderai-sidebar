const DEFAULT_ENDPOINTS = {
    chatgpt: 'https://api.openai.com', google_gemini: 'https://generativelanguage.googleapis.com',
    anthropic: 'https://api.anthropic.com',
};
export function providerDestination(integration, prefs) {
    const raw = prefs[`${integration}_host`] || DEFAULT_ENDPOINTS[integration];
    let endpoint = 'unconfigured';
    try {
        const url = new URL(raw);
        if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) {
            endpoint = url.origin + url.pathname.replace(/\/+$/, '');
        }
    } catch (_) { /* Configuration errors are reported by the provider UI. */ }
    return { integration, endpoint };
}
export async function historyDestinationKey(threadKey, destination) {
    const text = JSON.stringify([threadKey, destination.integration, destination.endpoint]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
