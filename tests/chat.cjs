// Chat with an AI member: API guards, dry-run reply, history kept across restarts, "Jadikan tugas", and the chat panel.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
function start(port,dir){
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'600'},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:'))resolve(child);});child.on('exit',code=>reject(new Error('server exited '+code)));});
}
const api=(port,p,opts={})=>fetch(`http://127.0.0.1:${port}${p}`,{...opts,headers:{'content-type':'application/json'}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
const rani='/api/chat/'+encodeURIComponent('Kak Rani');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-chat-'));
  let server=await start(4186,dir);
  const browser=await chromium.launch({headless:true});
  try{
    assert.equal((await api(4186,'/api/chat/'+encodeURIComponent('Koh Arman'))).status,404,'members without an agent cannot be chatted with');
    assert.equal((await api(4186,rani,{method:'POST',body:JSON.stringify({text:'  '})})).status,400,'empty messages are rejected');
    const first=await api(4186,rani,{method:'POST',body:JSON.stringify({text:'Halo, bisa bantu ide konten?'})});
    assert.equal(first.status,200);assert.deepEqual(first.body.messages.map(m=>m.role),['user','agent']);
    assert.match(first.body.messages[1].text,/UJI COBA/);assert.equal(first.body.messages[1].by,'dry-run');
    // A second message while the first is still being answered is refused, so replies never interleave.
    const pending=api(4186,rani,{method:'POST',body:JSON.stringify({text:'Pesan kedua'})});
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await api(4186,rani,{method:'POST',body:JSON.stringify({text:'Pesan ketiga'})})).status,409);
    assert.equal((await pending).body.messages.length,4);
    server.kill();await new Promise(r=>server.on('exit',r));server=await start(4186,dir);
    assert.equal((await api(4186,rani)).body.messages.length,4,'history survives a restart');
    console.log('PASS: chat API guards, dry-run reply, one reply at a time, history kept across restarts');

    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4186');await page.waitForFunction(()=>window.officeScene&&window.officeTasks.agentFor('Kak Rani'));
    await page.click('#bRoutine');
    await page.selectOption('#teamSelect','Koh Arman');assert.equal(await page.isVisible('#iChat'),false,'no chat for simulated members');
    await page.selectOption('#teamSelect','Kak Rani');await page.click('#iChat');
    await page.waitForFunction(()=>document.querySelectorAll('#chatLog .chat-msg').length===4);
    assert.equal(await page.isVisible('#info'),false,'the chat panel takes the place of the details panel');
    await page.fill('#chatInput','Tolong buat caption untuk hari pelanggan');await page.press('#chatInput','Enter');
    await page.waitForFunction(()=>document.querySelector('#chatLog .typing'));
    await page.waitForFunction(()=>document.querySelectorAll('#chatLog .chat-msg:not(.typing)').length===6);
    await page.locator('#chatLog .chat-msg.agent').last().getByRole('button',{name:'Jadikan tugas'}).click();
    await page.waitForFunction(()=>window.officeTasks.list().some(t=>t.title==='Tolong buat caption untuk hari pelanggan'&&t.assignee==='Kak Rani'));
    assert.match(await page.locator('#chatFeedback').innerText(),/Tugas dibuat/);
    await page.screenshot({path:path.join(os.tmpdir(),'kantor-chat.png')});
    await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.click('#closeChat');assert.equal(await page.isVisible('#chat'),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: chat panel from the character, typing state, Enter sends, Jadikan tugas creates a task, mobile layout');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
