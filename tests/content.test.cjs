const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const script = readFileSync(process.env.CHATCOMPOST_TEST_SCRIPT || 'content.js', 'utf8');

async function fixture(t, html, hostname = 'chatgpt.com') {
  const dom = new JSDOM(html, {
    url: `https://${hostname}/`,
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole()
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  window.setTimeout = (callback, delay = 0) => {
    timers.set(++nextId, { callback, at: now + delay });
    return nextId;
  };
  window.clearTimeout = (id) => timers.delete(id);
  // Periodic persistence is independent of sidebar mutation handling.
  window.setInterval = () => 0;
  window.fetch = () => { throw new Error('Tests must never contact deletion APIs'); };
  window.confirm = () => { throw new Error('Tests must never request deletion'); };

  async function tick(ms = 0) {
    const end = now + ms;
    await Promise.resolve();
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  }

  await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  window.eval(script);
  await tick(hostname === 'chatgpt.com' ? 1500 : 2500);
  return { window, document, tick };
}

const row = (id) => `<a href="/c/${id}">${id}</a>`;
const box = (document, id) => document.querySelector(`a[href="/c/${id}"] .bulk-delete-checkbox`);

test('adds checkboxes to older chats loaded outside the first nav', async (t) => {
  const { document, tick } = await fixture(t, `<nav>Tools</nav><nav id="history">${row('initial')}</nav>`);
  assert.ok(box(document, 'initial'));
  document.querySelector('#history').insertAdjacentHTML('beforeend', row('older'));
  await tick(151);
  assert.ok(box(document, 'older'));
  assert.equal(document.querySelectorAll('.bulk-delete-checkbox').length, 2);
});

test('adds a new chat arriving immediately after a previous injection', async (t) => {
  const { document, tick } = await fixture(t, `<nav>${row('initial')}</nav>`);
  const nav = document.querySelector('nav');
  nav.insertAdjacentHTML('beforeend', row('older'));
  await tick(151);
  assert.ok(box(document, 'older'));
  nav.insertAdjacentHTML('afterbegin', row('new-chat'));
  await tick(151);
  assert.ok(box(document, 'new-chat'));
});

test('continues observing when navigation replaces the sidebar', async (t) => {
  const { document, tick } = await fixture(t, `<nav>${row('old')}</nav>`);
  document.querySelector('nav').outerHTML = `<nav>${row('replacement')}</nav>`;
  await tick(151);
  assert.ok(box(document, 'replacement'));
});

test('adds checkbox when a new chat receives its conversation URL', async (t) => {
  const { document, tick } = await fixture(t, '<nav><a href="/">Test response</a></nav>');
  assert.equal(document.querySelectorAll('.bulk-delete-checkbox').length, 0);
  document.querySelector('a').setAttribute('href', '/c/new-id');
  await tick(151);
  assert.ok(box(document, 'new-id'));
});

test('selection survives replacement and does not transfer to a recycled row', async (t) => {
  const { document, tick, window } = await fixture(t, `<nav>${row('selected')}</nav>`);
  await tick(600);
  box(document, 'selected').click();
  assert.equal(document.querySelector('#bulk-delete-count').textContent, '1');
  document.querySelector('nav').innerHTML = row('selected');
  await tick(151);
  assert.equal(box(document, 'selected').checked, true);
  document.querySelector('a').setAttribute('href', '/c/different');
  await tick(151);
  assert.equal(box(document, 'different').checked, false);
  assert.equal(document.querySelector('#bulk-delete-count').textContent, '0');
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('chatcompost_chatgpt_checked')), ['selected']);
});

test('continuous chat updates cannot starve injection or duplicate checkboxes', async (t) => {
  const { document, tick } = await fixture(t, `<nav>${row('initial')}</nav><main></main>`);
  const nav = document.querySelector('nav');
  for (let i = 0; i < 6; i++) {
    nav.insertAdjacentHTML('beforeend', row(`loaded-${i}`));
    await tick(50);
  }
  assert.ok(box(document, 'loaded-0'));
  await tick(1000);
  assert.equal(document.querySelectorAll('.bulk-delete-checkbox').length, 7);
  // No self-triggered observer loop after extension writes settle.
  let writes = 0;
  const observer = new document.defaultView.MutationObserver(records => { writes += records.length; });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelector('main').textContent = 'Streaming response';
  await tick(1000);
  observer.disconnect();
  assert.equal(writes, 1);
});

test('restores a checkbox removed by the app and saves immediate selection changes', async (t) => {
  const { document, tick, window } = await fixture(t, `<nav>${row('initial')}</nav>`);
  box(document, 'initial').remove();
  await tick(151);
  box(document, 'initial').click();
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('chatcompost_chatgpt_checked')), ['initial']);
  box(document, 'initial').click();
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem('chatcompost_chatgpt_checked')), []);
});

test('Gemini still adds checkboxes to dynamically loaded conversations', async (t) => {
  const { document, tick } = await fixture(t,
    '<div data-test-id="conversation">Existing conversation</div>', 'gemini.google.com');
  document.body.insertAdjacentHTML('beforeend', '<div data-test-id="conversation">Later conversation</div>');
  await tick(151);
  assert.equal(document.querySelectorAll('.bulk-delete-checkbox').length, 2);
});

test('preserves pinned row layout and does not accumulate padding on reinjection', async (t) => {
  const { document, tick } = await fixture(t, `<nav>
    <a href="/c/pinned" style="display: grid; padding-inline-start: 12px">
      <span class="title">Ch 1 Visuals</span><span class="project">Work</span>
    </a></nav>`);
  const link = document.querySelector('a');
  assert.equal(link.style.display, 'grid');
  assert.equal(link.style.alignItems, '');
  assert.equal(link.style.getPropertyValue('--chatcompost-original-padding'), '12px');
  assert.ok(link.hasAttribute('data-bulk-delete-checkbox'));
  box(document, 'pinned').remove();
  await tick(151);
  assert.ok(box(document, 'pinned'));
  assert.equal(link.style.getPropertyValue('--chatcompost-original-padding'), '12px');
  assert.equal(link.querySelector('.title').textContent, 'Ch 1 Visuals');
  assert.equal(link.querySelector('.project').textContent, 'Work');
});
