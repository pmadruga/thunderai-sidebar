const done=arguments[arguments.length-1];
(async()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(arguments[0]);await AddonManager.installTemporaryAddon(file);
const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
const e=ExtensionParent.GlobalManager.getExtension(arguments[1]);const v=[...e.views].find(v=>v.viewType==='background');
await ExtensionPermissions.add(e.id,{permissions:[],origins:['http://127.0.0.1/*']});
await v.apiCan.findAPIPath('storage.sync.set')({connection_type:'openai_comp_api',openai_comp_host:arguments[2],openai_comp_model:'demo-local-model',openai_comp_chat_name:'Local demo',openai_comp_use_v1:true,openai_comp_api_key:'',max_prompt_length:1});
const {MailServices}=ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
try {MailServices.accounts.localFoldersServer;} catch(_){MailServices.accounts.createLocalMailAccount();}
const folder=MailServices.accounts.localFoldersServer.rootFolder.getChildNamed('Trash');
const demo = arguments[3];
const hdr=folder.QueryInterface(Ci.nsIMsgLocalMailFolder).addMessage((demo ? 'From: Maya Chen <maya@example.invalid>\r\nTo: Alex Morgan <alex@example.invalid>\r\nSubject: Website launch: next steps\r\n' : 'From: synthetic@example.invalid\r\nTo: test@example.invalid\r\nSubject: Sidebar synthetic test\r\n') + 'Message-ID: <sidebar-test@example.invalid>\r\nDate: Sat, 24 Oct 2026 12:00:00 +0000\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n'+(demo ? 'Hi Alex,\r\n\r\nWe are aiming to launch the website on Thursday. I will approve the homepage copy by Tuesday. Could you check the mobile layout and contact form before our Wednesday review?\r\n\r\nWe still need someone to monitor the contact inbox after launch. Let us decide that in the review.\r\n\r\nThanks,\r\nMaya\r\n' : 'Synthetic mail context content. '.repeat(4000))+'\r\n');
const converted=e.messageManager.convert(hdr);const tab=await v.apiCan.findAPIPath('messageDisplay.open')({messageId:converted.id,location:'tab'});
await v.apiCan.findAPIPath('chatPanel.open')(tab.windowId,e.baseURI.spec+'api_webchat/index.html?llm=openai_comp_api&panel=1&call_id=synthetic&prompt_name=Test');
return {tabId:tab.id};
})().then(done,e=>done({error:String(e)}));
