#!/usr/bin/env python3
"""Exercise v2 history with native Thunderbird crypto in a disposable profile.
Uses security-smoke.py's launch/cleanup and result transport. This tests the live
storage implementation, not sidebar clicks or an actual model provider request.
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('security_smoke', Path(__file__).with_name('security-smoke.py'))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
harness.RUNNER = r'''
import { ChatHistoryStore, chatHistoryOperation } from './js/mzta-chathistory.js';
import { historyDestinationKey, providerDestination } from './api_webchat/historyIdentity.js';
const result = {};
try {
  await fetch('http://127.0.0.1:18768/canary');
  const thread = 'a'.repeat(64);
  const destination = providerDestination('openai_comp', {openai_comp_host:'http://127.0.0.1:18768/v1/'});
  const key = await historyDestinationKey(thread, destination);
  const other = await historyDestinationKey(thread, providerDestination('openai_comp', {openai_comp_host:'http://127.0.0.1:18769/v1'}));
  result.endpointIsolation = key !== other && key === await historyDestinationKey(thread, providerDestination('openai_comp', {openai_comp_host:'http://127.0.0.1:18768/v1'}));
  const context = 'SYNTHETIC PRIVATE EMAIL CONTEXT æøå '.repeat(5000);
  const initial = await chatHistoryOperation(key, 'load');
  const saved = await chatHistoryOperation(key, 'save', {...initial, patch:{context, integration:'openai_comp', provenance:destination,
    turns:[{index:0,value:{role:'user',text:'Synthetic question'}},{index:1,value:{role:'assistant',text:'Synthetic answer',incomplete:false}}],
    history:[{index:0,value:{role:'user',content:context+'\nSynthetic question'}},{index:1,value:{role:'assistant',content:'Synthetic answer'}}]}});
  const raw = await browser.storage.local.get(null);
  const id = raw.email_chat_keystore_id;
  const freshStore = () => new ChatHistoryStore(browser.storage.local,
    text => browser.chatPanel.encryptChatHistory(id,text),
    text => browser.chatPanel.decryptChatHistory(id,text));
  const restored = await freshStore().operation(key,'load');
  result.nativeCryptoRoundTrip = restored.value.context === context && restored.value.history[0].content === context+'\nSynthetic question' && restored.value.turns[1].text === 'Synthetic answer';
  result.largeContextStored = context.length > 100000 && restored.value.context.length === context.length;
  const records = Object.fromEntries(Object.entries(raw).filter(([k])=>k.startsWith('email_chat_')));
  result.noPlaintextRecords = !JSON.stringify(records).includes('SYNTHETIC PRIVATE') && !JSON.stringify(records).includes('Synthetic question');
  result.encryptedV2 = raw['email_chat_v2_'+key].encryption === 'oskeystore-v2' && raw['email_chat_v2_'+key].blocks.length > 0;
  result.otherDestinationEmpty = (await freshStore().operation(other,'load')).value.turns.length === 0;
  await chatHistoryOperation(key,'delete');
  result.deleted = (await freshStore().operation(key,'load')).value.turns.length === 0;
  try { await chatHistoryOperation(key,'save',{...saved,patch:{context:'stale'}}); result.staleWriteRejected = false; }
  catch(error) { result.staleWriteRejected = error.message.includes('CHAT_HISTORY_STALE'); }
  await browser.storage.local.set({chat_history_retention_days:0});
  const disabled = await chatHistoryOperation(other,'load');
  try { await chatHistoryOperation(other,'save',{...disabled,patch:{context:'disabled'}}); result.disabledSaveRejected = false; }
  catch(error) { result.disabledSaveRejected = error.message.includes('CHAT_HISTORY_DISABLED'); }
  await chatHistoryOperation(null,'deleteAll');
  const after = await browser.storage.local.get(null);
  result.clearAllRemovedRecords = !Object.keys(after).some(k=>k.startsWith('email_chat_'));
} catch(error) { result.error = error.name+': '+error.message; }
await browser.storage.local.set({security_test_result:result});
'''
if __name__ == '__main__':
    harness.main()
