(() => {
  // A direct conversation with one member who is connected to an AI agent. The history lives on the server.
  const $ = id => document.getElementById(id);
  let team = [], current = null, busy = false;
  const initials = name => team.find(p => p.n === name)?.initials || name;
  const feedback = message => { $('chatFeedback').textContent = message; };
  async function call(method, name, body) {
    const response = await fetch(`/api/chat/${encodeURIComponent(name)}`, {method, headers: {'content-type': 'application/json'}, body: body && JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Galat server ${response.status}`), {messages: data.messages});
    return data;
  }
  function bubble(text, className) { const p = document.createElement('p'); p.className = `chat-msg ${className}`; p.textContent = text; return p; }
  function render(messages, typing) {
    const log = $('chatLog'); log.replaceChildren();
    if (!messages.length && !typing) log.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: `Mulai obrolan dengan ${initials(current)}. Ceritakan yang Anda perlukan; hasil diskusi bisa dijadikan tugas.`}));
    messages.forEach((m, i) => {
      const item = bubble(m.text, m.role === 'user' ? 'user' : 'agent');
      if (m.role !== 'user') {
        const meta = document.createElement('span'); meta.className = 'chat-meta'; meta.textContent = m.by === 'dry-run' ? 'Uji coba' : m.by || ''; item.append(meta);
        const make = document.createElement('button'); make.type = 'button'; make.textContent = 'Jadikan tugas'; make.onclick = () => toTask(messages, i, make); item.append(make);
      }
      log.append(item);
    });
    if (typing) log.append(bubble(`${initials(current)} sedang mengetik…`, 'agent typing'));
    log.scrollTop = log.scrollHeight;
  }
  // The person's request just before this reply becomes the task title; the exchange becomes its brief.
  async function toTask(messages, index, button) {
    const ask = messages.slice(0, index).reverse().find(m => m.role === 'user')?.text || messages[index].text;
    const title = ask.replace(/\s+/g, ' ').slice(0, 150);
    const brief = `Dari obrolan dengan ${initials(current)}:\n\nPermintaan: ${ask}\n\nTanggapan agen: ${messages[index].text}`.slice(0, 5000);
    button.disabled = true;
    try { await window.officeTasks.createBatch([{title, assignee: current, brief}]); feedback('Tugas dibuat dan masuk antrean. Lihat di Tugas.'); }
    catch (error) { feedback(error.message); button.disabled = false; }
  }
  async function open(name) {
    current = name; feedback('');
    const agent = window.officeTasks.agentFor(name), person = team.find(p => p.n === name);
    $('chatName').textContent = `Ngobrol dengan ${initials(name)}`;
    $('chatRole').textContent = `${person?.role || ''}${agent ? ` · ${agent.mode === 'claude' ? agent.model : 'uji coba'}` : ''}`;
    $('chat').hidden = false; render([], false); $('chatInput').focus();
    try { const data = await call('GET', name); if (current === name) render(data.messages, busy); }
    catch (error) { feedback(error.message); }
  }
  function close() { $('chat').hidden = true; current = null; }
  window.officeChat = {
    open, close,
    init(people) {
      team = people;
      $('closeChat').onclick = close;
      $('clearChat').onclick = async () => {
        if (!current || busy || !confirm(`Hapus seluruh obrolan dengan ${initials(current)}?`)) return;
        try { render((await call('DELETE', current)).messages, false); feedback('Obrolan dihapus.'); } catch (error) { feedback(error.message); }
      };
      $('chatInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('chatForm').requestSubmit(); } };
      $('chatForm').onsubmit = async event => {
        event.preventDefault();
        const name = current, text = $('chatInput').value.trim();
        if (!name || !text || busy) return;
        busy = true; feedback(''); $('chatInput').value = ''; $('chatSend').disabled = true;
        render([...(await call('GET', name).then(d => d.messages).catch(() => [])), {role: 'user', text}], true);
        window.officeScene?.say(name, 'Mengetik…', 60);
        try { const data = await call('POST', name, {text}); if (current === name) render(data.messages, false); window.officeScene?.say(name, 'Sudah dibalas!', 2.5); }
        catch (error) { feedback(error.message); if (current === name && error.messages) render(error.messages, false); window.officeScene?.say(name, '', 0); if (!error.messages) $('chatInput').value = text; }
        finally { busy = false; $('chatSend').disabled = false; if (current === name) $('chatInput').focus(); }
      };
    }
  };
})();
