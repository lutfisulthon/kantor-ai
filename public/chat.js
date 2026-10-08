(() => {
  // The team chat room. People call members connected to an AI agent with @ (initials or name); each called
  // member replies in turn on the server, so the panel polls while replies are pending. History lives on the server.
  const $ = id => document.getElementById(id);
  let team = [], messages = [], replying = [], poll = null, sending = false, picker = {items: [], index: 0, start: -1};
  const person = name => team.find(p => p.n === name);
  const initials = name => person(name)?.initials || name;
  const connected = name => !!window.officeTasks.agentFor(name);
  const feedback = message => { $('chatFeedback').textContent = message; };
  async function call(method, body) {
    const response = await fetch('/api/room', {method, headers: {'content-type': 'application/json'}, body: body && JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Galat server ${response.status}`);
    return data;
  }
  // Mentions are @ followed by a member's initials or full name, matched longest first so "@Kak Rani" beats "@K".
  function mentionHits(text) {
    const keys = team.flatMap(p => [[p.n, p.n], [p.initials, p.n]]).sort((a, b) => b[0].length - a[0].length), hits = [];
    for (const match of text.matchAll(/@/g)) {
      const rest = text.slice(match.index + 1).toLowerCase();
      const hit = keys.find(([key]) => rest.startsWith(key.toLowerCase()) && !/[a-z0-9]/i.test(rest[key.length] || ''));
      if (hit) hits.push({name: hit[1], start: match.index, end: match.index + 1 + hit[0].length});
    }
    return hits;
  }
  const mentionsIn = text => [...new Set(mentionHits(text).map(h => h.name))];
  const withoutMentions = text => mentionHits(text).reverse().reduce((t, h) => t.slice(0, h.start) + t.slice(h.end), text).replace(/\s+/g, ' ').trim();
  function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
  function render() {
    const log = $('chatLog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren();
    if (!messages.length && !replying.length) log.append(node('p', 'empty', 'Panggil agen dengan @, misalnya "@KR tolong buat ide konten minggu ini". Panggil beberapa sekaligus untuk diskusi; hasilnya bisa dijadikan tugas.'));
    messages.forEach((m, i) => {
      if (m.role === 'user') { log.append(node('p', 'chat-msg user', m.text)); return; }
      const item = node('div', `chat-msg agent${m.error ? ' failed' : ''}`);
      item.append(node('strong', 'chat-who', `${initials(m.name)} · ${person(m.name)?.role || ''}`), node('p', 'chat-text', m.error ? `Gagal membalas: ${m.text}` : m.text));
      if (!m.error) {
        item.append(node('span', 'chat-meta', m.by === 'dry-run' ? 'Uji coba' : m.by || ''));
        const make = node('button', '', 'Jadikan tugas'); make.type = 'button'; make.onclick = () => toTask(i, make); item.append(make);
      }
      log.append(item);
    });
    for (const name of replying) log.append(node('p', 'chat-msg agent typing', `${initials(name)} sedang mengetik…`));
    hint();
    if (atBottom || sending) log.scrollTop = log.scrollHeight;
  }
  // The person's message just before this reply becomes the task title (without the @ calls); the exchange is the brief.
  async function toTask(index, button) {
    const reply = messages[index], ask = messages.slice(0, index).reverse().find(m => m.role === 'user')?.text || reply.text;
    const plain = withoutMentions(ask) || ask;
    const brief = `Dari obrolan tim:\n\nPermintaan: ${ask}\n\nTanggapan ${initials(reply.name)}: ${reply.text}`.slice(0, 5000);
    button.disabled = true;
    try { await window.officeTasks.createBatch([{title: plain.slice(0, 150), assignee: reply.name, brief}]); feedback(`Tugas dibuat untuk ${initials(reply.name)} dan masuk antrean. Lihat di Tugas.`); }
    catch (error) { feedback(error.message); button.disabled = false; }
  }
  function apply(state) {
    const was = replying;
    messages = state.messages; replying = state.replying;
    // The member who is replying shows a typing bubble in the 3D office; it clears when their reply lands.
    for (const name of replying) window.officeScene?.say(name, 'Mengetik…', 3);
    for (const name of was) if (!replying.includes(name)) window.officeScene?.say(name, 'Sudah dibalas!', 2.5);
    render();
    clearTimeout(poll); poll = replying.length && !$('chat').hidden ? setTimeout(refresh, 1200) : null;
  }
  async function refresh() { try { apply(await call('GET')); } catch (error) { feedback(error.message); } }
  // The @ picker: shows members matching what follows the @ under the caret. Members without an agent are listed but disabled.
  function updatePicker() {
    const input = $('chatInput'), before = input.value.slice(0, input.selectionStart), at = before.lastIndexOf('@');
    const query = at >= 0 ? before.slice(at + 1) : null;
    if (query === null || /\s{2}|\n/.test(query) || query.length > 20) return hidePicker();
    const q = query.toLowerCase();
    const items = team.filter(p => p.initials.toLowerCase().startsWith(q) || p.n.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
      .sort((a, b) => Number(connected(b.n)) - Number(connected(a.n))).slice(0, 8);
    if (!items.length) return hidePicker();
    picker = {items, index: Math.max(0, items.findIndex(p => connected(p.n))), start: at};
    const list = $('chatMentions'); list.replaceChildren(); list.hidden = false;
    items.forEach((p, i) => {
      const option = node('li', i === picker.index ? 'active' : '', `${p.initials} · ${p.role}${connected(p.n) ? '' : ' · belum tersambung'}`);
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(i === picker.index)); option.setAttribute('aria-disabled', String(!connected(p.n)));
      option.onmousedown = event => { event.preventDefault(); choose(i); };
      list.append(option);
    });
  }
  function hidePicker() { $('chatMentions').hidden = true; picker.items = []; }
  function choose(i) {
    const p = picker.items[i]; if (!p || !connected(p.n)) return;
    const input = $('chatInput'), caret = input.selectionStart;
    input.value = `${input.value.slice(0, picker.start)}@${p.initials} ${input.value.slice(caret)}`;
    const end = picker.start + p.initials.length + 2; input.setSelectionRange(end, end); hidePicker(); input.focus();
  }
  const lastCalled = () => ([...messages].reverse().find(m => m.role === 'user' && m.mentions?.length)?.mentions || []).filter(connected);
  // The placeholder says who an un-addressed message will go to.
  function hint() { const last = lastCalled(); $('chatInput').placeholder = last.length ? `Membalas ${last.map(n => '@' + initials(n)).join(' ')}… ketik @ untuk memanggil agen lain` : 'Tulis pesan… ketik @ untuk memanggil agen'; }
  function open(name) {
    $('chat').hidden = false; feedback('');
    if (name && connected(name)) { const input = $('chatInput'), tag = `@${initials(name)} `; if (!input.value.includes(tag.trim())) input.value = tag + input.value; }
    $('chatInput').focus(); refresh();
  }
  function close() { $('chat').hidden = true; hidePicker(); clearTimeout(poll); poll = null; }
  window.officeChat = {
    open, close,
    init(people) {
      team = people;
      $('bChat').onclick = () => $('chat').hidden ? open() : close();
      $('closeChat').onclick = close;
      $('clearChat').onclick = async () => {
        if (!confirm('Hapus seluruh obrolan tim?')) return;
        try { apply(await call('DELETE')); feedback('Obrolan dihapus.'); } catch (error) { feedback(error.message); }
      };
      $('chatInput').oninput = updatePicker;
      $('chatInput').onclick = updatePicker;
      $('chatInput').onblur = () => setTimeout(hidePicker, 100);
      $('chatInput').onkeydown = event => {
        if (picker.items.length && !$('chatMentions').hidden) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); picker.index = (picker.index + (event.key === 'ArrowDown' ? 1 : picker.items.length - 1)) % picker.items.length; updatePickerHighlight(); return; }
          if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(picker.index); return; }
          if (event.key === 'Escape') { event.preventDefault(); hidePicker(); return; }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('chatForm').requestSubmit(); }
      };
      $('chatForm').onsubmit = async event => {
        event.preventDefault();
        const text = $('chatInput').value.trim(); if (!text || sending) return;
        // Without any @, the message goes to whoever was called last, so a conversation carries on without retyping @.
        const named = mentionsIn(text), offline = named.filter(n => !connected(n)), mentions = named.length ? named.filter(connected) : lastCalled();
        sending = true; $('chatSend').disabled = true;
        feedback(offline.length ? `${offline.map(initials).join(', ')} belum tersambung ke agen AI, jadi tidak akan membalas.` : !named.length && mentions.length ? `Melanjutkan dengan ${mentions.map(initials).join(', ')}.` : mentions.length ? '' : 'Pesan tersimpan sebagai catatan. Awali dengan @ untuk memanggil agen, misalnya @KR.');
        try { $('chatInput').value = ''; apply(await call('POST', {text, mentions})); }
        catch (error) { feedback(error.message); $('chatInput').value = text; }
        finally { sending = false; $('chatSend').disabled = false; $('chatInput').focus(); }
      };
    }
  };
  function updatePickerHighlight() { [...$('chatMentions').children].forEach((li, i) => { li.classList.toggle('active', i === picker.index); li.setAttribute('aria-selected', String(i === picker.index)); }); }
})();
