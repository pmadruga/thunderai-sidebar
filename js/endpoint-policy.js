// HTTP is allowed only on loopback unless the user acknowledged this exact
// origin. Never send credentials through URL userinfo or follow redirects.
export const HTTP_ACKNOWLEDGEMENTS = 'acknowledged_http_origins';
let workerOrigins = null;
export function configureEndpointPolicy(origins = []) {
    workerOrigins = (Array.isArray(origins) ? origins : []).filter(origin => {
        try {
            const url = new URL(origin);
            return url.protocol === 'http:' && !url.username && !url.password && url.origin === origin;
        } catch (_) { return false; }
    });
}
export function isLoopbackHostname(hostname) {
    return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}
export function validateEndpoint(value, { allowedHttpOrigins = [] } = {}) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('Enter a valid API URL.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API URLs must use HTTP or HTTPS.');
    if (url.username || url.password) throw new Error('Do not put credentials in the API URL.');
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && !allowedHttpOrigins.includes(url.origin)) {
        throw new Error('Remote HTTP would expose messages and credentials. Use HTTPS or explicitly acknowledge this origin in connection settings.');
    }
    return url;
}
export async function acknowledgedHttpOrigins() {
    if (workerOrigins !== null) return workerOrigins;
    if (typeof browser === 'undefined') return [];
    return (await browser.storage.local.get({ [HTTP_ACKNOWLEDGEMENTS]: [] }))[HTTP_ACKNOWLEDGEMENTS];
}
export async function secureFetch(url, options = {}) {
    validateEndpoint(url, { allowedHttpOrigins: await acknowledgedHttpOrigins() });
    return fetch(url, { ...options, redirect: 'error' });
}
export async function confirmEndpointAccess(value) {
    const origins = await acknowledgedHttpOrigins();
    try { validateEndpoint(value, { allowedHttpOrigins: origins }); return true; }
    catch (error) {
        let url;
        try { url = new URL(value); } catch (_) { throw error; }
        if (url.protocol !== 'http:' || url.username || url.password || isLoopbackHostname(url.hostname)) throw error;
        const message = browser.i18n.getMessage('insecure_http_confirm', [url.origin]) ||
            `Allow unencrypted HTTP to ${url.origin}? Messages and credentials can be read or changed on this network. Use HTTPS whenever possible.`;
        if (!window.confirm(message)) return false;
        await browser.storage.local.set({ [HTTP_ACKNOWLEDGEMENTS]: [...new Set([...origins, url.origin])] });
        return true;
    }
}
