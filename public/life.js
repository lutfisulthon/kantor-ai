(() => {
  const el=id=>document.getElementById(id);
  const habits=['Langganan kopi','Rajin membaca papan ide','Langganan kopi','Berpikir di lounge','Teman ngobrol tim','Rajin membaca papan ide','Rutin peregangan','Rajin membaca papan ide','Berpikir di lounge','Rajin membaca papan ide','Teman ngobrol tim','Langganan kopi','Perawat tanaman'];
  const contributions={CEO:'Tetapkan prioritas, kriteria keberhasilan, dan keputusan yang diperlukan',CTO:'Nilai kelayakan teknis, ketergantungan, dan risiko','Social Media Specialist':'Susun draf konten media sosial dan rencana publikasi','Digital Marketing':'Susun draf kanal kampanye, eksperimen, dan pengukuran','Business Development':'Cari peluang kemitraan dan susun draf penjajakan','Social Media Intern':'Siapkan ide konten pendukung dan daftar periksa riset','Frontend Engineer':'Usulkan perubahan UI, langkah implementasi, dan verifikasi','Backend Engineer':'Usulkan perubahan API dan data, langkah implementasi, dan verifikasi','Product Design':'Susun draf alur pengguna, kebutuhan interaksi, dan keputusan desain','Graphic Designer':'Susun draf konsep visual dan daftar aset','Customer Service Leader':'Rencanakan kesiapan layanan, eskalasi, dan pedoman balasan','Customer Service':'Susun draf balasan pelanggan dan pertanyaan yang mungkin muncul'};
  let team=[],groups={},allocation=[],revision=0;
  const feedback=message=>el('lifeFeedback').textContent=message;
  const paragraph=text=>{const p=document.createElement('p');p.textContent=text;return p;};
  const preferences={mood:'auto',celebrate:true};
  try {const saved=JSON.parse(localStorage.getItem('kantor-life.v1')||'{}');if(['auto','morning','afternoon','evening','night'].includes(saved.mood))preferences.mood=saved.mood;if(typeof saved.celebrate==='boolean')preferences.celebrate=saved.celebrate;}catch{}
  function save(){try{localStorage.setItem('kantor-life.v1',JSON.stringify(preferences));}catch{feedback('Preferensi hanya berlaku untuk kunjungan ini; penyimpanan browser tidak tersedia.');}}
  function coffeeAvailability(){const supported=[el('coffeeFirst').value,el('coffeeSecond').value].every(n=>window.officeTasks.agentFor(n));el('coffeeAI').disabled=!supported;if(!supported)el('coffeeAI').checked=false;el('coffeeAvailability').textContent=supported?'Keduanya dapat memberi masukan AI. Ini memakai dua permintaan model.':'Rehat kopi simulasi tersedia. Masukan AI memerlukan dua agen yang tersambung.';}
  window.officeLife={preferences,habits,init(people,divisions){
    team=people;groups=divisions;
    el('officeMood').value=preferences.mood;el('celebrations').checked=preferences.celebrate;
    for(const [key,group] of Object.entries(groups)){const o=new Option(group.name,key);el('briefDivision').add(o);}
    team.forEach((person,i)=>{for(const id of ['coffeeFirst','coffeeSecond'])el(id).add(new Option(`${person.initials} · ${person.role}`,person.n));const li=document.createElement('li');li.textContent=`${person.initials} · ${habits[i]}`;el('personalityList').append(li);});
    el('coffeeSecond').selectedIndex=1;
    el('bLife').onclick=()=>{coffeeAvailability();el('lifeDialog').showModal();el('closeLife').focus();};el('closeLife').onclick=()=>el('lifeDialog').close();
    el('officeMood').onchange=()=>{preferences.mood=el('officeMood').value;save();};el('celebrations').onchange=()=>{preferences.celebrate=el('celebrations').checked;save();};
    el('petCat').onclick=()=>window.officeScene.petCat();
    el('coffeeFirst').onchange=el('coffeeSecond').onchange=coffeeAvailability;
    document.addEventListener('officetasks:server',coffeeAvailability);
    el('coffeeForm').onsubmit=async event=>{
      event.preventDefault();const members=[el('coffeeFirst').value,el('coffeeSecond').value],topic=el('coffeeTopic').value.trim();
      if(members[0]===members[1]){feedback('Pilih dua orang yang berbeda.');return;}
      const useAI=el('coffeeAI').checked;if(useAI&&!topic){feedback('Masukkan topik untuk masukan AI.');el('coffeeTopic').focus();return;}
      if(!window.officeScene.coffee(members)){feedback('Dua tempat di pantry sedang terisi. Coba lagi setelah rehat ini selesai.');return;}
      el('coffeeNotes').textContent='';el('saveCoffee').hidden=true;
      if(!useAI){feedback('Undangan kopi terkirim. Ini rehat simulasi.');return;}
      const button=event.submitter;button.disabled=true;feedback('Para agen sedang bertukar masukan…');
      try{const response=await fetch('/api/coffee',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({members,topic})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Gagal mendapatkan masukan.');el('coffeeNotes').textContent=`${result.mode==='dry-run'?'UJI COBA · Contoh masukan\n\n':''}${result.notes.map(n=>`${team.find(p=>p.n===n.name)?.initials||n.name}\n${n.result}`).join('\n\n')}`;el('saveCoffee').hidden=false;feedback('Masukan siap. Unduh catatannya untuk menyimpan salinan.');}catch(error){feedback(error.message);}finally{button.disabled=false;}
    };
    el('saveCoffee').onclick=()=>{const url=URL.createObjectURL(new Blob([el('coffeeNotes').textContent],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='kantor-coffee-notes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const invalidate=()=>{revision++;allocation=[];el('divisionPreview').replaceChildren();el('createDivision').hidden=true;};
    for(const id of ['briefDivision','divisionGoal','divisionContext'])el(id).addEventListener('input',invalidate);
    el('divisionForm').onsubmit=event=>{
      event.preventDefault();const goal=el('divisionGoal').value.trim(),context=el('divisionContext').value.trim();if(!goal||!context){feedback('Masukkan tujuan dan konteks.');return;}
      const members=team.filter(p=>p.group===el('briefDivision').value);
      allocation=members.map(p=>({title:`${goal} · ${p.role}`.slice(0,160),assignee:p.n,brief:`Tujuan bersama: ${goal}\n\nKonteks yang sudah dipastikan:\n${context}\n\nKontribusi Anda (${p.role}): ${contributions[p.role]}.\nBerkoordinasi dengan: ${members.filter(m=>m!==p).map(m=>m.role).join(', ')}.\nKembalikan draf untuk ditinjau manusia. Tandai fakta yang kurang; jangan mengarangnya atau memublikasikan apa pun.`}));
      el('divisionPreview').replaceChildren(...allocation.map(d=>paragraph(`${team.find(p=>p.n===d.assignee).initials}: ${contributions[team.find(p=>p.n===d.assignee).role]}${window.officeTasks.agentFor(d.assignee)?' · Draf AI':' · Tugas manual'}`)));
      el('createDivision').hidden=false;feedback('Pembagian mengikuti tiap peran. Tinjau sebelum membuat tugas.');
    };
    el('createDivision').onclick=async()=>{const button=el('createDivision'),current=revision,count=allocation.length;if(!count)return;button.disabled=true;try{await window.officeTasks.createBatch(allocation);if(current===revision)invalidate();feedback(`${count} tugas divisi dibuat.`);}catch(error){feedback(error.message);}finally{button.disabled=false;}};
    coffeeAvailability();
  }};
})();
