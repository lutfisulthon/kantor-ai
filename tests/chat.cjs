// Team chat room: @ calls, replies in turn, guards, history across restarts, the @ picker, "Jadikan tugas" and the panel.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
function start(port,dir){
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'600'},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:'))resolve(child);});child.on('exit',code=>reject(new Error('server exited '+code)));});
}
const api=(port,opts={})=>fetch(`http://127.0.0.1:${port}/api/room`,{...opts,headers:{'content-type':'application/json'}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
const post=(port,body)=>api(port,{method:'POST',body:JSON.stringify(body)});
const settled=async port=>{for(let i=0;i<80;i++){const s=(await api(port)).body;if(!s.replying.length)return s;await new Promise(r=>setTimeout(r,250));}throw new Error('replies never finished');};
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-chat-'));
  let server=await start(4186,dir);
  const browser=await chromium.launch({headless:true});
  try{
    assert.equal((await post(4186,{text:'  '})).status,400,'empty messages are rejected');
    assert.equal((await post(4186,{text:'@KA halo',mentions:['Koh Arman']})).status,400,'members without an agent cannot be called');
    assert.equal((await post(4186,{text:'catatan saja'})).status,201);
    const called=await post(4186,{text:'@KR @KS siapkan pengumuman libur',mentions:['Kak Rani','Kak Sinta']});
    assert.equal(called.status,201);assert.deepEqual(called.body.replying,['Kak Rani','Kak Sinta'],'called members queue in order');
    assert.equal((await api(4186,{method:'DELETE'})).status,409,'the room cannot be cleared while members are replying');
    const done=await settled(4186);
    assert.deepEqual(done.messages.map(m=>m.role==='user'?'user':m.name),['user','user','Kak Rani','Kak Sinta'],'a plain note gets no reply; called members reply in turn');
    assert.match(done.messages[2].text,/UJI COBA/);assert.equal(done.messages[2].by,'dry-run');
    server.kill();await new Promise(r=>server.on('exit',r));server=await start(4186,dir);
    assert.equal((await api(4186)).body.messages.length,4,'history survives a restart');
    console.log('PASS: room API guards, plain notes, @ calls reply in turn, no clearing mid-reply, history kept across restarts');

    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4186');await page.waitForFunction(()=>window.officeScene&&window.officeTasks.agentFor('Kak Rani'));
    await page.click('#bRoutine');
    await page.click('#bChat');await page.waitForFunction(()=>document.querySelectorAll('#chatLog .chat-msg').length===4);
    // The @ picker lists members, disables those without an agent, and inserts initials.
    await page.fill('#chatInput','');await page.type('#chatInput','Tolong @k');
    await page.waitForFunction(()=>!document.getElementById('chatMentions').hidden);
    assert.match(await page.locator('#chatMentions').innerText(),/KR · Social Media Specialist/);
    assert.match(await page.locator('#chatMentions').innerText(),/belum tersambung/);
    await page.locator('#chatMentions li',{hasText:'KS · Customer Service'}).first().dispatchEvent('mousedown');
    assert.equal(await page.inputValue('#chatInput'),'Tolong @KS ');
    await page.type('#chatInput','buat jawaban untuk pertanyaan jam buka');await page.press('#chatInput','Enter');
    await page.waitForFunction(()=>document.querySelector('#chatLog .typing'));
    await page.waitForFunction(()=>document.querySelectorAll('#chatLog .chat-msg:not(.typing)').length===6&&!document.querySelector('#chatLog .typing'));
    await page.locator('#chatLog .chat-msg.agent').last().getByRole('button',{name:'Jadikan tugas'}).click();
    await page.waitForFunction(()=>window.officeTasks.list().some(t=>t.title==='Tolong buat jawaban untuk pertanyaan jam buka'&&t.assignee==='Kak Sinta'));
    assert.match(await page.locator('#chatFeedback').innerText(),/Tugas dibuat untuk KS/);
    await page.screenshot({path:path.join(os.tmpdir(),'kantor-chat.png')});
    // The Ngobrol button on a character opens the room with that member already called.
    await page.click('#closeChat');await page.selectOption('#teamSelect','Koh Arman');assert.equal(await page.isVisible('#iChat'),false,'no chat for simulated members');
    await page.selectOption('#teamSelect','Kak Rani');await page.click('#iChat');
    assert.equal(await page.inputValue('#chatInput'),'@KR ');assert.equal(await page.isVisible('#info'),false,'the chat panel takes the place of the details panel');
    await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.click('#closeChat');assert.equal(await page.isVisible('#chat'),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: Obrolan panel, @ picker with disabled members, typing state, Jadikan tugas, Ngobrol prefills @, mobile layout');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
