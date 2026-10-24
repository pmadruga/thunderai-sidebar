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
    parser.add_argument('--screenshots', type=Path, help='Save README screenshots using synthetic demo mail')
    args = parser.parse_args()
    question = 'What are the next steps for the website launch?' if args.screenshots else 'Synthetic private question æøå'
    answer = ('Here are the next steps from the email:\n\n'
              '1. **Maya:** approve the homepage copy by Tuesday.\n'
              '2. **Alex:** check the mobile layout and contact form.\n'
              '3. **Team:** confirm the Thursday launch in Wednesday’s review.\n\n'
              '**Still open:** choose who will monitor the contact inbox after launch.') if args.screenshots else 'Synthetic sidebar response.'
    continuation = 'Draft a short reply confirming that I will test the mobile layout.' if args.screenshots else 'Synthetic continuation'
    followup = ('Hi Maya,\n\nI’ll test the mobile layout and contact form before Wednesday’s review. '
                'I’ll share any issues in time for the Thursday launch.\n\nBest,\nAlex') if args.screenshots else answer

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
            data = {'default_generation_settings':{'n_ctx':131072}} if self.path == '/props' else {'data':[{'id':'demo-local-model','context_length':131072}]}
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            chunks = [{'choices':[{'delta':{'content':answer if len(requests) == 1 else followup},'finish_reason':None}]}, {'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':1200 if args.screenshots else 30000,'completion_tokens':90,'total_tokens':1290 if args.screenshots else 30090}}]
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
            client.set_window_rect(width=1500, height=1000)
            setup_script = (Path(__file__).parent / 'fixtures' / 'sidebar-setup.js').read_text()
            setup=client.execute_async_script(setup_script,script_args=[str(local_xpi),EXTENSION_ID,f'http://127.0.0.1:{args.http_port}',bool(args.screenshots)])
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
            send(question)
            wait(lambda:answer.split('\n')[0] in content(),'first streaming response')
            wait(lambda:len(requests)==1,'first model request')
            if not args.screenshots:
                assert len(requests[0]['messages'][0]['content'])>100000, 'email context missing or truncated'
            else:
                assert 'approve the homepage copy by Tuesday' in requests[0]['messages'][0]['content']
            time.sleep(2)
            def screenshot(name, panel_only=False):
                if not args.screenshots: return
                time.sleep(4)
                args.screenshots.mkdir(parents=True, exist_ok=True)
                element = client.find_element('css selector', '#thunderai-chat-panel') if panel_only else None
                (args.screenshots / name).write_bytes(client.screenshot(element=element, format='binary'))
            screenshot('email-chat.png')
            records=js("return window.wrappedJSObject.browser.storage.local.get(null).then(d=>Object.fromEntries(Object.entries(d).filter(([k])=>k.startsWith('email_chat_'))));")
            assert any(v.get('encryption')=='oskeystore-v2' for v in records.values() if isinstance(v,dict)), 'encrypted v2 root absent'
            assert question not in json.dumps(records) and 'Synthetic mail context' not in json.dumps(records), 'plaintext history persisted'
            js('window.location.reload();return true;'); time.sleep(1); open_chat()
            wait(lambda:question in content() and answer.split('\n')[0] in content(),'restored transcript')
            assert len(requests)==1, 'restoration sent an unexpected provider request'
            send(continuation)
            wait(lambda:len(requests)==2,'continued model request')
            assert any(m.get('role')=='assistant' and m.get('content')==answer for m in requests[1]['messages']), 'restored provider history missing'
            wait(lambda:followup.split('\n')[0] in content() and (args.screenshots or content().count(answer)>=2),'continued response')
            time.sleep(.5)
            screenshot('draft-reply.png', panel_only=True)
            # Exercise the clear button handler, accepting its confirmation in this test page.
            js("window.wrappedJSObject.confirm=()=>true;document.querySelector('#clearEmailChat').click();return true;")
            wait(lambda:question not in content(),'clear chat UI')
            js('window.location.reload();return true;'); time.sleep(1); open_chat()
            assert question not in content(), 'deleted conversation restored'
            print(json.dumps({'sidebarBoot':True,'longContextSent':len(requests[0]['messages'][0]['content'])>100000,'streamRendered':True,'nativeEncryptedStorage':True,'restoredAfterReload':True,'continuedProviderHistory':True,'deletedAfterReopen':True,'providerRequests':len(requests)},sort_keys=True))
        finally:
            if client:
                try: client.execute_script('Services.startup.quit(Ci.nsIAppStartup.eForceQuit);')
                except Exception: pass
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close();server.shutdown()

if __name__=='__main__': main()
