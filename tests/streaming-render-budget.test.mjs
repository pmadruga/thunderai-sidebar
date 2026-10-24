import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../api_webchat/streamingMessage.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export class StreamingMessage', 'class StreamingMessage');
const utils = await readFile(new URL('../js/mzta-utils.js', import.meta.url), 'utf8');
const strip = utils.slice(utils.indexOf('export function stripThinkTags('), utils.indexOf('// Only for PLAIN text.')).replace('export function', 'function');

test('long answers have a geometric render budget and exact final contents', () => {
    let processed = 0, renders = 0;
    const context = vm.createContext({ sanitizeBlockHtml: value => value, window: { markdownit: () => ({ render(value) { processed += value.length; renders++; return value; } }) } });
    vm.runInContext(strip + source + '\nthis.message = new StreamingMessage();', context);
    const text = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < text.length; i += 128) {
        context.message.handleNewToken(text.slice(i, i + 128));
        context.message.flush();
    }
    assert.equal(context.message.flush(true).fullTextHTML, text);
    assert.ok(processed < text.length * 8, `processed ${processed} characters for ${text.length}`);
    assert.ok(renders < 40, `render count ${renders}`);
});

test('final flush recovers interrupted inline reasoning instead of remaining deferred', () => {
    const context = vm.createContext({ sanitizeBlockHtml: value => value, window: { markdownit: () => ({ render: value => value }) } });
    vm.runInContext(strip + source + '\nthis.message = new StreamingMessage();', context);
    context.message.handleNewToken('<think>unfinished reasoning');
    assert.equal(context.message.flush(), null);
    const final = context.message.flush(true);
    assert.equal(final.thinkingText, 'unfinished reasoning');
    assert.equal(final.fullTextHTML, '');
});
