#!/usr/bin/env python3
"""Optional live Thunderbird test using marionette_driver and a throwaway profile.
Build the development XPI first. Run with --binary /path/to/thunderbird --xpi ...
Never point this harness at an existing profile. It creates its own temporary one.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import ZipFile

EXTENSION_ID = 'thunderai-sidebar@pedromadruga.com'
RUNNER = r'''
import { sanitizeBlockHtml } from './js/mzta-richtext.js';
import { getSecureSettings, secureLocalRecords } from './js/secure-settings.js';
const result = {};
try {
  const base = 'http://127.0.0.1:18768';
  await fetch(base + '/canary');
  const payloads = [
    `<img src="${base}/img" srcset="${base}/srcset 2x" onerror="window.__unsafe=1">`,
    `<iframe src="${base}/frame"></iframe><object data="${base}/object"></object>`,
    `<style>@import url('${base}/css'); div { background:url('${base}/style') }</style><div style="background:url('${base}/inline')">Text</div>`,
    `<svg><image href="${base}/svg"/><foreignObject><img src="${base}/foreign"></foreignObject></svg>`,
    `<table><tr><td><img src=${base}/malformed></table><a href="javascript:window.__unsafe=1" onclick="window.__unsafe=1">Link</a><script>window.__unsafe=1</script>`
  ];
  let safe = true;
  for (const payload of payloads) {
    const host = document.createElement('div');
    host.innerHTML = sanitizeBlockHtml(payload);
    document.body.append(host);
    safe &&= !host.querySelector('img,iframe,svg,object,script,style');
    for (const node of host.querySelectorAll('*')) for (const attr of node.attributes) {
      safe &&= !/^on|^(src|srcset|style)$/i.test(attr.name);
      if (attr.name === 'href') safe &&= /^(https?:|mailto:)/i.test(attr.value);
    }
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  result.sanitizedDom = safe && !window.__unsafe;
  await browser.storage.sync.set({ openai_comp_api_key: 'synthetic-live-key' });
  await browser.storage.local.set({ 'msg:synthetic-security': { summary: {summary:'synthetic-private-summary'}, translation:{translated_text:'synthetic-translation'}, spam:{explanation:'synthetic-explanation'} } });
  await browser.runtime.sendMessage({command:'secure_settings',operation:'migrate'});
  await browser.runtime.sendMessage({command:'secure_local_data',operation:'migrate'});
  const sync = await browser.storage.sync.get('openai_comp_api_key');
  const stored = await browser.storage.local.get(['secure_credentials_v1','msg:synthetic-security']);
  result.noLegacyKey = !Object.hasOwn(sync,'openai_comp_api_key');
  result.encryptedEnvelopes = stored.secure_credentials_v1?.version === 1 && stored['msg:synthetic-security']?.secureCacheVersion === 1;
  result.noPlaintext = !JSON.stringify(stored).includes('synthetic-live-key') && !JSON.stringify(stored).includes('synthetic-private-summary');
  result.credentialRoundTrip = (await getSecureSettings({openai_comp_api_key:''})).openai_comp_api_key === 'synthetic-live-key';
  result.cacheRoundTrip = (await secureLocalRecords.get('msg:synthetic-security'))['msg:synthetic-security'].translation.translated_text === 'synthetic-translation';
  await secureLocalRecords.remove('msg:synthetic-security');
  await browser.storage.local.remove('secure_credentials_v1');
  await browser.chatPanel.deleteChatHistoryKey(stored.secure_credentials_v1.keyId);
} catch (error) { result.error = error.name + ': ' + error.message; }
await browser.storage.local.set({security_test_result:result});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', default='thunderbird')
    parser.add_argument('--flatpak', action='store_true', help='Use installed net.thunderbird.Thunderbird')
    parser.add_argument('--xpi', type=Path, required=True)
    parser.add_argument('--port', type=int, default=2833)
    args = parser.parse_args()
    from marionette_driver.marionette import Marionette
    requests = []
    class Beacon(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'ok')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 18768), Beacon)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='ta-security-live-') as temp:
        root = Path(temp)
        profile = root / 'profile'
        profile.mkdir()
        (profile / 'user.js').write_text(f'''user_pref("marionette.port", {args.port});
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("extensions.webextensions.remote", true);
''')
        xpi = root / 'security-test.xpi'
        shutil.copyfile(args.xpi, xpi)
        with ZipFile(xpi, 'a') as archive:
            archive.writestr('security-test.html', '<!doctype html><html><body><script type="module" src="security-test.js"></script></body></html>')
            archive.writestr('security-test.js', RUNNER)
        log = (root / 'thunderbird.log').open('w')
        launcher = ['flatpak', 'run', '--filesystem=' + str(root), '--command=/app/lib64/thunderbird/thunderbird', 'net.thunderbird.Thunderbird'] if args.flatpak else [args.binary]
        process = subprocess.Popen(launcher + ['--no-remote', '--new-instance', '--profile', str(profile), '--marionette', '--headless', '--remote-allow-system-access'], stdout=log, stderr=log)
        client = None
        try:
            client = Marionette(host='127.0.0.1',port=args.port)
            client.raise_for_port(timeout=45)
            client.start_session()
            client.set_context('chrome')
            client.timeout.script = 30
            result = client.execute_async_script('''
const done=arguments[arguments.length-1];
(async()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(arguments[0]);
await AddonManager.installTemporaryAddon(file);
const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
const e=ExtensionParent.GlobalManager.getExtension(arguments[1]);
await ExtensionPermissions.add(e.id,{permissions:[],origins:['http://127.0.0.1/*']});
const view=[...e.views].find(v=>v.viewType==='background');
await view.apiCan.findAPIPath('tabs.create')({url:e.baseURI.spec+'security-test.html'});
return true;
})().then(done,e=>done({error:String(e)}));
''',script_args=[str(xpi), EXTENSION_ID])
            assert result is True, result
            for _ in range(100):
                result = client.execute_async_script('''const done=arguments[arguments.length-1];
const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const e=ExtensionParent.GlobalManager.getExtension(arguments[0]);
const view=[...e.views].find(v=>v.viewType==='background');
view.xulBrowser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript("return window.wrappedJSObject.browser.storage.local.get('security_test_result').then(r=>r.security_test_result || null);", [], {sandboxName:'default',newSandbox:true,timeout:20000}).then(done,e=>done({error:String(e)}));''',script_args=[EXTENSION_ID])
                if result is not None:
                    break
                time.sleep(.2)
            assert isinstance(result,dict) and result, 'Runner did not finish'
            result['beaconCanary'] = '/canary' in requests
            result['zeroSanitizerRequests'] = not [path for path in requests if path != '/canary']
            print(json.dumps(result,sort_keys=True))
            assert all(value is True for value in result.values()), 'Security smoke test failed'
        finally:
            if client:
                try: client.execute_script('Services.startup.quit(Ci.nsIAppStartup.eForceQuit);')
                except Exception: pass
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()
            server.shutdown()

if __name__ == '__main__':
    main()
