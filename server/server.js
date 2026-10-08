// Kantor Kita server: serves public/ and a small task API. Tasks assigned to a connected
// team member (server/agents.js) are worked by Claude, or by a labelled dry run when no API key is set.
// No login yet, so it only listens on this machine.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
try { process.loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env')); } catch { /* no .env file: dry run */ }

const agents = require('./agents');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json'), CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const HOST = '0.0.0.0', PORT = Number(process.env.PORT) || 3005;
const RAW_KEY = process.env.OPENAI_API_KEY || 'sk-97bb92f6bd23bb63-l5k8ko-d3d4218c'; // Diganti sama kunci asli Hermes
const API_KEY = process.env.ANTHROPIC_API_KEY || RAW_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'ag/gemini-3.8-flash';
const API_URL = `${process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:20128'}/v1/chat/completions`; // Arahkan ke endpoint standar OpenAI yang biasa dipakai 9router
const DRY_RUN = false; // Memaksa agar AI tetap berjalan meskipun kita pakai key dummy
const STATES = new Set(['queued', 'active', 'blocked', 'review', 'done']);
// Which model a member uses: their own, else the .env default.
const modelOf = agent => {
  // Paksa semua agen pakai model 9router yang kita atur (fetch-combo / pencarian web lokal)
  // karena kalau mereka mencoba pakai 'claude-sonnet-5-5' bawaan, 9router akan menolaknya.
  return MODEL;
};
const reviewer = agent => ({...agent,system:`${agent.system}\nFor this peer-feedback task, use these sections instead of your usual reply or caption format: what works, concrete changes, missing facts or questions, and next steps. Review the supplied draft from your role. Do not claim to approve, publish, send, or edit anything. Follow the language of the supplied draft and focus.`});

// ---- storage: one JSON file, written atomically ----
fs.mkdirSync(DATA_DIR, {recursive: true});
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); if (!Array.isArray(tasks)) throw new Error('not a list'); }
catch (error) { if (error.code !== 'ENOENT') { console.error(`Cannot read ${TASKS_FILE}: ${error.message}. Fix or move the file, then restart.`); process.exit(1); } }
let durable = JSON.stringify(tasks);
function save() {
  try {
  const tmp = `${TASKS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
  fs.renameSync(tmp, TASKS_FILE);
  durable=JSON.stringify(tasks);
  } catch(error) { tasks=JSON.parse(durable); throw error; }
}
// The team chat room, kept in its own file so a broken chat never blocks tasks.
let room = [];
try { room = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8')).room; if (!Array.isArray(room)) throw new Error('no room list'); }
catch (error) { if (error.code !== 'ENOENT' && !(error.message === 'no room list')) { console.error(`Cannot read ${CHATS_FILE}: ${error.message}. Fix or move the file, then restart.`); process.exit(1); } room = []; }
function saveRoom() { const tmp = `${CHATS_FILE}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify({room}, null, 2)); fs.renameSync(tmp, CHATS_FILE); }
const now = () => new Date().toISOString();
const MEMBERS = new Set(['Koh Arman','Koh Wira','Kak Rani','Kak Dewi','Mira','Tari','Bagas Pratama Putra','Rizky Hakim','Yoga','Bang Eko','Gilang','Kak Sinta','Kak Laras']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

// ---- agent worker: one task at a time per connected member, oldest first ----
const busy = new Set();
async function askClaude(agent, task) {
  return callModel(agent, agent.system, [{role: 'user', content: `Task: ${task.title}\n\nBrief:\n${task.brief || '(no brief given)'}${task.feedback ? `\n\nPrevious draft:\n${task.result}\n\nRevision requested:\n${task.feedback}` : ''}`}]);
}
async function callModel(agent, system, messages) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: {'content-type': 'application/json', 'Authorization': `Bearer ${API_KEY}`},
      // Tambahkan stream: false agar 9router membalas dengan JSON utuh sekaligus
      body: JSON.stringify({model: modelOf(agent), stream: false, messages: [{role: 'system', content: system}, ...messages]})
    });
    
    // Baca respon mentah sebagai string terlebih dulu
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch (e) {
      // Jika ternyata 9router masih ngeyel pakai Server-Sent Events (SSE)
      if (text.includes('data: {"id"')) {
        const lines = text.split('\n');
        let fullAnswer = '';
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const chunk = JSON.parse(line.substring(6));
              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                fullAnswer += chunk.choices[0].delta.content;
              }
            } catch (err) {}
          }
        }
        if (fullAnswer) return fullAnswer.trim();
      }
      throw new Error('Respons 9router tidak bisa diparsing: ' + text.substring(0, 100));
    }

    if (!response.ok) throw new Error(body?.error?.message || `API OpenAI/9router mengembalikan ${response.status}`);
    const answer = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content 
        ? body.choices[0].message.content.trim() 
        : '';
    if (!answer) throw new Error('Model mengembalikan jawaban kosong: ' + JSON.stringify(body).substring(0, 100));
    return answer;
  } finally { clearTimeout(timer); }
}
async function dryRun(agent, task) {
  await new Promise(resolve => setTimeout(resolve, Number(process.env.DRY_RUN_DELAY_MS ?? 4000)));
  // Dry runs ask back when the brief is nearly empty, so the "Needs decision" flow can be tried without a key.
  if ((task.brief || '').trim().length < 12) return 'QUESTIONS:\n1. UJI COBA: untuk siapa ini, dan apa yang harus disampaikan?\n2. UJI COBA: ada fakta, tautan, atau tenggat yang perlu dimasukkan?';
  return `UJI COBA: ANTHROPIC_API_KEY belum diisi, jadi ini teks contoh, bukan keluaran AI.\n\n${agent.role} akan menyusun draf: "${task.title}".\nArahan diterima: ${task.brief || '(tidak ada)'}${task.feedback ? `\nRevisi diminta: ${task.feedback}` : ''}`;
}
async function work(name) {
  if (busy.has(name)) return;
  const task = tasks.filter(t => t.assignee === name && t.status === 'queued' && !t.error).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!task || tasks.some(t => t.assignee === name && t.status === 'active')) return;
  busy.add(name);
  const runId=crypto.randomUUID();
  try {
    Object.assign(task, {status: 'active', runId, version:(task.version||0)+1, updatedAt: now()}); save();
    const input=structuredClone(task);
    const answer = DRY_RUN ? await dryRun(agents[name], input) : await askClaude(agents[name], input);
    const current = tasks.find(t => t.id === task.id);
    // The task may have been moved back to the queue or reassigned while the agent worked.
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) {
      const by=DRY_RUN?'dry-run':modelOf(agents[name]),asked=answer.match(/^QUESTIONS:\s*([\s\S]+)/);
      // The agent asked instead of guessing: park the task until someone answers.
      if(asked){Object.assign(current,{status:'blocked',questions:asked[1].trim().slice(0,2000),askedBy:by,runId:null,version:(current.version||0)+1,updatedAt:now()});save();return;}
      const draft={result:answer.slice(0,10000),by,createdAt:now(),feedback:input.feedback||''};
      Object.assign(current, {status:'review',result:draft.result,by:draft.by,history:[...(current.history||[]),draft],runId:null,version:(current.version||0)+1,updatedAt:now()});save();
    }
  } catch (error) {
    const current = tasks.find(t => t.id === task.id);
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) { Object.assign(current, {status: 'queued', runId:null, version:(current.version||0)+1, error: error.name === 'AbortError' ? 'Claude terlalu lama menjawab.' : error.message === 'fetch failed' ? 'Tidak dapat menghubungi API Claude. Periksa koneksi internet.' : error.message, updatedAt: now()}); save(); }
    console.error(`Agent ${name} failed on "${task.title}": ${error.message}`);
  } finally { busy.delete(name); setImmediate(() => work(name)); }
}
const kick = () => Object.keys(agents).forEach(work);

// ---- team chat room: people call connected members with @; each called member replies in turn ----
const ROOM_RULES = 'You are in the team chat room of the office app, not working on a task. A colleague called you with @. Reply conversationally and briefly, in the language of their message, as yourself only; other members may reply after you and you can see what they already said. Never use the QUESTIONS: format here. Do not claim to have posted, sent, changed or published anything. If the request needs real work, say what you would do and suggest turning it into a task with the "Jadikan tugas" button.';
const pending = [];               // members still to reply, in order
let replying = null, roomChain = Promise.resolve();
const addToRoom = message => { room = [...room, {id: crypto.randomUUID(), at: now(), ...message}].slice(-300); saveRoom(); };
async function roomReply(name) {
  if (DRY_RUN) {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.DRY_RUN_DELAY_MS ?? 1200)));
    const ask = [...room].reverse().find(m => m.role === 'user');
    return `UJI COBA: ANTHROPIC_API_KEY belum diisi, jadi ini balasan contoh, bukan keluaran AI.\n\nSaya ${agents[name].role}. Pesan Anda: "${(ask?.text || '').slice(0, 200)}". Setelah tersambung ke model, saya akan menjawab sesuai peran saya.`;
  }
  // The last 30 messages as one transcript, so the member sees the question and what colleagues already answered.
  const transcript = room.slice(-30).map(m => `${m.role === 'user' ? 'Pengguna' : `${m.name} (${agents[m.name]?.role || 'agen'})`}: ${m.text}`).join('\n\n');
  return callModel(agents[name], `${agents[name].system}\n\n${ROOM_RULES}`, [{role: 'user', content: `Team chat so far:\n\n${transcript}\n\nReply now as ${name}.`}]);
}
function callMembers(names) {
  pending.push(...names);
  for (const name of names) roomChain = roomChain.then(async () => {
    replying = name; pending.splice(pending.indexOf(name), 1);
    try { addToRoom({role: 'agent', name, text: (await roomReply(name)).slice(0, 10000), by: DRY_RUN ? 'dry-run' : modelOf(agents[name])}); }
    catch (error) { addToRoom({role: 'agent', name, error: true, text: error.name === 'AbortError' ? 'Agen terlalu lama menjawab.' : error.message === 'fetch failed' ? 'Tidak dapat menghubungi API model. Periksa koneksi.' : error.message}); console.error(`Chat reply by ${name} failed: ${error.message}`); }
    finally { replying = null; }
  });
}

// ---- HTTP ----
function send(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 1e6) { reject(Object.assign(new Error('Permintaan terlalu besar'), {status: 413})); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), {status: 400})); } });
  });
}
function newTask(input) {
  if(!input||typeof input!=='object')return null;
  const title = text(input.title, 160), assignee = text(input.assignee, 80);
  if (!title || !assignee) return null;
  const status = STATES.has(input.status) ? input.status : 'queued', result = text(input.result, 10000);
  return {id: crypto.randomUUID(), title, assignee, brief: text(input.brief, 5000), status: ['done','review'].includes(status) && !result ? 'queued' : status, result, createdAt: now()};
}
async function api(req, res, url) {
  if (url.pathname === '/api/reviews' && req.method === 'POST') {
    const input=await readJson(req),names=input?.members;
    if(!Array.isArray(names)||!names.length||names.length>6||new Set(names).size!==names.length||names.some(n=>!MEMBERS.has(n)))return send(res,400,{error:'Pilih 1–6 anggota tim yang berbeda.'});
    const task=tasks.find(t=>t.id===input.taskId);if(!task?.result)return send(res,404,{error:'Tugas ini belum punya draf untuk dibahas.'});
    if(input.version!==(task.version||0))return send(res,409,{error:'Draf berubah. Muat ulang dan pilih versi terbaru.'});
    const connected=names.filter(n=>agents[n]);if(!connected.length)return send(res,400,{error:'Undang setidaknya satu agen AI yang tersambung untuk masukan.'});
    const source=structuredClone(task),notes=[];
    for(const name of connected){const review={title:`Review meeting: ${source.title}`,brief:`Review this existing draft from your role. Give concrete suggestions, missing facts and next steps. Do not approve it, publish it or claim to change the task.\n\nOriginal brief:\n${source.brief}\n\nDraft to review:\n${source.result}\n\nFocus:\n${text(input.focus,2000)||'Clarity, accuracy and completeness.'}${notes.length?`\n\nColleague feedback:\n${notes.map(n=>`${n.name}: ${n.result}`).join('\n\n')}`:''}`};const result=DRY_RUN?await dryRun(agents[name],review):await askClaude(reviewer(agents[name]),review);notes.push({name,result:result.slice(0,10000)});}
    return send(res,200,{mode:DRY_RUN?'dry-run':'claude',taskId:source.id,sourceVersion:source.version||0,createdAt:now(),stale:(tasks.find(t=>t.id===source.id)?.version||0)!==(source.version||0),notes});
  }
  if (url.pathname === '/api/tasks/batch' && req.method === 'POST') {
    const input=await readJson(req),list=input?.tasks;
    if(!Array.isArray(list)||!list.length||list.length>13)return send(res,400,{error:'Pilih 1–13 tugas.'});
    const added=list.map(item=>newTask({...item,status:'queued',result:''}));
    if(added.some(t=>!t||!MEMBERS.has(t.assignee)))return send(res,400,{error:'Setiap tugas perlu judul dan penanggung jawab yang dikenal.'});
    tasks.unshift(...added);save();send(res,201,added);setImmediate(kick);return;
  }
  if (url.pathname === '/api/coffee' && req.method === 'POST') {
    const input=await readJson(req),names=input?.members,topic=text(input?.topic,3000);
    if(!Array.isArray(names)||names.length!==2||names[0]===names[1]||names.some(n=>!agents[n])||!topic)return send(res,400,{error:'Pilih dua agen AI yang tersambung dan masukkan topik.'});
    const notes=[];
    for(const name of names){
      const task={title:'Coffee break: peer feedback',brief:`Review this topic or draft from your role. Give concrete suggestions, unresolved questions and next steps. Do not claim to take any external action.\n\n${topic}${notes.length?`\n\nFirst colleague feedback:\n${notes[0].result}`:''}`};
      const answer=DRY_RUN?await dryRun(agents[name],task):await askClaude(reviewer(agents[name]),task);
      notes.push({name,result:answer.slice(0,10000)});
    }
    return send(res,200,{mode:DRY_RUN?'dry-run':'claude',createdAt:now(),notes});
  }
  if (url.pathname === '/api/room') {
    const state = () => ({messages: room, replying: [replying, ...pending].filter(Boolean)});
    if (req.method === 'GET') return send(res, 200, state());
    if (req.method === 'DELETE') { if (replying || pending.length) return send(res, 409, {error: 'Tunggu semua balasan selesai sebelum menghapus obrolan.'}); room = []; saveRoom(); return send(res, 200, state()); }
    if (req.method === 'POST') {
      const input = await readJson(req), message = text(input?.text, 2000);
      if (!message) return send(res, 400, {error: 'Tulis pesan terlebih dahulu.'});
      const mentions = Array.isArray(input.mentions) ? [...new Set(input.mentions)] : [];
      if (mentions.length > 6 || mentions.some(n => !Object.hasOwn(agents, n))) return send(res, 400, {error: 'Hanya anggota yang tersambung ke agen AI yang bisa dipanggil, paling banyak 6 sekaligus.'});
      addToRoom({role: 'user', text: message, mentions}); callMembers(mentions);
      return send(res, 201, state());
    }
  }
  if (url.pathname === '/api/agents' && req.method === 'GET')
    return send(res, 200, {mode: DRY_RUN ? 'dry-run' : 'claude', model: DRY_RUN ? null : MODEL, members: Object.fromEntries(Object.entries(agents).map(([name, a]) => [name, {role: a.role, model: modelOf(a)}]))});
  if (url.pathname === '/api/tasks' && req.method === 'GET') return send(res, 200, tasks);
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const input=await readJson(req);
    if(input?.status!==undefined&&!STATES.has(input.status))return send(res,400,{error:'Status tidak dikenal.'});
    const task = newTask(input); if (!task) return send(res, 400, {error: 'Tugas perlu judul dan penanggung jawab.'});
    if(!MEMBERS.has(task.assignee))return send(res,400,{error:'Penanggung jawab tidak dikenal.'});
    if(task.status==='review'||task.status==='blocked'||(agents[task.assignee]&&task.status!=='queued'))return send(res,409,{error:'Draf AI harus dibuat sebelum ditinjau.'});
    if(task.status==='active'&&tasks.some(t=>t.assignee===task.assignee&&t.status==='active'))return send(res,409,{error:'Anggota ini sudah punya tugas aktif.'});
    tasks.unshift(task); save(); send(res, 201, task); setImmediate(kick); return;
  }
  // One-time move of tasks saved in a browser before the server existed; only into an empty store.
  if (url.pathname === '/api/tasks/import' && req.method === 'POST') {
    if (tasks.length) return send(res, 409, {error: 'Server sudah memiliki tugas.'});
    const list = await readJson(req); if (!Array.isArray(list)) return send(res, 400, {error: 'Diharapkan daftar tugas.'});
    if(tasks.length)return send(res,409,{error:'Server sudah memiliki tugas.'});
    tasks = list.map(item => { const task = newTask(item); if (task && typeof item.createdAt === 'string') task.createdAt = item.createdAt; if(task&&Array.isArray(item.history))task.history=item.history; return task; }).filter(Boolean);
    // Imported work that was in progress by hand goes back to the queue.
    tasks.forEach(task => { if (task.status === 'active') task.status = 'queued'; });
    save(); kick(); return send(res, 201, tasks);
  }
  const match = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
  if (match && req.method === 'PATCH') {
    const task = tasks.find(t => t.id === match[1]); if (!task) return send(res, 404, {error: 'Tugas tidak ditemukan.'});
    const input = await readJson(req), change = {};
    if(!input||typeof input!=='object')return send(res,400,{error:'Diharapkan sebuah objek.'});
    // Answering an agent's questions adds the answers to the brief and puts the task back in its queue.
    if(input.action==='answer'){
      if(task.status!=='blocked'||input.version!==(task.version||0))return send(res,409,{error:'Pertanyaan ini berubah. Muat ulang dan jawab yang terbaru.'});
      const answer=text(input.answer,3000);if(!answer)return send(res,400,{error:'Tulis jawaban terlebih dahulu.'});
      Object.assign(task,{status:'queued',brief:`${task.brief}\n\nQuestions from ${task.assignee}:\n${task.questions}\n\nAnswers:\n${answer}`.trim().slice(0,5000),questions:undefined,askedBy:undefined,error:undefined,runId:null,version:(task.version||0)+1,updatedAt:now()});
      save();send(res,200,task);setImmediate(kick);return;
    }
    if(input.action!==undefined){
      if(!['approve','revise'].includes(input.action))return send(res,400,{error:'Aksi tidak dikenal.'});
      if(task.status!=='review'||input.version!==(task.version||0))return send(res,409,{error:'Draf ini berubah. Muat ulang dan tinjau versi terbaru.'});
      if(input.action==='revise'&&!text(input.feedback,5000))return send(res,400,{error:'Jelaskan perubahan yang diperlukan.'});
      Object.assign(task,{status:input.action==='approve'?'done':'queued',feedback:input.action==='revise'?text(input.feedback,5000):'',reviewedAt:input.action==='approve'?now():null,runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
      save();send(res,200,task);setImmediate(kick);return;
    }
    if (input.assignee !== undefined) { change.assignee = text(input.assignee, 80); if (!MEMBERS.has(change.assignee)) return send(res, 400, {error: 'Pilih penanggung jawab.'}); if (task.status !== 'done') change.status = 'queued'; }
    if (input.status !== undefined) {
      if (!STATES.has(input.status)||input.status==='review'||input.status==='blocked') return send(res, 400, {error: 'Status tidak dikenal.'});
      const assignee = change.assignee || task.assignee;
      if(task.status==='review'&&!change.assignee)return send(res,409,{error:'Setujui draf ini atau minta revisi.'});
      if (agents[assignee] && input.status !== 'queued') return send(res, 409, {error: 'Anggota ini tersambung ke agen AI; ia memulai dan menyelesaikan tugasnya sendiri.'});
      if (input.status === 'active' && tasks.some(t => t.id !== task.id && t.assignee === assignee && t.status === 'active')) return send(res, 409, {error: 'Anggota ini sudah punya tugas aktif.'});
      if (input.status === 'done' && !text(input.result, 10000)) return send(res, 400, {error: 'Tulis hasil sebelum menyelesaikan.'});
      change.status = input.status; change.result = input.status === 'done' ? text(input.result, 10000) : '';
    }
    if(!Object.keys(change).length)return send(res,400,{error:'Berikan penanggung jawab, status, atau aksi tinjauan.'});
    // Moving a task back to the queue clears a previous agent error so it is tried again.
    Object.assign(task, change, {runId:null,version:(task.version||0)+1,error: undefined, updatedAt: now()}); save(); kick(); return send(res, 200, task);
  }
  send(res, 404, {error: 'Tidak ditemukan.'});
}
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon'};
function serveFile(res, url) {
  let file;
  try { file = path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { return send(res, 400, {error: 'Bad path.'}); }
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, {error: 'Forbidden.'});
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404, {'content-type': 'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'}); res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (!url.pathname.startsWith('/api/')) return serveFile(res, url);
  try { await api(req, res, url); }
  catch (error) { send(res, error.status || 500, {error: error.status ? error.message : 'Server error.'}); if (!error.status) console.error(error); }
});
server.listen(PORT, HOST, () => {
  console.log(`Kantor Kita: http://${HOST}:${PORT}`);
  console.log(DRY_RUN ? 'AI agents: dry run (set ANTHROPIC_API_KEY in .env to use Claude)' : `AI agents: ${Object.entries(agents).map(([name, a]) => `${name} → ${modelOf(a)}`).join(', ')}`);
  // Tasks left active by a previous run go back to the queue and are picked up again.
  let reset = false; tasks.forEach(task => { if (task.status === 'active' && agents[task.assignee]) { task.status = 'queued'; reset = true; } }); if (reset) save();
  kick();
});
