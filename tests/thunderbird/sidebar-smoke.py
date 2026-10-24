#!/usr/bin/env python3
"""Live sidebar send/restore/delete smoke using synthetic mail and local SSE.
Requires marionette_driver and Thunderbird. Creates and removes its own profile.
Only synthetic requests are retained in memory; no personal profile is accessed.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EXTENSION_ID = 'thunderai-sidebar@pedromadruga.com'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', default='thunderbird')
    parser.add_argument('--flatpak', action='store_true')
    parser.add_argument('--xpi', type=Path, required=True)
    parser.add_argument('--port', type=int, default=2836)
    parser.add_argument('--http-port', type=int, default=18770)
    args = parser.parse_args()
    from marionette_driver.marionette import Marionette
    requests = []
    class Mock(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Access-Control-Allow-Headers','*')
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            super().end_headers()
        def do_OPTIONS(self):
            self.send_response(204); self.end_headers()
        def do_GET(self):
            data = {'default_generation_settings':{'n_ctx':131072}} if self.path == '/props' else {'data':[{'id':'synthetic-context-test','context_length':131072}]}
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            chunks = [{'choices':[{'delta':{'content':'Synthetic sidebar response.'},'finish_reason':None}]}, {'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':30000,'completion_tokens':6,'total_tokens':30006}}]
            for chunk in chunks: self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode()); self.wfile.flush()
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
    server = ThreadingHTTPServer(('127.0.0.1',args.http_port),Mock)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='ta-sidebar-live-') as temp:
        root = Path(temp); profile=root/'profile'; profile.mkdir()
        (profile/'user.js').write_text(f'user_pref("marionette.port", {args.port});\nuser_pref("mail.provider.suppress_dialog_on_startup", true);\nuser_pref("mail.shell.checkDefaultClient", false);\n')
        local_xpi=root/'test.xpi'; local_xpi.write_bytes(args.xpi.read_bytes())
        log=(root/'thunderbird.log').open('w')
        launcher=['flatpak','run','--filesystem='+str(root),'--command=/app/lib64/thunderbird/thunderbird','net.thunderbird.Thunderbird'] if args.flatpak else [args.binary]
        process=subprocess.Popen(launcher+['--no-remote','--new-instance','--profile',str(profile),'--marionette','--headless','--remote-allow-system-access'],stdout=log,stderr=log)
        client=None
        try:
            client=Marionette(host='127.0.0.1',port=args.port); client.raise_for_port(timeout=45); client.start_session(); client.set_context('chrome'); client.timeout.script=30
            setup=client.execute_async_script(r'''
const done=arguments[arguments.length-1];
(async()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(arguments[0]);await AddonManager.installTemporaryAddon(file);
const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
const e=ExtensionParent.GlobalManager.getExtension(arguments[1]);const v=[...e.views].find(v=>v.viewType==='background');
await ExtensionPermissions.add(e.id,{permissions:[],origins:['http://127.0.0.1/*']});
await v.apiCan.findAPIPath('storage.sync.set')({connection_type:'openai_comp_api',openai_comp_host:arguments[2],openai_comp_model:'synthetic-context-test',openai_comp_use_v1:true,openai_comp_api_key:'',max_prompt_length:1});
const {MailServices}=ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
try {MailServices.accounts.localFoldersServer;} catch(_){MailServices.accounts.createLocalMailAccount();}
const folder=MailServices.accounts.localFoldersServer.rootFolder.getChildNamed('Trash');
const hdr=folder.QueryInterface(Ci.nsIMsgLocalMailFolder).addMessage('From: synthetic@example.invalid\r\nTo: test@example.invalid\r\nSubject: Sidebar synthetic test\r\nMessage-ID: <sidebar-test@example.invalid>\r\nDate: Sat, 24 Oct 2026 12:00:00 +0000\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n'+'Synthetic mail context content. '.repeat(4000)+'\r\n');
const converted=e.messageManager.convert(hdr);const tab=await v.apiCan.findAPIPath('messageDisplay.open')({messageId:converted.id,location:'tab'});
await v.apiCan.findAPIPath('chatPanel.open')(tab.windowId,e.baseURI.spec+'api_webchat/index.html?llm=openai_comp_api&panel=1&call_id=synthetic&prompt_name=Test');
return {tabId:tab.id};
})().then(done,e=>done({error:String(e)}));
''',script_args=[str(local_xpi),EXTENSION_ID,f'http://127.0.0.1:{args.http_port}'])
            assert 'error' not in setup, setup
            wrapper="""const done=arguments[arguments.length-1];const b=Services.wm.getMostRecentWindow('mail:3pane').document.querySelector('#thunderai-chat-panel browser');b.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(arguments[0],[],{sandboxName:'default',newSandbox:true,timeout:20000}).then(done,e=>done({error:String(e)}));"""
            def js(code):
                value=client.execute_async_script(wrapper,script_args=[code])
                if isinstance(value,dict) and 'error' in value: raise AssertionError(value)
                return value
            def wait(check, label):
                for _ in range(150):
                    try:
                        if check(): return
                    except AssertionError as error:
                        if "Actor" not in str(error) and "browsingContext" not in str(error): raise
                    time.sleep(.2)
                raise AssertionError(label)
            def content():
                return js("return document.querySelector('messages-area')?.shadowRoot?.textContent || '';")
            def open_chat():
                wait(lambda:js("return !!document.querySelector('message-input')?.shadowRoot;"),'sidebar boot')
                js("return window.wrappedJSObject.browser.runtime.sendMessage({command:'shortcut_do_prompt',promptId:'prompt_chat_email',tabId:"+str(setup['tabId'])+"});")
                time.sleep(1)
            def send(text):
                js("const s=document.querySelector('message-input').shadowRoot;const f=s.querySelector('#messageInputField');f.value="+json.dumps(text)+";f.dispatchEvent(new Event('input',{bubbles:true}));s.querySelector('#sendButton').click();return true;")
            open_chat()
            send('Synthetic private question æøå')
            wait(lambda:'Synthetic sidebar response.' in content(),'first streaming response')
            wait(lambda:len(requests)==1,'first model request')
            assert len(requests[0]['messages'][0]['content'])>100000, 'email context missing or truncated'
            time.sleep(2)
            records=js("return window.wrappedJSObject.browser.storage.local.get(null).then(d=>Object.fromEntries(Object.entries(d).filter(([k])=>k.startsWith('email_chat_'))));")
            assert any(v.get('encryption')=='oskeystore-v2' for v in records.values() if isinstance(v,dict)), 'encrypted v2 root absent'
            assert 'Synthetic private question' not in json.dumps(records) and 'Synthetic mail context' not in json.dumps(records), 'plaintext history persisted'
            js('window.location.reload();return true;'); time.sleep(1); open_chat()
            wait(lambda:'Synthetic private question æøå' in content() and 'Synthetic sidebar response.' in content(),'restored transcript')
            assert len(requests)==1, 'restoration sent an unexpected provider request'
            send('Synthetic continuation')
            wait(lambda:len(requests)==2,'continued model request')
            assert any(m.get('role')=='assistant' and m.get('content')=='Synthetic sidebar response.' for m in requests[1]['messages']), 'restored provider history missing'
            wait(lambda:content().count('Synthetic sidebar response.')>=2,'continued response')
            # Exercise the clear button handler, accepting its confirmation in this test page.
            js("window.wrappedJSObject.confirm=()=>true;document.querySelector('#clearEmailChat').click();return true;")
            wait(lambda:'Synthetic private question' not in content(),'clear chat UI')
            js('window.location.reload();return true;'); time.sleep(1); open_chat()
            assert 'Synthetic private question' not in content(), 'deleted conversation restored'
            print(json.dumps({'sidebarBoot':True,'longContextSent':True,'streamRendered':True,'nativeEncryptedStorage':True,'restoredAfterReload':True,'continuedProviderHistory':True,'deletedAfterReopen':True,'providerRequests':len(requests)},sort_keys=True))
        finally:
            if client:
                try: client.execute_script('Services.startup.quit(Ci.nsIAppStartup.eForceQuit);')
                except Exception: pass
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close();server.shutdown()

if __name__=='__main__': main()
