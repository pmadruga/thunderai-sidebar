// Translate stored provider preferences into the API clients' constructor keys.
export function providerConfig(provider, preferences) {
    const prefix = `${provider}_`;
    const config = {};
    for (const [key, value] of Object.entries(preferences)) {
        if (!key.startsWith(prefix) || key.startsWith('chatgpt_web_')) continue;
        const name = key.slice(prefix.length);
        config[name === 'api_key' ? 'apiKey' : name] = value;
    }
    return config;
}
