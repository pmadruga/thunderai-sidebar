import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../options/mzta-options.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function initializeChatHistorySettings()'), source.indexOf("document.addEventListener('DOMContentLoaded'"));
async function setup(confirm = true) {
  const values = { chat_history_retention_days: 90, chat_history_max_mb: 50 };
  const calls = [];
  const elements = Object.fromEntries(['chat_history_retention_days', 'chat_history_max_mb', 'btnClearAllChats', 'chat_history_settings_status'].map(id => [id, {
    id, value: '', disabled: false, handlers: {}, checkValidity: () => true, reportValidity() {},
    get valueAsNumber() { return Number(this.value); }, addEventListener(type, handler) { this.handlers[type] = handler; },
  }]));
  const context = vm.createContext({ HISTORY_DEFAULTS: values, document: {getElementById: id => elements[id]}, window: {confirm: () => confirm}, browser: {
    i18n: {getMessage: key => key}, storage: {local: {get: async () => ({...values}), set: async data => {calls.push(['local', {...data}]);Object.assign(values,data);}}},
    runtime: {sendMessage: async message => calls.push(['message',message])},
  }});
  await vm.runInContext(helper + '\ninitializeChatHistorySettings()',context);
  return {values,calls,elements};
}
test('retention edits persist locally and immediately prune with no conversation key', async () => {
  const {calls,elements} = await setup();
  elements.chat_history_retention_days.value = '30';
  await elements.chat_history_retention_days.handlers.change({target:elements.chat_history_retention_days});
  assert.equal(calls[0][0], 'local');
  assert.equal(calls[0][1].chat_history_retention_days, 30);
  assert.equal(calls[1][1].operation, 'prune');
  assert.equal(calls[1][1].key, undefined);
});
test('zero retention confirms and deletes all; declining changes nothing', async () => {
  for (const confirm of [true,false]) {
    const {calls,elements} = await setup(confirm);
    elements.chat_history_retention_days.value = '0';
    await elements.chat_history_retention_days.handlers.change({target:elements.chat_history_retention_days});
    if (confirm) assert.equal(calls[1][1].operation,'deleteAll');
    else {assert.equal(calls.length,0);assert.equal(elements.chat_history_retention_days.value,90);}
  }
});
test('clear-all does not turn off future saving or mutate retention preferences', async () => {
  const {calls,elements} = await setup();
  await elements.btnClearAllChats.handlers.click({target:elements.btnClearAllChats});
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].operation,'deleteAll');
  assert.equal(elements.chat_history_settings_status.textContent,'chat_history_all_cleared');
});
