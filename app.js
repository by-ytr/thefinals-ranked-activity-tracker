const LS={settings:"finals_tracker_settings_v3",snapshots:"finals_tracker_snapshots_v3",events:"finals_tracker_events_v3",names:"finals_tracker_names_v1",community:"finals_tracker_community_v1",auth:"finals_tracker_auth_v1",session:"finals_tracker_session_v1"};
const DEFAULTS={proxyBase:"",globalUrl:"",leaderboardId:"s9",platform:"crossplay",pollIntervalSec:60,reflectDelayMin:8,matchWaitMin:5,matchAvgMin:31,matchJitterMin:3,tournamentTotalMin:45,estimatorEnabled:true,estWindowStart:2000,estWindowSize:500,estCacheSec:30,maxEvents:5000,rsDropThreshold:1000};
// 繝舌ャ繧ｯ繧ｨ繝ｳ繝・URL 閾ｪ蜍戊ｧ｣豎ｺ・壽・遉ｺ險ｭ螳壹′縺ｪ縺代ｌ縺ｰ蜷後が繝ｪ繧ｸ繝ｳ・・orker 驟堺ｿ｡譎ゑｼ峨ｒ菴ｿ逕ｨ
function autoOrigin(){const o=location.origin;return(o==="null"||o.startsWith("file:")||o.includes("localhost")||o.includes("127.0.0.1"))?"":o;}
function effectiveProxyBase(s){return(s.proxyBase||"").replace(/\/$/,"")||autoOrigin();}
function effectiveGlobalUrl(s){return(s.globalUrl||"").replace(/\/$/,"")||autoOrigin();}
let timer=null,running=false,currentSettings=null;
let lastCommunitySync=0; // 繧ｰ繝ｭ繝ｼ繝舌Ν繝ｪ繧ｹ繝郁・蜍募酔譛溘・譛邨ょｮ溯｡梧凾蛻ｻ
let viewMode="personal",globalNames=[],globalFilter="all";
const expandedRows=new Set();
let pendingScrollY=null; // 繝ｪ繝ｭ繝ｼ繝牙ｾ後せ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ蠕ｩ蜈・畑
let lastRows=[]; // 譛蠕後↓謠冗判縺励◆陦後ョ繝ｼ繧ｿ・磯・驕・・繧ｿ繝ｳ蜊ｳ譎ょ・謠冗判逕ｨ・・let pickedUp=new Set(); // pickup・亥､ｧ蝙九げ繝ｩ繝募ｯｾ雎｡・・let personalRegionFilter="all"; // 閾ｪ蛻・・繝ｪ繧ｹ繝・繧ｵ繝ｼ繝舌・繝輔ぅ繝ｫ繧ｿ繝ｼ
let liveRegionFilter="all";    // Live table繝ｪ繝ｼ繧ｸ繝ｧ繝ｳ繝輔ぅ繝ｫ繧ｿ繝ｼ
let liveTabMode="personal";    // "personal" | "global" | "pickup"
let liveSearchQuery="";        // Live table讀懃ｴ｢
function buildPlayerSparkEl(row){
  const slots=30,slotMin=1,now=nowMs();
  const lca=row.effectiveLCA??row.lastChangeAt;
  const isDanger=isEncounterDanger(row.manualEvent);
  const probs=[];
  for(let i=0;i<slots;i++){
    const future=now+(i*slotMin*60000);
    const inf=inferState(future,lca,row.reflectDelayMin,row.matchWaitMin,row.matchAvgMin,row.matchJitterMin,row.tournamentTotalMin,isDanger);
    probs.push(inf.nextMatchProb||0);
  }
  const peakSlot=probs.indexOf(Math.max(...probs));
  const wrap=document.createElement("div");wrap.className="psGraph"+(isDanger?" psGraph--danger":"");
  const barsEl=document.createElement("div");barsEl.className="psBars";
  for(let i=0;i<slots;i++){
    const v=probs[i]/100;
    const bar=document.createElement("div");
    const lvl=v<0.33?"low":v<0.66?"mid":"high";
    bar.className="sparkBar "+(isDanger?"d-":"")+lvl+(i===peakSlot?" peak":"");
    bar.style.height=(4+Math.round(v*56))+"px";
    bar.title=`+${i}蛻・ｾ・ ${probs[i]}%`;
    barsEl.appendChild(bar);
  }
  const axisEl=document.createElement("div");axisEl.className="psAxis";
  [0,5,10,15,20,25].forEach(m=>{const s=document.createElement("span");s.textContent=m===0?"莉・:"+"+m+"m";axisEl.appendChild(s);});
  wrap.appendChild(barsEl);wrap.appendChild(axisEl);
  return wrap;
}
function buildExpandRow(r,key){
  const tr=document.createElement("tr");tr.className="expandRow";tr.dataset.for=key;
  const td=document.createElement("td");td.colSpan=10;td.className="expandCell";
  // 笏笏 驕ｭ驕・ｨ倬鹸繝代ロ繝ｫ 笏笏
  const panel=document.createElement("div");panel.className="encounterPanel";
  const elabel=document.createElement("div");elabel.className="encounterLabel";elabel.textContent="統 驕ｭ驕・ｨ倬鹸";panel.appendChild(elabel);
  const btns=document.createElement("div");btns.className="encounterBtns";
  const s=currentSettings||getUiSettings();
  for(const et of ENCOUNTER_TYPES){
    if(et.group){
      // 笏笏 繧ｰ繝ｫ繝ｼ繝励・繧ｿ繝ｳ・・1/R2・会ｼ壹け繝ｪ繝・け縺ｧ繧ｵ繝悶ヱ繝阪Ν螻暮幕 笏笏
      const wrap=document.createElement("div");wrap.className="encounterGroup";
      const gBtn=document.createElement("button");gBtn.className="encounterBtn encounterGroupBtn";
      gBtn.title=et.desc;
      gBtn.innerHTML=et.label+' <span class="groupCaret">笆ｾ</span>';
      const subPanel=document.createElement("div");subPanel.className="encounterSubPanel";
      for(const sub of et.sub){
        const sBtn=document.createElement("button");sBtn.className="encounterSubBtn";
        sBtn.textContent=sub.label;sBtn.title="offset: -"+sub.getOffset(s)+"蛻・;
        sBtn.addEventListener("click",(e)=>{
          e.stopPropagation();
          applyEncounterEvent(r.name,sub.key);
          subPanel.classList.remove("open");
          gBtn.querySelector(".groupCaret").textContent="笆ｾ";
        });
        subPanel.appendChild(sBtn);
      }
      gBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const isOpen=subPanel.classList.contains("open");
        // 莉悶・繧ｵ繝悶ヱ繝阪Ν繧貞・驛ｨ髢峨§繧・        btns.querySelectorAll(".encounterSubPanel.open").forEach(p=>{
          p.classList.remove("open");
          const gc=p.previousElementSibling&&p.previousElementSibling.querySelector(".groupCaret");if(gc)gc.textContent="笆ｾ";
        });
        if(!isOpen){subPanel.classList.add("open");gBtn.querySelector(".groupCaret").textContent="笆ｴ";}
      });
      wrap.appendChild(gBtn);wrap.appendChild(subPanel);btns.appendChild(wrap);
    }else{
      const btn=document.createElement("button");
      btn.className="encounterBtn"+(et.key==="offline"?" encounterBtn--offline":"");
      btn.title=et.desc;btn.textContent=et.label+(et.overrideDurationMs?" ("+Math.round(et.overrideDurationMs/60000)+"蛻・":"");
      btn.addEventListener("click",(e)=>{e.stopPropagation();applyEncounterEvent(r.name,et.key);});
      btns.appendChild(btn);
    }
  }
  panel.appendChild(btns);
  // 繧｢繧ｯ繝・ぅ繝悶↑謇句虚險倬鹸縺後≠繧後・谿九ｊ譎る俣繧定｡ｨ遉ｺ
  if(r.manualEvent){
    const now2=nowMs();
    const rem=manualRem(r.manualEvent);
    const activeEl=document.createElement("div");activeEl.className="encounterActive";
    const et=findEncounterType(r.manualEvent.type);
    activeEl.innerHTML="東 <b>"+(et?et.label:r.manualEvent.type)+"</b> 險倬鹸荳ｭ繝ｻ谿・<b>"+rem+"蛻・/b> 蜆ｪ蜈井ｺ域ｸｬ";
    panel.appendChild(activeEl);
  }
  td.appendChild(panel);
  td.appendChild(buildPlayerSparkEl(r));
  // 笏笏 繝昴う繝ｳ繝域耳遘ｻ繧ｰ繝ｩ繝・笏笏
  const evts=getEvents().filter(e=>e.name.toLowerCase()===r.name.toLowerCase()&&e.delta!=null).slice(-48);
  if(evts.length>=2){
    const chartWrap=document.createElement("div");chartWrap.style.cssText="margin-top:10px;";
    const chartTitle=document.createElement("div");chartTitle.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;";chartTitle.textContent="嶋 繝昴う繝ｳ繝域耳遘ｻ・育峩霑・+evts.length+"蝗橸ｼ・;
    const canvas=document.createElement("canvas");canvas.width=420;canvas.height=80;canvas.style.cssText="width:100%;max-width:420px;height:80px;display:block;border-radius:4px;background:#0a1a2e;";
    chartWrap.appendChild(chartTitle);chartWrap.appendChild(canvas);td.appendChild(chartWrap);
    requestAnimationFrame(()=>{
      const ctx=canvas.getContext("2d");if(!ctx)return;
      const W=canvas.width,H=canvas.height,pad=8;
      const pts=evts.map(e=>e.points).filter(p=>p!=null);
      if(pts.length<2)return;
      const mn=Math.min(...pts),mx=Math.max(...pts),range=mx-mn||1;
      const sx=(i)=>pad+(i/(pts.length-1))*(W-2*pad);
      const sy=(v)=>H-pad-((v-mn)/range)*(H-2*pad);
      ctx.clearRect(0,0,W,H);
      // gradient fill
      const grad=ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0,"rgba(94,168,255,0.3)");grad.addColorStop(1,"rgba(94,168,255,0)");
      ctx.beginPath();ctx.moveTo(sx(0),sy(pts[0]));
      for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
      ctx.lineTo(sx(pts.length-1),H);ctx.lineTo(sx(0),H);ctx.closePath();
      ctx.fillStyle=grad;ctx.fill();
      // line
      ctx.beginPath();ctx.moveTo(sx(0),sy(pts[0]));
      for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
      ctx.strokeStyle="#5ea8ff";ctx.lineWidth=1.5;ctx.stroke();
      // latest point dot
      const lx=sx(pts.length-1),ly=sy(pts[pts.length-1]);
      ctx.beginPath();ctx.arc(lx,ly,3,0,Math.PI*2);ctx.fillStyle="#7eb8ff";ctx.fill();
      // min/max labels
      ctx.font="9px monospace";ctx.fillStyle="#5a7aaa";
      ctx.fillText(mn.toLocaleString(),2,H-2);
      ctx.fillText(mx.toLocaleString(),2,12);
      // current points label
      ctx.font="bold 10px monospace";ctx.fillStyle="#7eb8ff";
      ctx.fillText(pts[pts.length-1].toLocaleString(),Math.max(0,lx-20),Math.max(12,ly-4));
    });
  }
  // 笏笏 繧ｵ繝ｼ繝舌・驕ｸ謚・笏笏
  const regionWrap=document.createElement("div");regionWrap.style.cssText="margin-top:10px;display:flex;align-items:center;gap:8px;";
  const rLabel=document.createElement("span");rLabel.textContent="Server";rLabel.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;";
  const rSel=document.createElement("select");rSel.style.cssText="height:28px;font-size:12px;padding:2px 6px;";
  [["","窶・],["AS","件 AS"],["EU","訣 EU"],["NA","月 NA"]].forEach(([v,l])=>{
    const o=document.createElement("option");o.value=v;o.textContent=l;if((r.region||"")===v)o.selected=true;rSel.appendChild(o);
  });
  rSel.addEventListener("change",()=>{
    const snaps=getSnapshots();const k2=r.name.toLowerCase();
    if(!snaps[k2])snaps[k2]={};snaps[k2].region=rSel.value;saveSnapshots(snaps);
    lastRows=lastRows.map(row=>row.name.toLowerCase()===k2?{...row,region:rSel.value}:row);
    renderTable(lastRows);toast("Server: <b>"+r.name+"</b> 竊・"+(rSel.value||"窶・));
    // 繧ｰ繝ｭ繝ｼ繝舌Ν繝ｪ繧ｹ繝育ｷｨ髮・・ backend 蜷梧悄
    const _rs=getUiSettings();
    {
      const _re=getCommunityList().find(e=>e.name.toLowerCase()===k2);
      if(_re)submitCommunityEntryToGlobal(effectiveGlobalUrl(_rs),{..._re,region:rSel.value});
    }
  });
  regionWrap.appendChild(rLabel);regionWrap.appendChild(rSel);td.appendChild(regionWrap);
  // 笏笏 繝｡繝｢ 笏笏
  const memoWrap=document.createElement("div");memoWrap.style.cssText="margin-top:8px;display:flex;align-items:flex-start;gap:8px;";
  const memoLbl=document.createElement("span");memoLbl.textContent="統 Memo";memoLbl.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;min-width:44px;padding-top:4px;white-space:nowrap;";
  const memoTa=document.createElement("textarea");memoTa.style.cssText="flex:1;height:44px;font-size:12px;padding:4px 6px;background:#0a1a2e;border:1px solid #1e2e40;color:#e7edf5;border-radius:4px;resize:vertical;font-family:inherit;";
  memoTa.value=(getSnapshots()[r.name.toLowerCase()]||{}).memo||"";
  memoTa.placeholder="蛟倶ｺｺ繝｡繝｢・郁・蛻・・縺ｿ陦ｨ遉ｺ・・;
  let _memoTimer=null;
  memoTa.addEventListener("input",()=>{
    clearTimeout(_memoTimer);
    _memoTimer=setTimeout(()=>{
      const snaps=getSnapshots();const k2=r.name.toLowerCase();
      if(!snaps[k2])snaps[k2]={};snaps[k2].memo=memoTa.value;saveSnapshots(snaps);
    },500);
  });
  memoWrap.appendChild(memoLbl);memoWrap.appendChild(memoTa);td.appendChild(memoWrap);
  tr.appendChild(td);return tr;
}
function toggleExpand(r,rowEl,key){
  const next=rowEl.nextElementSibling;
  if(next&&next.classList.contains("expandRow")&&next.dataset.for===key){
    next.remove();expandedRows.delete(key);
    const c=rowEl.querySelector(".expandCaret");if(c)c.textContent="笆ｾ";
  }else{
    expandedRows.add(key);rowEl.insertAdjacentElement("afterend",buildExpandRow(r,key));
    const c=rowEl.querySelector(".expandCaret");if(c)c.textContent="笆ｴ";
  }
}
const estimator={lastHash:null,lastBatchAt:null,lastSnapshot:null,intervals:[],lastChangedRows:0};
let leaderboardCache=[],leaderboardFetching=false;
function fnv1a(str){let h=2166136261;for(let i=0;i<str.length;i++){h=(h^str.charCodeAt(i))>>>0;h=Math.imul(h,16777619)>>>0;}return h>>>0;}
const nowMs=()=>Date.now();
const fmtTs=(ms)=>{
  if(!ms)return"窶・;
  const diff=Date.now()-ms;
  const min=Math.floor(diff/60000);
  const t=new Date(ms).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
  if(min<1)return`<1m (${t})`;
  if(min<60)return`${min}m (${t})`;
  const h=Math.floor(min/60);
  return`${h}h${min%60|0}m (${t})`;
};
const fmtAgo=(ms)=>{
  if(!ms)return"窶・;
  const min=Math.floor((Date.now()-ms)/60000);
  const ago=typeof t==="function"?t("time.ago"):"ago";
  if(min<1)return`< 1m ${ago}`;
  if(min<60)return`${min}m ${ago}`;
  const h=Math.floor(min/60),m=min%60;
  return m>0?`${h}h ${m}m ${ago}`:`${h}h ${ago}`;
};
const clamp01=(x)=>Math.max(0,Math.min(1,x));

function toast(msg){
  const el=document.getElementById("toast");
  el.innerHTML=msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),4500);
}
// 笏笏 繝悶Λ繧ｦ繧ｶ騾夂衍 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
let notifyEnabled=localStorage.getItem("finals_notify")==="1";
async function requestNotifyPermission(){
  if(!("Notification"in window))return false;
  if(Notification.permission==="granted")return true;
  if(Notification.permission==="denied")return false;
  const p=await Notification.requestPermission();
  return p==="granted";
}
function sendNotification(title,body){
  if(!notifyEnabled||Notification.permission!=="granted")return;
  try{new Notification(title,{body,icon:"icon.svg",tag:title,silent:false});}catch{}
}
function setNotifyEnabled(on){
  notifyEnabled=on;
  localStorage.setItem("finals_notify",on?"1":"0");
  const btn=document.getElementById("btnNotify");
  if(btn)btn.title=on?"騾夂衍ON・医け繝ｪ繝・け縺ｧOFF・・:"騾夂衍OFF・医け繝ｪ繝・け縺ｧON・・;
  if(btn)btn.style.opacity=on?"1":"0.45";
}
function setNetHint(text){document.getElementById("netHint").textContent=text||"";}
function setRunning(on){
  running=on;
  document.getElementById("statusDot").className="dot "+(on?"on":"off");
  document.getElementById("runState").textContent=on?"running":"stopped";
}
function loadSettings(){
  try{const raw=localStorage.getItem(LS.settings);if(!raw)return{...DEFAULTS};try{return{...DEFAULTS,...JSON.parse(raw)}}catch{return{...DEFAULTS}}}catch{return{...DEFAULTS}}
}
function saveSettings(s){try{localStorage.setItem(LS.settings,JSON.stringify(s));}catch{}}
function getSnapshots(){try{const raw=localStorage.getItem(LS.snapshots);if(!raw)return{};try{return JSON.parse(raw)}catch{return{}}}catch{return{}}}
function saveSnapshots(s){try{localStorage.setItem(LS.snapshots,JSON.stringify(s));}catch{}}
function getEvents(){const raw=localStorage.getItem(LS.events);if(!raw)return[];try{return JSON.parse(raw)}catch{return[]}}
function pushEvent(ev,maxEvents){
  const events=getEvents();
  events.push(ev);
  const trimmed=events.slice(Math.max(0,events.length-maxEvents));
  localStorage.setItem(LS.events,JSON.stringify(trimmed));
}
// 繧､繝吶Φ繝亥ｱ･豁ｴ縺九ｉ謖・ｮ壹・繝ｬ繧､繝､繝ｼ縺ｮ譛蠕後・繝昴う繝ｳ繝亥､牙虚譎ょ綾繧貞叙蠕・function getLastChangeAtFromEvents(key){
  const events=getEvents();
  for(let i=events.length-1;i>=0;i--){
    const e=events[i];
    if(e.name&&e.name.toLowerCase()===key&&e.delta&&e.delta!==0)return e.ts;
  }
  return null;
}
function parseNames(text){
  const parts=(text||"").split(/[\n,]/g).map(s=>s.trim()).filter(Boolean);
  const seen=new Set();const out=[];
  for(const n of parts){const k=n.toLowerCase();if(seen.has(k))continue;seen.add(k);out.push(n);}
  return out;
}
// 笏笏 繧ｳ繝溘Η繝九ユ繧｣繝ｪ繧ｹ繝茨ｼ医Ο繝ｼ繧ｫ繝ｫ + 繝舌ャ繧ｯ繧ｨ繝ｳ繝牙酔譛滂ｼ・笏笏笏笏笏笏笏笏笏
// entry: { name, region:"AS"|"EU"|"NA"|"", category:"cheater"|"suspicious"|"notable", note, addedAt }
const REGION_LABEL={"AS":"件 AS","EU":"訣 EU","NA":"月 NA","":"倹 荳肴・"};
const REGION_ORDER=["AS","EU","NA",""];
const CAT_LABEL={"cheater":"圻 繝√・繧ｿ繝ｼ","suspicious":"笞・・逍代＞","notable":"早 豕ｨ逶ｮ"};
function getCommunityList(){try{const r=localStorage.getItem(LS.community);if(!r)return[];const a=JSON.parse(r);return Array.isArray(a)?a:[];}catch{return[];}}
function saveCommunityList(list){try{localStorage.setItem(LS.community,JSON.stringify(list));}catch{}}
function addCommunityEntry(entry){
  const list=getCommunityList();
  const key=(entry.name||"").toLowerCase();
  const idx=list.findIndex(e=>e.name.toLowerCase()===key);
  if(idx>=0)list[idx]={...list[idx],...entry,addedAt:list[idx].addedAt};
  else list.push({...entry,addedAt:Date.now()});
  saveCommunityList(list);
  return list;
}
function removeCommunityEntry(name){
  const list=getCommunityList().filter(e=>e.name.toLowerCase()!==name.toLowerCase());
  saveCommunityList(list);return list;
}
function getFilteredCommunity(region){
  const list=getCommunityList();
  return region==="all"?list:list.filter(e=>(e.region||"")===region);
}
async function fetchAndMergeCommunity(globalUrl){
  if(!globalUrl)return;
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/community",{cache:"no-store"});
    if(!r.ok){setGlobalSyncStatus("笞・・蜷梧悄螟ｱ謨・(HTTP "+r.status+")",true);return;}
    const remote=await r.json();
    const arr=Array.isArray(remote)?remote:(remote.entries||[]);
    const localMap=new Map(getCommunityList().map(e=>[e.name.toLowerCase(),e]));
    // 繧ｵ繝ｼ繝舌・繝ｪ繧ｹ繝医ｒ豁｣縺ｨ縺励※蜷梧悄・域耳貂ｬ縺ｪ縺暦ｼ・    // 繝ｻserver 縺ｫ辟｡縺・お繝ｳ繝医Μ縺ｯ髯､螟厄ｼ亥炎髯､蜿肴丐・・    // 繝ｻserver 縺ｫ縺ゅｋ繧ｨ繝ｳ繝医Μ縺ｯ謗｡逕ｨ縲ゅ◆縺縺・local 縺ｮ updatedAt 縺後ｈ繧頑眠縺励￠繧後・ local 蜆ｪ蜈・    //   ・・ubmitCommunityEntryToGlobal 逶ｴ蠕後↑縺ｩ縲√し繝ｼ繝舌・縺ｸ縺ｮ蜿肴丐蜑阪ｒ菫晁ｭｷ縺吶ｋ縺溘ａ・・    const merged=arr.map(re=>{
      const k=re.name.toLowerCase();
      const loc=localMap.get(k);
      if(loc&&loc.updatedAt&&re.updatedAt&&loc.updatedAt>re.updatedAt)return loc;
      return re;
    });
    saveCommunityList(merged);
  }catch(e){
    setGlobalSyncStatus("笞・・蜷梧悄繧ｨ繝ｩ繝ｼ",true);
    console.error("fetchAndMergeCommunity:",e);
  }
}
// 繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ・育憾諷九ち繧､繝溘Φ繧ｰ・峨ｒ繝舌ャ繧ｯ繧ｨ繝ｳ繝峨→螳壽悄蜷梧悄
// 雋ｬ蜍・ /community = 蜈ｱ譛峨Μ繧ｹ繝域悽菴薙・snapshots = 迥ｶ諷句・譛会ｼ・astChangeAt timing・・// 繝昴・繝ｪ繝ｳ繧ｰ縺ｧ逶ｴ謗･蜿門ｾ励＠縺・points/state 縺ｯ荳頑嶌縺阪＠縺ｪ縺・ＭastChangeAt timing 縺ｮ縺ｿ譖ｴ譁ｰ縺吶ｋ
async function fetchAndMergeSnapshots(globalUrl){
  if(!globalUrl)return;
  try{
    const remote=await fetchGlobalSnapshots(globalUrl);
    if(!remote||typeof remote!=="object")return;
    const local=getSnapshots();
    let changed=false;
    const now=Date.now();
    const remoteTs=s=>Math.max(
      s?.lastOkAt||0,
      s?.lastRealChangeAt||0,
      s?.lastChangeAt||0,
      s?.updatedAt||0,
      0
    );
    const localTs=s=>Math.max(
      s?.lastOkAt||0,
      s?.lastRealChangeAt||0,
      s?.lastChangeAt||0,
      0
    );
    for(const [key,remSnap] of Object.entries(remote)){
      if(!remSnap||typeof remSnap!=="object")continue;
      const locSnap=local[key]||{};
      const rts=remoteTs(remSnap);
      const lts=localTs(locSnap);
      if(rts<=0)continue;
      if(rts<lts)continue;
      const merged={
        ...locSnap,
        ...remSnap,
        ...(locSnap.manualEvent?{manualEvent:locSnap.manualEvent}:{}),
      };
      if(!merged.lastChangeAt&&remSnap.lastChangeAt)merged.lastChangeAt=remSnap.lastChangeAt;
      if(!merged.lastRealChangeAt&&remSnap.lastRealChangeAt)merged.lastRealChangeAt=remSnap.lastRealChangeAt;
      if(!merged.lastOkAt&&rts)merged.lastOkAt=rts||now;
      local[key]=merged;
      changed=true;
    }
    if(changed)saveSnapshots(local);
  }catch(e){
    console.error("fetchAndMergeSnapshots:",e);
  }
}
// 笏笏 繧ｰ繝ｭ繝ｼ繝舌Ν繝舌ャ繧ｯ繧ｨ繝ｳ繝・API 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
async function fetchGlobalNames(globalUrl){
  const r=await fetch(globalUrl.replace(/\/$/,"")+"/names",{cache:"no-store"});
  if(!r.ok)throw new Error("global /names failed: "+r.status);
  const d=await r.json();return Array.isArray(d)?d:(d.names||[]);
}
async function fetchGlobalSnapshots(globalUrl){
  try{const r=await fetch(globalUrl.replace(/\/$/,"")+"/snapshots",{cache:"no-store"});if(!r.ok)return{};return await r.json();}catch{return{};}
}
// UI 繧ｨ繝ｩ繝ｼ陦ｨ遉ｺ繝倥Ν繝代・・・globalStatus 縺ｫ譛螟ｧ10遘定｡ｨ遉ｺ・・function setGlobalSyncStatus(msg,isError=false){
  const el=document.getElementById("globalStatus");
  if(!el)return;
  el.textContent=msg;
  el.style.color=isError?"#ff6b6b":"";
  if(isError)setTimeout(()=>{if(el.textContent===msg)el.style.color="";},10000);
}
// 譖ｸ縺崎ｾｼ縺ｿ繝ｪ繧ｯ繧ｨ繧ｹ繝育畑繝倥ャ繝繝ｼ
// 蜆ｪ蜈磯・ｽ・ admin hash 竊・繝ｭ繧ｰ繧､繝ｳ荳ｭ allowed user 縺ｮ hash 竊・辟｡縺暦ｼ域悴繝ｭ繧ｰ繧､繝ｳ・・function getWriteHeaders(){
  const h={"Content-Type":"application/json"};
  const auth=getAuthData();
  if(auth.adminPasswordHash){
    h["X-Write-Key"]=auth.adminPasswordHash;
    return h;
  }
  if(currentUser){
    const allowed=getEffectiveAllowedUsers();
    if(Array.isArray(allowed)){
      const u=allowed.find(u=>u.id&&u.id.toLowerCase()===currentUser.id.toLowerCase());
      if(u&&u.passwordHash)h["X-Write-Key"]=u.passwordHash;
    }
    if(!h["X-Write-Key"]&&Array.isArray(auth.allowedUsers)){
      const u=auth.allowedUsers.find(u=>u.id&&u.id.toLowerCase()===currentUser.id.toLowerCase());
      if(u&&u.passwordHash)h["X-Write-Key"]=u.passwordHash;
    }
  }
  return h;
}
async function submitSnapshotToGlobal(globalUrl,name,snap){
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/submit",{
      method:"POST",
      headers:getWriteHeaders(),
      body:JSON.stringify({name,snapshot:{...snap,updatedAt:Date.now()}})
    });
    if(!r.ok){
      console.error("submitSnapshotToGlobal",name,"HTTP",r.status);
      return false;
    }
    return true;
  }catch(e){
    console.error("submitSnapshotToGlobal",name,e);
    return false;
  }
}
async function addNameToGlobal(globalUrl,name){
  try{await fetch(globalUrl.replace(/\/$/,"")+"/names",{method:"POST",headers:getWriteHeaders(),body:JSON.stringify({name})});}catch{}
}
// 迥ｶ諷句・譛峨・騾∽ｿ｡蝗樊焚繧呈ｸ帙ｉ縺吶◆繧√∝燕蝗樣∽ｿ｡蜀・ｮｹ縺ｨ蜷御ｸ縺ｪ繧・/submit 繧偵せ繧ｭ繝・・
const snapshotSubmitCache=new Map();
function buildSnapshotSubmitPayload(snap){
  return {
    points:snap?.points??null,
    lastDelta:snap?.lastDelta??null,
    lastChangeAt:snap?.lastChangeAt??null,
    lastRealChangeAt:snap?.lastRealChangeAt??null,
    lastOkAt:snap?.lastOkAt??null,
    leaderboardRank:snap?.leaderboardRank??null,
    league:snap?.league??null,
    region:snap?.region??"",
    notFoundCount:snap?.notFoundCount??0,
    lastFoundAt:snap?.lastFoundAt??null,
    suspectedReason:snap?.suspectedReason??null,
    suspectedNewName:snap?.suspectedNewName??null,
    manualEvent:snap?.manualEvent??null,
  };
}
function shouldSubmitSnapshot(name,snap){
  const payload=buildSnapshotSubmitPayload(snap);
  const serialized=JSON.stringify(payload);
  const prev=snapshotSubmitCache.get(name);
  if(prev===serialized)return null;
  snapshotSubmitCache.set(name,serialized);
  return payload;
}
async function maybeSubmitSnapshotToGlobal(globalUrl,name,snap){
  const payload=shouldSubmitSnapshot(name,snap);
  if(!payload)return false;
  return submitSnapshotToGlobal(globalUrl,name,payload);
}
// 繧ｳ繝溘Η繝九ユ繧｣繧ｨ繝ｳ繝医Μ繧偵ヰ繝・け繧ｨ繝ｳ繝峨・ /community 縺ｫ騾∽ｿ｡・井ｻ悶Θ繝ｼ繧ｶ繝ｼ縺ｸ蜊ｳ譎ょ渚譏・・// /community 縺ｯ蜈ｱ譛峨Μ繧ｹ繝域悽菴薙・縺ｿ・・tatus/lastSeen 遲峨・迥ｶ諷九・ /submit 縺ｧ邂｡逅・ｼ・// updatedAt / sourceUser 繧剃ｻ倅ｸ弱＠縺ｦ worker 蛛ｴ縺ｮ譚｡莉ｶ merge 繧呈怏蜉ｹ縺ｫ縺吶ｋ
async function submitCommunityEntryToGlobal(globalUrl,entry){
  try{
    const now=Date.now();
    const payload={
      name:       entry.name,
      region:     entry.region     || "",
      category:   entry.category   || "notable",
      note:       entry.note       || "",
      addedAt:    entry.addedAt    || now,
      updatedAt:  entry.updatedAt  || now,  // merge 蛻､螳夂畑繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝・      sourceUser: currentUser?.id  || "",   // 譖ｸ縺崎ｾｼ繧薙□繝ｦ繝ｼ繧ｶ繝ｼID
      // status / lastSeen 縺ｯ /submit (snapshots) 縺ｧ邂｡逅・☆繧九◆繧√％縺薙↓縺ｯ蜷ｫ繧√↑縺・    };
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/community",{method:"POST",headers:getWriteHeaders(),body:JSON.stringify(payload)});
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      setGlobalSyncStatus("笞・・霑ｽ蜉螟ｱ謨・ "+(err.error||r.status),true);
      console.error("submitCommunityEntryToGlobal HTTP",r.status,err);
    }
  }catch(e){
    setGlobalSyncStatus("笞・・霑ｽ蜉繧ｨ繝ｩ繝ｼ",true);
    console.error("submitCommunityEntryToGlobal:",e);
  }
}
// 繧ｳ繝溘Η繝九ユ繧｣繧ｨ繝ｳ繝医Μ繧偵ヰ繝・け繧ｨ繝ｳ繝峨°繧牙炎髯､
async function deleteCommunityEntryFromGlobal(globalUrl,name){
  // 繧ｵ繝ｼ繝舌・蜑企勁縺ｮ謌仙凄繧・boolean 縺ｧ霑斐☆・亥他縺ｳ蜃ｺ縺怜・縺後Ο繝ｼ繧ｫ繝ｫ蜑企勁繧貞宛蠕｡縺吶ｋ縺溘ａ・・  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/community?name="+encodeURIComponent(name),{method:"DELETE",headers:getWriteHeaders()});
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      setGlobalSyncStatus("笞・・蜑企勁螟ｱ謨・ "+(err.error||r.status),true);
      console.error("deleteCommunityEntryFromGlobal HTTP",r.status,err);
      return false;
    }
    return true;
  }catch(e){
    setGlobalSyncStatus("笞・・蜑企勁繧ｨ繝ｩ繝ｼ",true);
    console.error("deleteCommunityEntryFromGlobal:",e);
    return false;
  }
}
// 驕ｭ驕・ち繧､繝・ group:true 縺ｮ繧ゅ・縺ｯ sub[] 繧偵ラ繝ｭ繝・・繝繧ｦ繝ｳ陦ｨ遉ｺ
const ENCOUNTER_TYPES=[
  {key:"won",       label:"醇 蜍晏茜",     desc:"隧ｦ蜷医↓蜍晏茜縺励◆・亥叉繝ｭ繝薙・縺ｸ・・,     getOffset:s=>0},
  {key:"final_end", label:"逐 FINAL邨ゆｺ・, desc:"FINAL繝ｩ繧ｦ繝ｳ繝臥ｵゆｺ・ｼ郁ｲ縺托ｼ・,        getOffset:s=>0},
  {key:"r1", label:"R1", desc:"繝ｩ繧ｦ繝ｳ繝・縺ｧ驕ｭ驕・, group:true, sub:[
    {key:"r1_early", label:"蠎冗乢", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r1_mid",   label:"荳ｭ逶､", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r1_late",  label:"邨ら乢", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  {key:"r2", label:"R2", desc:"繝ｩ繧ｦ繝ｳ繝・縺ｧ驕ｭ驕・, group:true, sub:[
    {key:"r2_early", label:"蠎冗乢", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r2_mid",   label:"荳ｭ逶､", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r2_late",  label:"邨ら乢", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  // 繧ｪ繝輔Λ繧､繝ｳ縺ｮ縺ｿ譛牙柑譛滄俣5蛻・崋螳壹・offset 縺ｯ蠢・★OFFLINE迥ｶ諷九↓縺ｪ繧句､
  {key:"offline", label:"笞ｫ 繧ｪ繝輔Λ繧､繝ｳ", desc:"繧ｪ繝輔Λ繧､繝ｳ遒ｺ隱搾ｼ・蛻・・縺ｿ譛牙柑・・, overrideDurationMs:300000, getOffset:s=>s.reflectDelayMin+s.tournamentTotalMin+30},
];
// 繧ｵ繝悶ち繧､繝励ｒ蜷ｫ繧繝輔Λ繝・ヨ讀懃ｴ｢
function findEncounterType(key){
  for(const et of ENCOUNTER_TYPES){
    if(et.key===key)return et;
    if(et.sub){const s=et.sub.find(s=>s.key===key);if(s)return s;}
  }
  return null;
}
// manualEvent 譛牙柑譛滄俣繝倥Ν繝代・・・verrideDurationMs 縺梧悴險ｭ螳壹↑繧・1譎る俣・・function isManualActive(me){if(!me)return false;return(nowMs()-me.recordedAt)<(me.overrideDurationMs??3600000);}
function manualRem(me){if(!me)return 0;return Math.max(0,Math.round(((me.recordedAt+(me.overrideDurationMs??3600000))-nowMs())/60000));}
// offline / won / final_end 縺ｯ縲碁・驕・ｸｭ縲阪〒縺ｯ縺ｪ縺・・縺ｧ danger 謇ｱ縺・＠縺ｪ縺・function isEncounterDanger(me){return isManualActive(me)&&me.type!=="offline"&&me.type!=="won"&&me.type!=="final_end";}

// 笏笏 隱崎ｨｼ・・D + 繝代せ繝ｯ繝ｼ繝牙宛髯撰ｼ・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
// SHA-256 繝上ャ繧ｷ繝･・・eb Crypto API・・async function sha256(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
// 隱崎ｨｼ繝・・繧ｿ隱ｭ縺ｿ譖ｸ縺搾ｼ・S.auth・・function getAuthData(){
  try{const r=localStorage.getItem(LS.auth);return r?JSON.parse(r):{adminPasswordHash:"",allowedUsers:[]};}
  catch{return{adminPasswordHash:"",allowedUsers:[]};}
}
function saveAuthData(d){try{localStorage.setItem(LS.auth,JSON.stringify(d));}catch{}}

// 繧ｻ繝・す繝ｧ繝ｳ・・n-memory: 繝壹・繧ｸ繝ｪ繝ｭ繝ｼ繝峨〒繧ｯ繝ｪ繧｢・・let currentUser=null; // {id:string} | null
function isLoggedIn(){return currentUser!==null;}
function setCurrentUser(id){
  currentUser=id?{id}:null;
  if(id)localStorage.setItem(LS.session,id);
  else localStorage.removeItem(LS.session);
  updateLoginStatus();
}
function restoreSession(){
  const saved=localStorage.getItem(LS.session);
  if(saved)currentUser={id:saved};
}
function updateLoginStatus(){
  // 繧ｰ繝ｭ繝ｼ繝舌Ν繝ｪ繧ｹ繝亥・縺ｮ繧ｹ繝・・繧ｿ繧ｹ繝舌・
  const bar=document.getElementById("loginStatusBar");
  if(bar){
    if(getEffectiveAllowedUsers().length===0){bar.style.display="none";}
    else{
      bar.style.display="flex";
      document.getElementById("loginStatusText").textContent=
        currentUser?t("login.status.in")+currentUser.id:t("login.status.req");
      const logoutBtn=document.getElementById("btnLogout");
      if(logoutBtn)logoutBtn.style.display=currentUser?"":"none";
    }
  }
  // 繝倥ャ繝繝ｼ縺ｮ繝ｭ繧ｰ繧､繝ｳ繝懊ち繝ｳ
  const headerUserInfo=document.getElementById("headerUserInfo");
  const btnHeaderLogout=document.getElementById("btnHeaderLogout");
  const btnHeaderLogin=document.getElementById("btnHeaderLogin");
  if(!headerUserInfo)return;
  if(currentUser){
    headerUserInfo.textContent="側 "+currentUser.id;
    headerUserInfo.style.display="";
    btnHeaderLogout.style.display="";
    btnHeaderLogin.style.display="none";
  }else{
    headerUserInfo.style.display="none";
    btnHeaderLogout.style.display="none";
    btnHeaderLogin.style.display="";
  }
}

// 笏笏 繝舌ャ繧ｯ繧ｨ繝ｳ繝芽ｪ崎ｨｼ蜷梧悄 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
// 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨°繧芽ｨｱ蜿ｯ繝ｦ繝ｼ繧ｶ繝ｼ繝ｪ繧ｹ繝医ｒ蜿門ｾ励＠縺ｦ繧ｻ繝・す繝ｧ繝ｳ螟画焚縺ｫ菫晄戟
let _backendAllowedUsers=null; // null = 譛ｪ繝輔ぉ繝・メ or globalUrl 縺ｪ縺・async function fetchAuthConfig(globalUrl){
  if(!globalUrl)return;
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/auth",{cache:"no-store"});
    if(!r.ok)return;
    const d=await r.json();
    if(Array.isArray(d.allowedUsers)){
      _backendAllowedUsers=d.allowedUsers;
      const auth=getAuthData();
      auth.allowedUsers=d.allowedUsers;
      saveAuthData(auth);
      if(currentUser&&d.allowedUsers.length>0&&!d.allowedUsers.find(u=>u.id.toLowerCase()===currentUser.id.toLowerCase())){
        setCurrentUser(null);
      }
      renderAllowedUserList();
      updateLoginStatus();
    }
  }catch{}
}
// 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓隱崎ｨｼ險ｭ螳壹ｒ蜷梧悄・医い繝峨Α繝ｳ繝代ロ繝ｫ縺ｮ繝懊ち繝ｳ縺九ｉ蜻ｼ縺ｶ・・async function syncAuthToBackend(globalUrl,adminPasswordHash,allowedUsers){
  if(!globalUrl)return false;
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/auth",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({adminPasswordHash,allowedUsers})
    });
    return r.ok;
  }catch{return false;}
}
// 譛牙柑縺ｪ險ｱ蜿ｯ繝ｦ繝ｼ繧ｶ繝ｼ繝ｪ繧ｹ繝医ｒ霑斐☆・医ヰ繝・け繧ｨ繝ｳ繝牙━蜈医’allback 縺ｯ繝ｭ繝ｼ繧ｫ繝ｫ・・function getEffectiveAllowedUsers(){
  if(_backendAllowedUsers!==null)return _backendAllowedUsers;
  return getAuthData().allowedUsers;
}

// 繝ｭ繧ｰ繧､繝ｳ繝｢繝ｼ繝繝ｫ蛻ｶ蠕｡
let _loginCallback=null;
function showLoginModal(onSuccess){
  _loginCallback=onSuccess;
  document.getElementById("loginId").value="";
  document.getElementById("loginPassword").value="";
  document.getElementById("loginError").textContent="";
  document.getElementById("loginModal").style.display="flex";
  setTimeout(()=>document.getElementById("loginId").focus(),50);
}
function hideLoginModal(){
  document.getElementById("loginModal").style.display="none";
  _loginCallback=null;
}

// 險ｱ蜿ｯ繝ｦ繝ｼ繧ｶ繝ｼ荳隕ｧ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ・医い繝峨Α繝ｳ繝代ロ繝ｫ蜀・ｼ・function renderAllowedUserList(){
  const auth=getAuthData();
  const el=document.getElementById("allowedUserList");
  if(!el)return;
  if(auth.allowedUsers.length===0){
    el.innerHTML="<div class='hint' style='margin:6px 0'>險ｱ蜿ｯ繝ｦ繝ｼ繧ｶ繝ｼ縺ｪ縺暦ｼ育ｩｺ縺ｮ蝣ｴ蜷医・隱ｰ縺ｧ繧りｿｽ蜉蜿ｯ閭ｽ・・/div>";
    return;
  }
  el.innerHTML=auth.allowedUsers.map(u=>
    `<div class="allowedUserRow"><span class="allowedUserId">${u.id}</span>`+
    `<button class="deleteBtn allowedDelBtn" data-id="${u.id}" title="${u.id}繧貞炎髯､">笨・/button></div>`
  ).join("");
  el.querySelectorAll(".allowedDelBtn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const a=getAuthData();
      a.allowedUsers=a.allowedUsers.filter(u=>u.id!==btn.dataset.id);
      saveAuthData(a);
      renderAllowedUserList();
      updateLoginStatus();
    });
  });
}
function applyEncounterEvent(name,typeKey){
  const settings=currentSettings||getUiSettings();
  const et=findEncounterType(typeKey);
  if(!et||et.group)return; // group繝懊ち繝ｳ閾ｪ菴薙・辟｡隕厄ｼ医し繝悶・繧ｿ繝ｳ縺ｧ蜻ｼ縺ｶ・・  const now=nowMs();
  const offsetMin=et.getOffset(settings);
  const lastChangeAtOverride=now-offsetMin*60000;
  const snapshots=getSnapshots();
  const key=name.toLowerCase();
  if(!snapshots[key])snapshots[key]={};
  const dur=et.overrideDurationMs??3600000;
  snapshots[key].manualEvent={type:typeKey,recordedAt:now,lastChangeAtOverride,overrideDurationMs:dur};
  saveSnapshots(snapshots);
  const durMin=Math.round(dur/60000);
  toast(et.label+" <b>"+name+"</b> 繧定ｨ倬鹸 (offset -"+offsetMin+"蛻・/ "+durMin+"蛻・━蜈・");
  // API蜻ｼ縺ｳ蜃ｺ縺励↑縺・竊・繧ｭ繝｣繝・す繝･陦後ｒ縺昴・蝣ｴ縺ｧ譖ｴ譁ｰ縺励※蜊ｳ譎ょ・謠冗判・医ヵ繝ｩ繝・す繝･縺ｪ縺暦ｼ・  if(lastRows.length>0){
    const manualEventObj={type:typeKey,recordedAt:now,lastChangeAtOverride,overrideDurationMs:dur};
    const updatedRows=lastRows.map(r=>{
      if(r.name.toLowerCase()!==key)return r;
      const inf=typeKey==="offline"?{state:"OFFLINE",nextMatchProb:0}:inferState(now,lastChangeAtOverride,r.reflectDelayMin,r.matchWaitMin,r.matchAvgMin,r.matchJitterMin,r.tournamentTotalMin,true);
      return {...r,manualEvent:manualEventObj,effectiveLCA:lastChangeAtOverride,state:inf.state,nextMatchProb:inf.nextMatchProb};
    });
    lastRows=updatedRows;
    renderTable(updatedRows);renderSpark(updatedRows);
  }else if(running&&currentSettings){
    pollOnce(getActiveNames(),currentSettings);
  }
}
function getActiveNames(){
  const personal=parseNames(document.getElementById("namesBox").value);
  const community=getCommunityList().map(e=>e.name);

  if(viewMode==="global"){
    const seen=new Set();
    const out=[];
    for(const n of community){
      const k=n.toLowerCase();
      if(!seen.has(k)){seen.add(k);out.push(n);}
    }
    return out;
  }

  const seen=new Set();
  const out=[];
  for(const n of personal){
    const k=n.toLowerCase();
    if(!seen.has(k)){seen.add(k);out.push(n);}
  }
  return out;
}
// 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function applySettingsToUi(s){
  document.getElementById("leaderboardId").value=s.leaderboardId||"s9";
  document.getElementById("platform").value=s.platform||"crossplay";
  document.getElementById("pollInterval").value=String(s.pollIntervalSec||60);
  document.getElementById("reflectDelay").value=String(s.reflectDelayMin||8);
  document.getElementById("matchWait").value=String(s.matchWaitMin??5);
  document.getElementById("matchAvg").value=String(s.matchAvgMin||31);
  document.getElementById("matchJitter").value=String(s.matchJitterMin??3);
  document.getElementById("tournamentTotal").value=String(s.tournamentTotalMin||45);
  if(document.getElementById("enableEstimator")){
    document.getElementById("enableEstimator").checked=!!s.estimatorEnabled;
    document.getElementById("estWindowStart").value=String(s.estWindowStart??2000);
    document.getElementById("estWindowSize").value=String(s.estWindowSize??500);
    document.getElementById("estCacheSec").value=String(s.estCacheSec??30);
  }
  document.getElementById("maxEvents").value=String(s.maxEvents||5000);
  if(document.getElementById("rsDropThreshold")) document.getElementById("rsDropThreshold").value=String(s.rsDropThreshold??1000);
}
function getUiSettings(){
  return{
    leaderboardId:document.getElementById("leaderboardId").value,
    platform:document.getElementById("platform").value,
    pollIntervalSec:parseInt(document.getElementById("pollInterval").value,10),
    reflectDelayMin:parseInt(document.getElementById("reflectDelay").value,10),
    matchWaitMin:parseInt(document.getElementById("matchWait").value,10),
    matchAvgMin:parseInt(document.getElementById("matchAvg").value,10),
    matchJitterMin:parseInt(document.getElementById("matchJitter").value,10),
    tournamentTotalMin:parseInt(document.getElementById("tournamentTotal").value,10),
    estimatorEnabled:document.getElementById("enableEstimator")?document.getElementById("enableEstimator").checked:false,
    estWindowStart:document.getElementById("estWindowStart")?parseInt(document.getElementById("estWindowStart").value,10):2000,
    estWindowSize:document.getElementById("estWindowSize")?parseInt(document.getElementById("estWindowSize").value,10):500,
    estCacheSec:document.getElementById("estCacheSec")?parseInt(document.getElementById("estCacheSec").value,10):30,
    maxEvents:parseInt(document.getElementById("maxEvents").value,10),
    rsDropThreshold:document.getElementById("rsDropThreshold")?Math.abs(parseInt(document.getElementById("rsDropThreshold").value,10)||1000):1000,
  };
}
function getLeagueFromEntry(entry){
  if(!entry||typeof entry!=="object")return null;
  const candidates=["league","leagueName","tier","tierName","rankTier","rank_tier","badge","leagueLabel"];
  for(const k of candidates){if(typeof entry[k]==="string"&&entry[k].trim())return entry[k].trim();}
  if(typeof entry.leagueNumber==="number"){
    const leagues=["Bronze","Silver","Gold","Platinum","Diamond","Ruby"];
    return leagues[entry.leagueNumber]||null;
  }
  return null;
}
function inferLeagueFromRank(rank){
  if(!rank)return null;
  if(rank<=500)return"Ruby";
  if(rank<=2000)return"Diamond";
  if(rank<=10000)return"Platinum";
  if(rank<=30000)return"Gold";
  if(rank<=100000)return"Silver";
  return"Bronze";
}
function getAltNamesFromEntry(entry){
  if(!entry||typeof entry!=="object")return{steam:null,psn:null,xbox:null};
  return{
    steam:(typeof entry.steamName==="string"&&entry.steamName.trim())?entry.steamName.trim():null,
    psn:(typeof entry.psnName==="string"&&entry.psnName.trim())?entry.psnName.trim():null,
    xbox:(typeof entry.xboxName==="string"&&entry.xboxName.trim())?entry.xboxName.trim():null
  };
}
function findByAltNames(altNames){
  if(!altNames||!leaderboardCache.length)return null;
  const s=(altNames.steam||"").toLowerCase();
  const p=(altNames.psn||"").toLowerCase();
  const x=(altNames.xbox||"").toLowerCase();
  for(const e of leaderboardCache){
    const es=(e.steamName||"").toLowerCase();
    const ep=(e.psnName||"").toLowerCase();
    const ex=(e.xboxName||"").toLowerCase();
    if((s&&es&&s===es)||(p&&ep&&p===ep)||(x&&ex&&x===ex))return e;
  }
  return null;
}
const STATE_I18N_KEY={
  POST_MATCH_WAIT:    "state.LOBBY",
  LOBBY:              "state.LOBBY",
  IN_MATCH:           "state.IN_MATCH_R1",
  IN_TOURNAMENT_DEEP: "state.IN_MATCH_R2",
  RETURNING:          "state.FINAL",
  OFFLINE:            "state.OFFLINE",
  UNKNOWN:            "state.UNKNOWN",
  NOT_FOUND:          "state.NOT_FOUND",
  BANNED:             "state.BANNED",
  NAME_CHANGED:       "state.NAME_CHANGED",
};
function stateLabel(s){return(typeof t==="function"?t(STATE_I18N_KEY[s]||"state.UNKNOWN"):s)||s;}
function renderBadge(rank,league){
  const tier=league||inferLeagueFromRank(rank);
  const rankStr=rank?"#"+rank.toLocaleString():"窶・;
  const badge=tier?`<span class="badge badge-${tier.toLowerCase()}">${tier}</span>`:"";
  return `${badge}<span class="rankNum">${rankStr}</span>`;
}
function getPointsFromEntry(entry){
  const candidates=[];const keys=["rankScore","rank_score","rankscore","score","points","famePoints","rs","fp"];
  for(const k of keys){if(entry&&typeof entry[k]==="number")candidates.push(entry[k]);}
  if(entry&&entry.stats&&typeof entry.stats==="object"){for(const k of keys){if(typeof entry.stats[k]==="number")candidates.push(entry.stats[k]);}}
  if(candidates.length)return Math.max(...candidates);
  if(entry&&typeof entry==="object"){
    for(const [k,v] of Object.entries(entry)){
      if(typeof v!=="number")continue;
      const kk=k.toLowerCase();
      if(kk.includes("score")||kk.includes("point")||kk.includes("fame")||kk==="rs")candidates.push(v);
    }
  }
  if(candidates.length)return Math.max(...candidates);
  return null;
}
function inferState(now,lastChangeAtMs,reflectDelayMin,matchWaitMin,matchAvgMin,matchJitterMin,tournamentTotalMin,skipOffline20=false){
  if(!lastChangeAtMs) return { state:"UNKNOWN", nextMatchProb:0 };

  const tMin = (now - lastChangeAtMs) / 60000;
  const X = reflectDelayMin;

  if(!skipOffline20){
    // 竭 繝舌ャ繝∵､懷・貂医∩・嗟astBatchAt 縺・lastChangeAt 繧医ｊ 5蛻・ｻ･荳頑眠縺励＞
    //    竊・譛譁ｰ繝舌ャ繝√〒縺薙・繝励Ξ繧､繝､繝ｼ縺ｮ繝昴う繝ｳ繝亥､牙虚縺ｪ縺・= OFFLINE遒ｺ螳・    const lastBatch = estimator.lastBatchAt;
    const BATCH_BUF_MS = 5 * 60 * 1000; // 繝昴・繝ｪ繝ｳ繧ｰ繧ｺ繝ｬ蜷ｸ蜿弱ヰ繝・ヵ繧｡
    if(lastBatch && lastBatch > lastChangeAtMs + BATCH_BUF_MS){
      return { state:"OFFLINE", nextMatchProb:0 };
    }
    // 竭｡ 繝舌ャ繝√ョ繝ｼ繧ｿ縺ｪ縺暦ｼ医お繧ｹ繝・ぅ繝｡繝ｼ繧ｿ繝ｼ譛ｪ襍ｷ蜍包ｼ俄・ 譎る俣繝吶・繧ｹ縺ｮ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・・0蛻・崋螳夲ｼ・    if(!lastBatch && tMin >= 20) return { state:"OFFLINE", nextMatchProb:0 };
  }
  const W = Math.max(0, Math.min(30, matchWaitMin ?? 5));   // lobby/queue wait before next match
  const M = Math.max(20, Math.min(60, matchAvgMin || 31));  // minimum match duration (31min fastest)
  const J = Math.max(0, Math.min(10, matchJitterMin ?? 3)); // +jitter tolerance (one-sided)
  const T = Math.max(M + W + 5, Math.min(180, tournamentTotalMin || 70));

  // State transitions
  let state = "LOBBY";
  if(tMin < X)                 state = "POST_MATCH_WAIT";
  else if(tMin < X + W)        state = "LOBBY";              // queuing for next match
  else if(tMin < X + W + M)    state = "IN_MATCH";           // minimum 31min not elapsed 竊・in match
  else if(tMin < X + W + M + J) state = "IN_MATCH";          // +3min gray zone
  else if(tMin < X + T)        state = "IN_TOURNAMENT_DEEP";
  else if(tMin < X + T + 25)   state = "RETURNING";
  else                         state = "OFFLINE";

  // next_match%: peaks at (X+W) = when next match is expected to start
  const peak = X + W;
  const matchEnd = X + W + M + J;
  let p = 0;
  if(tMin < X) {
    p = 0.05 * (tMin / Math.max(1, X));
  } else if(tMin <= peak) {
    p = 0.10 + 0.90 * ((tMin - X) / Math.max(1, W));
  } else if(tMin <= peak + M * 0.25) {
    p = 1.00 - 0.55 * ((tMin - peak) / Math.max(1, M * 0.25));
  } else if(tMin <= matchEnd) {
    p = 0.45 - 0.25 * ((tMin - (peak + M * 0.25)) / Math.max(1, matchEnd - peak - M * 0.25));
  } else if(tMin <= X + T) {
    p = 0.20 - 0.10 * ((tMin - matchEnd) / Math.max(1, X + T - matchEnd));
  } else {
    p = 0.05;
  }

  p = Math.min(0.80, clamp01(p)); // 譛鬮・0%・・00%蜑肴署縺ｮ隕九∴譁ｹ繧帝∩縺代ｋ・・  return { state, nextMatchProb: Math.round(p * 100) };
}

function isCorsLikeError(msg){
  const m=String(msg||"");
  return m.includes("Failed to fetch")||m.includes("NetworkError")||m.includes("CORS");
}
async function fetchPlayer(proxyBase,leaderboardId,platform,name){
  const qp=new URLSearchParams({name,leaderboardId,platform});
  if(proxyBase){
    const url=proxyBase+"/api/player?"+qp.toString();
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok)throw new Error("proxy fetch failed: "+r.status);
    return await r.json();
  }else{
    const url="https://api.the-finals-leaderboard.com/v1/leaderboard/"+encodeURIComponent(leaderboardId)+"/"+encodeURIComponent(platform)+"?name="+encodeURIComponent(name);
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok)throw new Error("direct fetch failed: "+r.status);
    return await r.json();
  }
}
function renderTable(rows){
  const tbody=document.getElementById("tbody");tbody.innerHTML="";
  let filtered=rows;
  // viewMode 縺ｫ蠢懊§縺ｦ陦ｨ遉ｺ繝励Ξ繧､繝､繝ｼ繧堤ｵ槭ｊ霎ｼ繧・医・繝ｼ繝ｪ繝ｳ繧ｰ縺ｯ荳｡繝ｪ繧ｹ繝亥・騾夲ｼ・  if(viewMode==="personal"){
    const pset=new Set(parseNames(document.getElementById("namesBox").value).map(n=>n.toLowerCase()));
    filtered=filtered.filter(r=>pset.has(r.name.toLowerCase()));
  }else if(viewMode==="global"){
    const gset=new Set(getFilteredCommunity(globalFilter).map(e=>e.name.toLowerCase()));
    filtered=filtered.filter(r=>gset.has(r.name.toLowerCase()));
  }
  if(liveTabMode==="pickup") filtered=filtered.filter(r=>pickedUp.has(r.name.toLowerCase()));
  if(liveRegionFilter!=="all") filtered=filtered.filter(r=>(r.region||"")===liveRegionFilter);
  if(liveSearchQuery) filtered=filtered.filter(r=>r.name.toLowerCase().includes(liveSearchQuery));
  personalRegionFilter=liveRegionFilter;
  for(const r of filtered){
    const isMissing=r.notFoundCount>=3&&r.lastFoundAt;
    const isBan=isMissing&&r.suspectedReason==="BAN";
    const isNameChange=isMissing&&r.suspectedReason==="NAME_CHANGE";
    const displayState=isBan?"BANNED":isNameChange?"NAME_CHANGED":isMissing?"NOT_FOUND":r.state;
    const statusBadge=isBan
      ?'<span class="badge" style="background:#2a0808;color:#ff5555;border-color:#7a1a1a;margin:0 5px 0 2px">笵・BAN</span>'
      :isNameChange
        ?'<span class="badge" style="background:#082030;color:#6de9ff;border-color:#1e5a8a;margin:0 5px 0 2px">鳩 NC</span>'
        :"";
    const missingBadge=(!isBan&&!isNameChange&&isMissing)
      ?'<span class="badge" style="background:#2a1200;color:#ff9944;border-color:#7a3800;">泛 Missing</span>'
      :"";
    const regionBadge=r.region?`<span class="regionTag regionTag-${r.region}">${r.region}</span>`:"";
    const key=r.name.toLowerCase();
    const isExpanded=expandedRows.has(key);
    const isPicked=pickedUp.has(key);
    const manualActive=isManualActive(r.manualEvent);
    const manualType=r.manualEvent?.type;
    const isWonOrFinal=manualType==="won"||manualType==="final_end";
    const manualRemMin=manualActive?manualRem(r.manualEvent):0;
    const manualBadge=manualActive?`<span class="manualBadge">東 ${manualRemMin}m</span>`:"";
    const tr=document.createElement("tr");
    if(manualActive&&!isWonOrFinal&&manualType!=="offline")tr.classList.add("tr--danger");
    else if(manualActive&&isWonOrFinal)tr.classList.add("tr--watching");
    tr.innerHTML=`
      <td class="nameCell"><button class="pickupBtn${isPicked?" pickupOn":""}" title="繝斐ャ繧ｯ繧｢繝・・・亥､ｧ蝙九げ繝ｩ繝輔↓霑ｽ蜉・・>笘・/button>${statusBadge}${r.name} ${regionBadge}${missingBadge}<span class="expandCaret">${isExpanded?"笆ｴ":"笆ｾ"}</span></td>
      <td class="rankCell">${renderBadge(r.leaderboardRank,r.league)}</td>
      <td class="num">${(r.points==null)?"N/A":r.points.toLocaleString()}</td>
      <td class="num">${r.lastDelta==null?"窶・:r.lastDelta>0?`<span style="color:#ff4d4d;font-weight:700">+${r.lastDelta}</span>`:`<span style="color:#5b9cf6;font-weight:700">${r.lastDelta}</span>`}</td>
      <td class="tsCell">${r.lastDelta==null?"窶・:fmtAgo(r.lastRealChangeAt)}</td>
      <td><span class="state ${displayState}">${stateLabel(displayState)}</span>${manualBadge}</td>
      <td class="num">${isMissing?"窶・:r.nextMatchProb??0}%</td>
      <td class="tsCell">${r.lastOkAt?fmtTs(r.lastOkAt):"窶・}</td>
      <td class="errCell">${r.error||""}</td>
      <td class="actCell"><button class="resetBtn" title="驕ｭ驕・ｨ倬鹸・医け繝ｪ繝・け縺ｧ螻暮幕・・>笞・/button><button class="deleteBtn" title="蜑企勁">笨・/button></td>
    `;
    tr.querySelector(".pickupBtn").addEventListener("click",(e)=>{e.stopPropagation();if(pickedUp.has(key))pickedUp.delete(key);else pickedUp.add(key);renderTable(lastRows);renderPickupGraph();});
    tr.querySelector(".nameCell").addEventListener("click",()=>toggleExpand(r,tr,key));
    tr.querySelector(".resetBtn").addEventListener("click",(e)=>{e.stopPropagation();toggleExpand(r,tr,key);});
    tr.querySelector(".deleteBtn").addEventListener("click",(e)=>{e.stopPropagation();removePlayer(r.name);});
    tbody.appendChild(tr);
    if(isExpanded) tbody.appendChild(buildExpandRow(r,key));
  }
}
function renderSpark(rows){
  const wrap=document.getElementById("sparkWrap");if(!wrap)return;wrap.innerHTML="";
  const axis=document.getElementById("sparkAxis");if(axis)axis.innerHTML="";
  const summary=document.getElementById("sparkSummary");if(summary)summary.innerHTML="";
  const activeRows=rows.filter(r=>r.lastChangeAt&&!(r.notFoundCount>=3&&r.lastFoundAt));
  const hotEl=document.getElementById("sparkHotCount");
  if(hotEl){
    const now2=nowMs();
    const dangerNow=activeRows.filter(r=>isEncounterDanger(r.manualEvent)).length;
    const hotNow=activeRows.filter(r=>!r.manualEvent&&r.nextMatchProb>=60).length;
    let html="";
    if(dangerNow>0) html+=`<span class="dangerCount">圷 ${dangerNow}莠ｺ驕ｭ驕・ｼ・/span>`;
    if(hotNow>0)    html+=`<span class="hotCount">${hotNow}莠ｺ縺瑚ｩｦ蜷磯幕蟋玖ｿ代＞</span>`;
    if(!html)       html=`<span style="color:#5a7aaa;font-size:12px;">隧ｦ蜷磯幕蟋九′霑代＞繝励Ξ繧､繝､繝ｼ縺ｪ縺・/span>`;
    hotEl.innerHTML=html;
  }
  if(activeRows.length===0){
    wrap.innerHTML="<div class='psEmpty'>繝励Ξ繧､繝､繝ｼ繧定ｿｽ蜉縺吶ｋ縺ｨ莠域ｸｬ繧ｰ繝ｩ繝輔′陦ｨ遉ｺ縺輔ｌ縺ｾ縺・/div>";
    return;
  }
  for(const r of activeRows){
    const now2=nowMs();
    const isDanger=isEncounterDanger(r.manualEvent);
    const item=document.createElement("div");item.className="psItem"+(isDanger?" psItem--danger":"");
    const [handle,tag]=r.name.split("#");
    const prob=r.nextMatchProb??0;
    const probColor=isDanger?"#ff4444":prob>=60?"#39d98a":prob>=30?"#ffcf5c":"#5a7aaa";
    const header=document.createElement("div");header.className="psHeader";
    const dangerBadge=isDanger?`<span class="psDangerBadge">圷 驕ｭ驕・/span>`:"";
    const et=isDanger?findEncounterType(r.manualEvent.type):null;
    const etLabel=et?et.label:"";
    header.innerHTML=`<span class="psName">${handle}<span class="psTag">#${tag||""}</span></span>${dangerBadge}<span class="psPct" style="color:${probColor}">${isDanger?etLabel:prob+"%"}</span>`;
    item.appendChild(header);
    item.appendChild(buildPlayerSparkEl(r));
    wrap.appendChild(item);
  }
}
function renderBanList(rows){
  const el=document.getElementById("banAlertList");
  if(!el)return;
  const flagged=rows.filter(r=>r.notFoundCount>=3&&r.lastFoundAt);
  if(flagged.length===0){el.innerHTML="";return;}
  const banned=flagged.filter(r=>r.suspectedReason==="BAN");
  const nameChanged=flagged.filter(r=>r.suspectedReason==="NAME_CHANGE");
  const unknown=flagged.filter(r=>!r.suspectedReason);
  function itemHtml(r){
    const isBan=r.suspectedReason==="BAN";
    const isNameChange=r.suspectedReason==="NAME_CHANGE";
    const cls=isBan?"banAlertBan":isNameChange?"banAlertNameChange":"";
    const icon=isBan?"笵・:isNameChange?"鳩":"泛";
    const reasonText=isBan
      ?"繝ｪ繝ｼ繝繝ｼ繝懊・繝峨°繧牙ｮ悟・豸亥悉"
      :isNameChange?`譁ｰ縺励＞蜷榊燕: <b>${r.suspectedNewName||"荳肴・"}</b>`
      :"豸亥､ｱ荳ｭ・郁ｪｿ譟ｻ荳ｭ窶ｦ・・;
    return `<div class="banAlertItem ${cls}">
      <span class="banAlertIcon">${icon}</span>
      <span class="banAlertName">${r.name}</span>
      <span class="banAlertReason">${reasonText}</span>
      <span class="banAlertMeta">譛邨ら｢ｺ隱・ ${fmtTs(r.lastFoundAt)}縲騾｣邯壽悴讀懷・: ${r.notFoundCount}蝗・/span>
    </div>`;
  }
  let html="";
  if(banned.length)    html+=`<div class="banAlertTitle banTitleBan">笵・BAN縺輔ｌ縺溷庄閭ｽ諤ｧ</div>`+banned.map(itemHtml).join("");
  if(nameChanged.length) html+=`<div class="banAlertTitle banTitleNameChange">鳩 蜷榊燕螟画峩</div>`+nameChanged.map(itemHtml).join("");
  if(unknown.length)   html+=`<div class="banAlertTitle">泛 豸亥､ｱ荳ｭ・郁ｪｿ譟ｻ荳ｭ・・/div>`+unknown.map(itemHtml).join("");
  el.innerHTML=html;
}
async function pollOnce(names,settings){
  const snapshots=getSnapshots();
  const now=nowMs();
  const rows=[];
  let anyCors=false;
  await Promise.all(names.map(async(name)=>{
    const key=name.toLowerCase();
    const prev=snapshots[key]||{};
    let points=null,stale=false,errMsg="",freshRank=null,freshLeague=null,freshAltNames=null;
    try{
      const data=await fetchPlayer(effectiveProxyBase(settings),settings.leaderboardId,settings.platform,name);
      const entry=(data&&Array.isArray(data.data)&&data.data.length)?data.data[0]:null;
      points=entry?getPointsFromEntry(entry):null;
      freshRank=entry?pickRank(entry,null):null;
      freshLeague=entry?getLeagueFromEntry(entry):null;
      freshAltNames=entry?getAltNamesFromEntry(entry):{steam:null,psn:null,xbox:null};
      if(points===null){stale=true;errMsg="No points field / not in leaderboard";}
    }catch(e){
      stale=true;errMsg=String(e&&e.message?e.message:e);
      if(isCorsLikeError(errMsg)) anyCors=true;
    }
    let delta=null;
    let lastDelta=prev.lastDelta??null; // 譛蠕後・髱槭ぞ繝ｭ螟牙虚蛟､・郁｡ｨ遉ｺ蝗ｺ螳夂畑・・    let lastChangeAt=prev.lastChangeAt??null;
    let lastRealChangeAt=prev.lastRealChangeAt??null; // 螳滄圀縺ｮ繝昴う繝ｳ繝亥､牙虚縺ｮ縺ｿ險倬鹸・郁｡ｨ遉ｺ逕ｨ・・    let manualEvent=prev.manualEvent??null; // 謇句虚驕ｭ驕・ｨ倬鹸
    let currentPoints=prev.points??null;
    let lastOkAt=prev.lastOkAt??null;
    let leaderboardRank=prev.leaderboardRank??null;
    let league=prev.league??null;
    let notFoundCount=prev.notFoundCount??0;
    let lastFoundAt=prev.lastFoundAt??null;
    let banNotified=prev.banNotified??false;
    let altNames=prev.altNames||{steam:null,psn:null,xbox:null};
    let suspectedReason=prev.suspectedReason??null;
    let suspectedNewName=prev.suspectedNewName??null;
    if(points!==null){
      currentPoints=points;lastOkAt=now;
      leaderboardRank=freshRank??leaderboardRank;
      league=freshLeague??league;
      // Merge fresh alt names (prefer non-null, keep saved if API returned null this time)
      if(freshAltNames){
        altNames={
          steam:freshAltNames.steam||altNames.steam,
          psn:freshAltNames.psn||altNames.psn,
          xbox:freshAltNames.xbox||altNames.xbox
        };
      }
      notFoundCount=0;lastFoundAt=now;banNotified=false;suspectedReason=null;suspectedNewName=null;
      if(typeof prev.points==="number"){
        delta=currentPoints-prev.points;
        if(delta!==0){lastChangeAt=now;lastRealChangeAt=now;lastDelta=delta;pushEvent({ts:now,name,points:currentPoints,delta,inferred_state:null},settings.maxEvents);}
        // RS諤･關ｽ繧｢繝ｩ繝ｼ繝・        if(delta<=-settings.rsDropThreshold){
          const prevRk=prev.leaderboardRank;
          const newRk=freshRank??leaderboardRank;
          const rankPart=(prevRk&&newRk)?" / #"+prevRk.toLocaleString()+" 竊・#"+newRk.toLocaleString():"";
          toast("悼 <b>"+name+"</b> RS諤･貂・ "+prev.points.toLocaleString()+" 竊・"+currentPoints.toLocaleString()+" (<b>"+delta+"</b>)"+rankPart);
        }
      }else if(prev.points==null){
        // 蛻晏屓隕ｳ貂ｬ・壼━蜈磯・ｽ・ 繧､繝吶Φ繝亥ｱ･豁ｴ 竊・lastBatchAt 竊・null(UNKNOWN)
        if(!lastChangeAt){
          const fromHistory=getLastChangeAtFromEvents(key);
          if(fromHistory) lastChangeAt=fromHistory;
          else if(estimator.lastBatchAt) lastChangeAt=estimator.lastBatchAt;
        }
      }
    }else if(!isCorsLikeError(errMsg)){
      notFoundCount++;
      if(notFoundCount>=3&&lastFoundAt&&!banNotified&&leaderboardCache.length>0){
        const matchEntry=findByAltNames(altNames);
        if(matchEntry){
          suspectedReason="NAME_CHANGE";
          suspectedNewName=pickName(matchEntry)||null;
          toast("売 <b>"+name+"</b> 縺悟錐蜑阪ｒ螟画峩縺励∪縺励◆ 竊・<b>"+(suspectedNewName||"荳肴・")+"</b>");
        }else{
          suspectedReason="BAN";
          toast("笵・<b>"+name+"</b> 縺沓AN縺輔ｌ縺溷庄閭ｽ諤ｧ縺後≠繧翫∪縺・);
        }
        banNotified=true;
      }
    }
    // manualEvent: API縺ｧ繝昴う繝ｳ繝亥､牙喧繧呈､懷・縺励◆繧峨け繝ｪ繧｢縲・譎る俣邨碁℃縺ｧ繧ら┌蜉ｹ蛹・    if(delta!==null&&delta!==0)manualEvent=null;
    const manualActive=isManualActive(manualEvent);
    if(!manualActive)manualEvent=null;
    const effectiveLCA=manualActive?manualEvent.lastChangeAtOverride:lastChangeAt;
    const region=prev.region??"";
    snapshots[key]={points:currentPoints,lastDelta,lastChangeAt,lastRealChangeAt,lastOkAt,leaderboardRank,league,notFoundCount,lastFoundAt,banNotified,altNames,suspectedReason,suspectedNewName,region,...(manualEvent?{manualEvent}:{})};
    const inf=(manualActive&&manualEvent?.type==="offline")?{state:"OFFLINE",nextMatchProb:0}:inferState(now,effectiveLCA,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,manualActive);
    // 迥ｶ諷句､牙喧繧偵Ο繧ｰ險倬鹸
    const prevRowState=lastRows.find(r=>r.name.toLowerCase()===key)?.state;
    if(prevRowState && prevRowState!==inf.state){
      pushStateLog({ts:now,name,from:prevRowState,to:inf.state,points:currentPoints,delta});
      // 笘・ｻ倥″繝励Ξ繧､繝､繝ｼ縺ｮ迥ｶ諷句､牙喧騾夂衍
      if(pickedUp.has(key)){
        const entering=["IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING"].includes(inf.state);
        const leaving=["IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING"].includes(prevRowState);
        if(entering)sendNotification(`式 ${name} 縺瑚ｩｦ蜷井ｸｭ`,`${stateLabel(prevRowState)} 竊・${stateLabel(inf.state)}`);
        else if(leaving)sendNotification(`潤 ${name} 縺瑚ｩｦ蜷育ｵゆｺ・,`${stateLabel(prevRowState)} 竊・${stateLabel(inf.state)}`);
      }
    }
    rows.push({name,points:currentPoints,delta,lastDelta,lastChangeAt,lastRealChangeAt,effectiveLCA,manualEvent:manualActive?manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt,leaderboardRank,league,region,notFoundCount,lastFoundAt,suspectedReason,suspectedNewName,error:stale?errMsg:""});
  }));
  saveSnapshots(snapshots);  // community 逋ｻ骭ｲ貂医∩繝励Ξ繧､繝､繝ｼ縺ｮ迥ｶ諷九・縲∬｡ｨ遉ｺ繧ｿ繝悶↓髢｢菫ゅ↑縺上ヰ繝・け繧ｨ繝ｳ繝峨∈蜈ｱ譛・  {
    const _gs=getUiSettings();
    const _gUrl=effectiveGlobalUrl(_gs);
    if(_gUrl){
      const activeKeys=new Set(getCommunityList().map(e=>e.name.toLowerCase()));
      if(activeKeys.size>0){
        Object.entries(snapshots).forEach(([k,s])=>{
          if(activeKeys.has(k))maybeSubmitSnapshotToGlobal(_gUrl,k,s);
        });
      }
    }
  }
}
function csvEscape(s){const t=String(s??"");if(/[",\n]/.test(t))return '"'+t.replaceAll('"','""')+'"';return t;}
function downloadText(filename,text){
  const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
}
function exportJsonl(){const events=getEvents();downloadText("finals_events.jsonl",events.map(e=>JSON.stringify(e)).join("\n")+"\n");}
function exportCsv(){
  const events=getEvents();const header=["ts","name","points","delta","inferred_state"];
  const lines=[header.join(",")];
  for(const e of events){lines.push([e.ts,csvEscape(e.name),e.points,e.delta,csvEscape(e.inferred_state||"")].join(","));}
  downloadText("finals_events.csv",lines.join("\n")+"\n");
}
function clearLocal(){localStorage.removeItem(LS.settings);localStorage.removeItem(LS.snapshots);localStorage.removeItem(LS.events);localStorage.removeItem(LS.names);}
const LS_LOGS="finals_tracker_statelogs_v1";
function getStateLogs(){try{const r=localStorage.getItem(LS_LOGS);if(!r)return[];return JSON.parse(r);}catch{return[];}}
function pushStateLog(entry){try{const logs=getStateLogs();logs.push(entry);if(logs.length>2000)logs.splice(0,logs.length-2000);localStorage.setItem(LS_LOGS,JSON.stringify(logs));}catch{}}
function clearStateLogs(){try{localStorage.removeItem(LS_LOGS);}catch{}}
function exportStateLogs(){
  const logs=getStateLogs();
  const header=["ts","datetime","name","from","to","points","delta"];
  const lines=[header.join(",")];
  for(const e of logs){
    const dt=new Date(e.ts).toLocaleString();
    lines.push([e.ts,csvEscape(dt),csvEscape(e.name),csvEscape(e.from||""),csvEscape(e.to||""),e.points??"",e.delta??""].join(","));
  }
  downloadText("finals_statelogs.csv",lines.join("\n")+"\n");
}
function renderPickupGraph(){
  const section=document.getElementById("pickupSection");if(!section)return;
  const picked=lastRows.filter(r=>pickedUp.has(r.name.toLowerCase()));
  if(picked.length===0){section.style.display="none";return;}
  section.style.display="";
  const slots=30,now=nowMs();
  const combined=[];
  for(let i=0;i<slots;i++){
    const future=now+(i*60000);
    let q=1;
    for(const r of picked){
      const lca=r.effectiveLCA??r.lastChangeAt;
      const isDanger=isEncounterDanger(r.manualEvent);
      const inf=inferState(future,lca,r.reflectDelayMin,r.matchWaitMin,r.matchAvgMin,r.matchJitterMin,r.tournamentTotalMin,isDanger);
      q*=(1-(inf.nextMatchProb||0)/100);
    }
    combined.push(Math.round((1-q)*100));
  }
  const peak=combined.indexOf(Math.max(...combined));
  const barsEl=document.getElementById("pickupBars");
  if(barsEl){
    barsEl.innerHTML="";
    for(let i=0;i<slots;i++){
      const v=combined[i]/100;
      const bar=document.createElement("div");
      bar.className="pickupBar"+(i===peak?" pickupBarPeak":"");
      bar.style.height=Math.max(4,Math.round(v*100))+"px";
      bar.title=`+${i}蛻・ｾ・ ${combined[i]}%`;
      barsEl.appendChild(bar);
    }
  }
  const axEl=document.getElementById("pickupAxis");
  if(axEl){axEl.innerHTML="";[0,5,10,15,20,25].forEach(m=>{const s=document.createElement("span");s.textContent=m===0?"莉・:"+"+m+"m";axEl.appendChild(s);});}
  const nameEl=document.getElementById("pickupNames");if(nameEl)nameEl.textContent=picked.map(r=>r.name).join("縲・);
  const pctEl=document.getElementById("pickupPeak");if(pctEl)pctEl.textContent=`繝斐・繧ｯ ${combined[peak]}% (+${peak}蛻・ｾ・`;
}
let logViewMode="list";
const LOG_STATE_COLOR={OFFLINE:"#8ea0b7",LOBBY:"#5b9cf6",POST_MATCH_WAIT:"#7bb8f0",IN_MATCH:"#39d98a",IN_TOURNAMENT_DEEP:"#c77dff",RETURNING:"#c77dff",UNKNOWN:"#3a4a60",NOT_FOUND:"#ff9944",BANNED:"#ff5555",NAME_CHANGED:"#6de9ff"};

function renderLogList(){
  const el=document.getElementById("logList");if(!el)return;
  const allLogs=getStateLogs();
  const logs=allLogs.slice(-300).reverse();
  const count=document.getElementById("logCount");
  if(count)count.textContent=`(${allLogs.length}莉ｶ)`;
  if(logs.length===0){el.innerHTML='<div style="color:#5a7aaa;padding:8px 0">繝ｭ繧ｰ縺ｪ縺・/div>';return;}
  let html="";let lastDate="";
  for(const e of logs){
    const d=new Date(e.ts);
    const dateStr=d.toLocaleDateString(undefined,{month:"short",day:"numeric",weekday:"short"});
    const timeStr=d.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    if(dateStr!==lastDate){html+=`<div class="logDateSep">${dateStr}</div>`;lastDate=dateStr;}
    const fromC=LOG_STATE_COLOR[e.from]||"#8ea0b7";
    const toC=LOG_STATE_COLOR[e.to]||"#e7edf5";
    const delta=e.delta!=null?(e.delta>0?`<span class="logDelta pos">+${e.delta}</span>`:`<span class="logDelta neg">${e.delta}</span>`):"";
    html+=`<div class="logEntry"><span class="logTime">${timeStr}</span><span class="logName">${e.name}</span><span class="logState" style="color:${fromC}">${stateLabel(e.from)}</span><span class="logArrow">竊・/span><span class="logState" style="color:${toC}">${stateLabel(e.to)}</span>${delta}</div>`;
  }
  el.innerHTML=html;
}

function renderLogTimeline(){
  const el=document.getElementById("logList");if(!el)return;
  const allLogs=getStateLogs();
  const count=document.getElementById("logCount");
  if(count)count.textContent=`(${allLogs.length}莉ｶ)`;
  if(allLogs.length===0){el.innerHTML='<div style="color:#5a7aaa;padding:8px 0">繝ｭ繧ｰ縺ｪ縺・/div>';return;}

  // 繝励Ξ繧､繝､繝ｼ蛻･縺ｫ繧ｰ繝ｫ繝ｼ繝怜喧
  const playerMap={};
  for(const log of allLogs){
    if(!playerMap[log.name])playerMap[log.name]=[];
    playerMap[log.name].push(log);
  }
  // 譛譁ｰ縺ｮ繝ｭ繧ｰ縺後≠繧九・繝ｬ繧､繝､繝ｼ縺九ｉ荳ｦ縺ｹ繧具ｼ域怙螟ｧ20蜷搾ｼ・  const playerNames=Object.keys(playerMap)
    .sort((a,b)=>Math.max(...playerMap[b].map(l=>l.ts))-Math.max(...playerMap[a].map(l=>l.ts)))
    .slice(0,20);

  const now=Date.now();
  // 譛ｬ譌･ 00:00:00・医Ο繝ｼ繧ｫ繝ｫ・峨・鄙・00:00:00 縺ｮ蝗ｺ螳・24 譎る俣霆ｸ
  const todayMidnight=new Date(now);todayMidnight.setHours(0,0,0,0);
  const timeStart=todayMidnight.getTime();
  const timeEnd=timeStart+24*60*60*1000;
  const totalDur=timeEnd-timeStart; // 86400000

  const rowH=22;const rowGap=5;const labelW=130;const axisH=24;const padTop=16;
  const W=Math.max(el.clientWidth||600,400);
  const trackW=W-labelW-8;
  const svgH=playerNames.length*(rowH+rowGap)+axisH+padTop;

  let svgRows="";

  playerNames.forEach((name,i)=>{
    const y=padTop+i*(rowH+rowGap);
    const logs=[...playerMap[name]].sort((a,b)=>a.ts-b.ts);

    // 繧ｻ繧ｰ繝｡繝ｳ繝郁ｨ育ｮ暦ｼ井ｻ頑律 0:00縲懃樟蝨ｨ縺ｫ繧ｯ繝ｪ繝・・・・    const segs=[];
    if(logs[0].ts>timeStart){
      segs.push({start:timeStart,end:Math.min(logs[0].ts,now),state:logs[0].from});
    }
    for(let j=0;j<logs.length;j++){
      const segStart=Math.max(logs[j].ts,timeStart);
      const segEnd=j+1<logs.length?Math.min(logs[j+1].ts,now):Math.min(now,timeEnd);
      if(segStart<timeEnd&&segEnd>timeStart){
        segs.push({start:segStart,end:segEnd,state:logs[j].to});
      }
    }

    // 繝ｩ繝吶Ν・育怐逡･・・    const label=name.length>16?name.slice(0,14)+"窶ｦ":name;
    svgRows+=`<text x="${labelW-6}" y="${y+rowH/2+4}" text-anchor="end" fill="#b8c4d6" font-size="11" font-family="system-ui,sans-serif">${label}</text>`;

    // 繧ｻ繧ｰ繝｡繝ｳ繝域緒逕ｻ
    for(const seg of segs){
      const x=labelW+((seg.start-timeStart)/totalDur)*trackW;
      const w=Math.max(((seg.end-seg.start)/totalDur)*trackW,1);
      const color=LOG_STATE_COLOR[seg.state]||"#8ea0b7";
      const startStr=new Date(seg.start).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",hour12:false});
      const endStr=new Date(seg.end).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",hour12:false});
      svgRows+=`<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" fill="${color}" opacity="0.82" rx="2"><title>${stateLabel(seg.state)}\n${startStr} 竊・${endStr}</title></rect>`;
    }
    // 蛹ｺ蛻・ｊ邱・    svgRows+=`<line x1="${labelW}" y1="${y+rowH+2}" x2="${W-4}" y2="${y+rowH+2}" stroke="#1e2a3a" stroke-width="1"/>`;
  });

  // 譎ょ綾霆ｸ・・譎る俣縺斐→: 00:00, 02:00, ..., 24:00・・  const axisY=padTop+playerNames.length*(rowH+rowGap)+4;
  let axis=`<line x1="${labelW}" y1="${axisY}" x2="${W-4}" y2="${axisY}" stroke="#2a3a50" stroke-width="1"/>`;
  for(let h=0;h<=24;h+=2){
    const x=labelW+(h/24)*trackW;
    const lbl=String(h%24).padStart(2,"0")+":00";
    const isMajor=(h%6===0);
    axis+=`<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY+(isMajor?6:3)}" stroke="${isMajor?"#4a6a90":"#3a4a60"}" stroke-width="1"/>`;
    if(isMajor){
      axis+=`<text x="${x.toFixed(1)}" y="${axisY+17}" text-anchor="middle" fill="#6a8aaa" font-size="10" font-family="system-ui,sans-serif">${lbl}</text>`;
    }
  }

  // 迴ｾ蝨ｨ譎ょ綾縺ｮ蝙ら峩 NOW 繝ｩ繧､繝ｳ
  const nowX=labelW+((now-timeStart)/totalDur)*trackW;
  axis+=`<line x1="${nowX.toFixed(1)}" y1="${padTop}" x2="${nowX.toFixed(1)}" y2="${axisY}" stroke="#ff9944" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>`;
  axis+=`<text x="${nowX.toFixed(1)}" y="${padTop-3}" text-anchor="middle" fill="#ff9944" font-size="9" font-weight="bold" font-family="system-ui,sans-serif">NOW</text>`;

  // 蜃｡萓・  const legendStates=[["OFFLINE","#8ea0b7","Offline"],["LOBBY","#5b9cf6","Lobby"],["IN_MATCH","#39d98a","In Match"],["IN_TOURNAMENT_DEEP","#c77dff","Final/Tournament"],["NOT_FOUND","#ff9944","Missing"],["BANNED","#ff5555","Banned"]];
  let legend=`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">`;
  for(const [,color,label] of legendStates){
    legend+=`<span style="display:flex;align-items:center;gap:4px;font-size:11px;color:#b8c4d6;"><span style="width:14px;height:14px;border-radius:3px;background:${color};opacity:0.85;display:inline-block;"></span>${label}</span>`;
  }
  legend+=`</div>`;

  el.innerHTML=`<div style="overflow-x:auto;margin-top:8px;"><svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="display:block;">${svgRows}${axis}</svg></div>${legend}`;
}
function saveNamesToUrl(names){
  const qp=new URLSearchParams(window.location.search);
  qp.set("names",names.join(","));
  const next=window.location.pathname+"?"+qp.toString();
  history.replaceState(null,"",next);
}
function saveNamesToLocal(names){
  try{localStorage.setItem(LS.names,JSON.stringify(names));}catch{}
}
function loadNamesFromLocal(){
  try{const raw=localStorage.getItem(LS.names);if(!raw)return null;const arr=JSON.parse(raw);return Array.isArray(arr)&&arr.length?arr:null;}catch{return null;}
}
function loadNamesFromUrl(){
  const qp=new URLSearchParams(window.location.search);
  const raw=qp.get("names");
  if(!raw)return null;
  return parseNames(raw);
}
async function ensureLeaderboardCache(){
  if(leaderboardCache.length>0||leaderboardFetching)return;
  leaderboardFetching=true;
  try{
    const s=currentSettings||getUiSettings();
    const json=await fetchLeaderboardViaProxy(s);
    leaderboardCache=normalizeLeaderboardArray(json);
  }catch(e){}finally{leaderboardFetching=false;}
}
function searchLeaderboard(query){
  if(!query||query.length<2||leaderboardCache.length===0)return[];
  const q=query.toLowerCase();
  const results=[];
  for(const e of leaderboardCache){
    if(results.length>=5)break;
    if((e.name||"").toLowerCase().includes(q)||(e.steamName||"").toLowerCase().includes(q)||(e.psnName||"").toLowerCase().includes(q)||(e.xboxName||"").toLowerCase().includes(q))results.push(e);
  }
  return results;
}
function hideSearchDropdown(){
  const box=document.getElementById("searchDropdown");
  if(box){box.innerHTML="";box.classList.remove("open");}
}
function renderSearchDropdown(entries){
  const box=document.getElementById("searchDropdown");
  if(!box)return;
  if(entries.length===0){box.innerHTML="";box.classList.remove("open");return;}
  box.innerHTML=entries.map(e=>{
    const alts=[e.steamName,e.psnName,e.xboxName].filter(Boolean).join(" ﾂｷ ");
    return `<div class="suggItem" data-name="${e.name}"><span class="suggRank">#${e.rank}</span><span class="suggName">${e.name}</span>${alts?`<span class="suggAlt">${alts}</span>`:""}</div>`;
  }).join("");
  box.classList.add("open");
  box.querySelectorAll(".suggItem").forEach(el=>{
    el.addEventListener("mousedown",ev=>{
      ev.preventDefault();
      addPlayerAndStart(el.dataset.name);
    });
  });
}
function doStart(){
  if(timer){clearTimeout(timer);timer=null;}
  const settings=getUiSettings();saveSettings(settings);
  const names=getActiveNames();
  if(names.length===0)return;
  if(viewMode==="personal"){try{saveNamesToUrl(names);}catch{}saveNamesToLocal(names);}
  currentSettings=settings;
  setRunning(true);
  (function schedulePoll(){
    // 繧ｰ繝ｭ繝ｼ繝舌Ν繝ｪ繧ｹ繝医ｒ 120 遘偵＃縺ｨ縺ｫ繝舌ャ繧ｯ繧ｨ繝ｳ繝峨→閾ｪ蜍募酔譛滂ｼ井ｻ悶Θ繝ｼ繧ｶ繝ｼ縺ｮ霑ｽ蜉繧貞渚譏・・    const now=Date.now();
    const communitySync=effectiveGlobalUrl(settings)&&(now-lastCommunitySync>120000)
      // 繧ｳ繝溘Η繝九ユ繧｣繝ｪ繧ｹ繝亥酔譛滂ｼ郁ｿｽ蜉繝ｻ譖ｴ譁ｰ繝ｻ蜑企勁・・+ 繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ迥ｶ諷句酔譛・繧剃ｸｦ蛻怜ｮ溯｡・      ?Promise.all([
          fetchAndMergeCommunity(effectiveGlobalUrl(settings)),
          fetchAndMergeSnapshots(effectiveGlobalUrl(settings)),
        ]).then(()=>{
          lastCommunitySync=Date.now();
          renderGlobalPlayerList();
        })
      :Promise.resolve();
    communitySync.finally(()=>pollOnce(getActiveNames(),settings).finally(()=>{
      if(!running)return;
      const hasActive=lastRows.some(r=>["IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING"].includes(r.state));
      const secs=hasActive?Math.max(20,Math.floor(settings.pollIntervalSec/2)):settings.pollIntervalSec;
      timer=setTimeout(schedulePoll,secs*1000);
    }));
  })();
}
// 繧ｰ繝ｭ繝ｼ繝舌Ν繝｢繝ｼ繝・ 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨・繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ繧貞叙蠕励＠縺ｦ繝・・繝悶Ν縺ｫ蜈郁｡瑚｡ｨ遉ｺ
async function preloadRemoteSnapshots(settings){
  const remote=await fetchGlobalSnapshots(effectiveGlobalUrl(settings));
  if(!remote||typeof remote!=="object")return;
  // 繝ｪ繝｢繝ｼ繝医・ lastChangeAt 繧偵Ο繝ｼ繧ｫ繝ｫ繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ縺ｫ繝槭・繧ｸ・亥・蝗櫁ｦｳ貂ｬ譎ゅ・繧ｺ繝ｬ髦ｲ豁｢・・  const localSnaps=getSnapshots();
  let snapshotsMerged=false;
  for(const [key,remSnap] of Object.entries(remote)){
    if(remSnap&&remSnap.lastChangeAt){
      if(!localSnaps[key])localSnaps[key]={points:null,lastChangeAt:null};
      if(!localSnaps[key].lastChangeAt){
        localSnaps[key]={...localSnaps[key],lastChangeAt:remSnap.lastChangeAt,lastRealChangeAt:remSnap.lastRealChangeAt??remSnap.lastChangeAt};
        snapshotsMerged=true;
      }
    }
  }
  if(snapshotsMerged)saveSnapshots(localSnaps);
  const names=getActiveNames();
  const now=Date.now();
  const rows=names.map(name=>{
    const snap=remote[name.toLowerCase()];
    if(!snap||snap.points==null)return null;
    const inf=inferState(now,snap.lastChangeAt,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,false);
    return {name,points:snap.points,delta:null,lastChangeAt:snap.lastChangeAt,effectiveLCA:snap.lastChangeAt,manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt:snap.lastOkAt,leaderboardRank:snap.leaderboardRank,league:snap.league,region:snap.region,notFoundCount:snap.notFoundCount||0,lastFoundAt:snap.lastFoundAt,suspectedReason:snap.suspectedReason,suspectedNewName:snap.suspectedNewName,error:"倹 蜈ｱ譛峨ョ繝ｼ繧ｿ",isShared:true};
  }).filter(Boolean);
  if(rows.length>0&&lastRows.length===0){lastRows=rows;renderTable(rows);renderSpark(rows);}
}
async function switchToGlobal(){
  viewMode="global";
  document.getElementById("tabPersonal").classList.remove("active");
  document.getElementById("tabGlobal").classList.add("active");
  document.getElementById("liveTabPersonal")?.classList.remove("active");
  document.getElementById("liveTabGlobal")?.classList.add("active");
  document.getElementById("namesBox").closest("section").querySelector(".personalView").style.display="none";
  document.getElementById("globalListView").style.display="";
  const settings=getUiSettings();
  // 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨′縺ゅｌ縺ｰ繝ｪ繝｢繝ｼ繝医→繝槭・繧ｸ
  if(effectiveGlobalUrl(settings)){
    document.getElementById("globalStatus").textContent="倹 蜷梧悄荳ｭ...";
    await fetchAndMergeCommunity(effectiveGlobalUrl(settings));
  }
  renderGlobalPlayerList();
  const total=getCommunityList().length;
  const filtered=getFilteredCommunity(globalFilter).length;
  document.getElementById("globalStatus").textContent=
    total===0?"邃ｹ・・縺ｾ縺逋ｻ骭ｲ縺後≠繧翫∪縺帙ｓ縲ゆｸ九・繝輔か繝ｼ繝縺九ｉ霑ｽ蜉縺励※縺上□縺輔＞"
    :`倹 ${globalFilter==="all"?"蜈ｨ繧ｵ繝ｼ繝舌・":REGION_LABEL[globalFilter]}・・{filtered}莠ｺ / 蜷郁ｨ・{total}莠ｺ`;
  if(effectiveGlobalUrl(settings)) preloadRemoteSnapshots(settings);
  if(filtered>0)doStart();
}
function switchToPersonal(){
  viewMode="personal";globalNames=[];
  document.getElementById("tabGlobal").classList.remove("active");
  document.getElementById("tabPersonal").classList.add("active");
  document.getElementById("liveTabGlobal")?.classList.remove("active");
  document.getElementById("liveTabPersonal")?.classList.add("active");
  document.getElementById("namesBox").closest("section").querySelector(".personalView").style.display="";
  document.getElementById("globalListView").style.display="none";
  doStart();
}
function renderGlobalPlayerList(){
  const el=document.getElementById("globalPlayerList");if(!el)return;
  // 繝輔ぅ繝ｫ繧ｿ繝ｼ繧ｿ繝悶・繧｢繧ｯ繝・ぅ繝也憾諷区峩譁ｰ
  document.querySelectorAll(".regionTab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.region===globalFilter);
  });
  const entries=getFilteredCommunity(globalFilter);
  const personalSet=new Set(parseNames(document.getElementById("namesBox").value).map(n=>n.toLowerCase()));
  if(entries.length===0){
    el.innerHTML="<div class='hint' style='padding:12px 0'>縺薙・繝輔ぅ繝ｫ繧ｿ繝ｼ縺ｫ縺ｯ逋ｻ骭ｲ縺後≠繧翫∪縺帙ｓ</div>";
    return;
  }
  // 蝨ｰ蝓溘＃縺ｨ縺ｫ繧ｰ繝ｫ繝ｼ繝苓｡ｨ遉ｺ・亥・縺ｦ驕ｸ謚樊凾・・  const groups=globalFilter==="all"
    ?REGION_ORDER.map(r=>({region:r,items:entries.filter(e=>(e.region||"")===r)})).filter(g=>g.items.length>0)
    :[{region:globalFilter,items:entries}];
  el.innerHTML=groups.map(g=>{
    const header=globalFilter==="all"?`<div class="regionGroupLabel">${REGION_LABEL[g.region]}</div>`:"";
    return header+g.items.map(e=>{
      const inPersonal=personalSet.has(e.name.toLowerCase());
      const catLabel=CAT_LABEL[e.category]||e.category||"";
      const catClass=e.category==="cheater"?"catCheater":e.category==="suspicious"?"catSuspicious":"catNotable";
      return `<div class="globalPlayerItem">
        <span class="globalPlayerName">${e.name}</span>
        <span class="catBadge ${catClass}">${catLabel}</span>
        ${e.note?`<span class="communityNote">${e.note}</span>`:""}
        ${inPersonal?'<span class="badge" style="background:#0d2a0d;color:#39d98a;border-color:#1e5a1e;font-size:10px;">逶｣隕紋ｸｭ</span>'
          :`<button class="globalAddBtn" data-name="${e.name}">・狗屮隕・/button>`}
        <button class="communityDelBtn" data-name="${e.name}" title="蜑企勁">ﾃ・/button>
      </div>`;
    }).join("");
  }).join("");
  el.querySelectorAll(".globalAddBtn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const ta=document.getElementById("namesBox");
      const existing=parseNames(ta.value);
      if(!existing.map(x=>x.toLowerCase()).includes(btn.dataset.name.toLowerCase())){
        ta.value=ta.value.trim()+(ta.value.trim()?"\n":"")+btn.dataset.name;
        saveNamesToLocal(parseNames(ta.value));
        toast("・・<b>"+btn.dataset.name+"</b> 繧定・蛻・・繝ｪ繧ｹ繝医↓霑ｽ蜉");
        renderGlobalPlayerList();
      }
    });
  });
  el.querySelectorAll(".communityDelBtn").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      if(!confirm(btn.dataset.name+" 繧偵Μ繧ｹ繝医°繧牙炎髯､縺励∪縺吶°・・))return;
      const _ds=getUiSettings();
      const _gUrl=effectiveGlobalUrl(_ds);
      // 繧ｵ繝ｼ繝舌・蜑企勁繧貞・縺ｫ螳溯｡後＠縲∵・蜉滓凾縺ｮ縺ｿ繝ｭ繝ｼ繧ｫ繝ｫ縺九ｉ髯､蜴ｻ
      // ・亥､ｱ謨玲凾縺ｯ UI 繧貞､峨∴縺壹∵ｬ｡蝗・fetchAndMergeCommunity 縺ｧ繧ゅし繝ｼ繝舌・縺梧ｭ｣縺ｨ縺励※邯ｭ謖√＆繧後ｋ・・      if(_gUrl){
        const ok=await deleteCommunityEntryFromGlobal(_gUrl,btn.dataset.name);
        if(!ok)return;
      }
      removeCommunityEntry(btn.dataset.name);
      renderGlobalPlayerList();
      const total=getCommunityList().length;
      document.getElementById("globalStatus").textContent=`倹 蜷郁ｨ・{total}莠ｺ`;
    });
  });
}
function removePlayer(name){
  const ta=document.getElementById("namesBox");
  const remaining=parseNames(ta.value).filter(n=>n.toLowerCase()!==name.toLowerCase());
  ta.value=remaining.join("\n");
  saveNamesToLocal(remaining);
  lastRows=lastRows.filter(r=>r.name.toLowerCase()!==name.toLowerCase());
  expandedRows.delete(name.toLowerCase());
  renderTable(lastRows);renderSpark(lastRows);
  toast("蜑企勁: <b>"+name+"</b>");
  if(timer){clearTimeout(timer);timer=null;}
  if(remaining.length>0){doStart();}else{setRunning(false);}
}
function addPlayerAndStart(name){
  const ta=document.getElementById("namesBox");
  const existing=parseNames(ta.value);
  const isNew=!existing.map(n=>n.toLowerCase()).includes(name.toLowerCase());
  if(isNew) ta.value=ta.value.trim()+(ta.value.trim()?"\n":"")+name;
  document.getElementById("playerSearch").value="";
  hideSearchDropdown();
  // 蜊ｳ譎ゅユ繝ｼ繝悶Ν陦ｨ遉ｺ・・PI繝ｬ繧ｹ繝昴Φ繧ｹ蜑阪〒繧ゅ・繝ｬ繧､繝､繝ｼ繧定｡ｨ遉ｺ・・  if(isNew){
    const s=currentSettings||getUiSettings();
    const now=nowMs();
    const snap=getSnapshots();
    const prev=snap[name.toLowerCase()]||{};
    const prevManual=prev.manualEvent??null;
    const prevManualActive=isManualActive(prevManual);
    const effectiveLCA=prevManualActive?prevManual.lastChangeAtOverride:(prev.lastChangeAt??null);
    const inf=inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,prevManualActive);
    const newRow={name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,manualEvent:prevManualActive?prevManual:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:0,lastFoundAt:null,suspectedReason:null,suspectedNewName:null,error:""};
    const updated=[...lastRows.filter(r=>r.name.toLowerCase()!==name.toLowerCase()),newRow];
    lastRows=updated;
    renderTable(updated);renderSpark(updated);
    toast("霑ｽ蜉: <b>"+name+"</b>");
  }
  doStart();
}
async function init(){
  // 笏笏 繝ｪ繝ｭ繝ｼ繝牙ｾ後・繧ｷ繝ｼ繝繝ｬ繧ｹ蠕ｩ蜈・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
  let reloadScroll=null;
  try{
    const exp=sessionStorage.getItem("fr_expanded");
    const vm=sessionStorage.getItem("fr_viewMode");
    const ft=sessionStorage.getItem("fr_filter");
    const sc=sessionStorage.getItem("fr_scroll");
    if(exp){JSON.parse(exp).forEach(k=>expandedRows.add(k));}
    if(vm)viewMode=vm;
    if(ft)globalFilter=ft;
    if(sc)reloadScroll=parseInt(sc);
    ["fr_expanded","fr_viewMode","fr_filter","fr_scroll"].forEach(k=>sessionStorage.removeItem(k));
    // viewMode=global縺ｪ繧・UI 繧偵げ繝ｭ繝ｼ繝舌Ν陦ｨ遉ｺ縺ｫ蛻・ｊ譖ｿ縺茨ｼ医い繝九Γ縺ｪ縺暦ｼ・    if(viewMode==="global"){
      document.getElementById("tabPersonal")?.classList.remove("active");
      document.getElementById("tabGlobal")?.classList.add("active");
      document.querySelector(".personalView")?.style.setProperty("display","none");
      document.getElementById("globalListView")?.style.setProperty("display","");
    }
    // globalFilter縺ｮ繧ｿ繝冶｡ｨ遉ｺ繧呈峩譁ｰ
    document.querySelectorAll(".regionTab").forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.region===globalFilter);
    });
  }catch{}
  // 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
  try{
    const s=loadSettings();applySettingsToUi(s);
    // URL 竊・localStorage 縺ｮ蜆ｪ蜈磯・〒繝励Ξ繧､繝､繝ｼ繝ｪ繧ｹ繝医ｒ蠕ｩ蜈・    const urlNames=loadNamesFromUrl();
    const savedNames=urlNames&&urlNames.length?urlNames:loadNamesFromLocal();
    if(savedNames && savedNames.length){
      document.getElementById("namesBox").value=savedNames.join("\n");
      if(reloadScroll!==null)pendingScrollY=reloadScroll; // pollOnce螳御ｺ・ｾ後↓蠕ｩ蜈・      // 繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ縺九ｉ蜊ｳ譎ゅ・繝ｬ繝薙Η繝ｼ謠冗判・・PI蠢懃ｭ泌燕縺ｫ迥ｶ諷倶ｺ域ｸｬ繧定｡ｨ遉ｺ・・      const snap=getSnapshots();
      const now=nowMs();
      const preRows=savedNames.map(name=>{
        const key=name.toLowerCase();
        const prev=snap[key]||{};
        const manualEvent=prev.manualEvent??null;
        const manualActive=isManualActive(manualEvent);
        const effectiveLCA=manualActive?manualEvent.lastChangeAtOverride:(prev.lastChangeAt??null);
        const inf=(manualActive&&manualEvent?.type==="offline")?{state:"OFFLINE",nextMatchProb:0}:inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,manualActive);
        return {name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,manualEvent:manualActive?manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:prev.notFoundCount??0,lastFoundAt:prev.lastFoundAt??null,suspectedReason:prev.suspectedReason??null,suspectedNewName:prev.suspectedNewName??null,error:""};
      });
      lastRows=preRows;
      renderTable(preRows);renderSpark(preRows);
      doStart(); // 蜷榊燕縺後≠繧後・閾ｪ蜍輔せ繧ｿ繝ｼ繝茨ｼ医Μ繝ｭ繝ｼ繝峨・蜀崎ｨｪ蝠丞ｾ後ｂ邯咏ｶ夲ｼ・    }
  }catch(e){console.error("init:",e);}
  // 繝・く繧ｹ繝医お繝ｪ繧｢螟画峩譎ゅ↓localStorage縺ｸ髫乗凾菫晏ｭ・  const ta=document.getElementById("namesBox");
  if(ta) ta.addEventListener("input",()=>{
    const names=parseNames(ta.value);
    if(names.length) saveNamesToLocal(names);
  });
  document.getElementById("btnStop").addEventListener("click",()=>{
    if(timer){clearTimeout(timer);timer=null;}
    setRunning(false);toast("stopped");
  });
  document.getElementById("btnAdd").addEventListener("click",()=>{
    const si=document.getElementById("playerSearch");
    const name=si.value.trim();
    if(name){addPlayerAndStart(name);return;}
    // 讀懃ｴ｢繝舌・縺檎ｩｺ縺ｮ蝣ｴ蜷・竊・namesBox 縺ｮ蜀・ｮｹ縺ｧ繝｢繝九ち繝ｪ繝ｳ繧ｰ髢句ｧ・    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length>0){doStart();toast("逶｣隕夜幕蟋具ｼ・b>"+names.length+"莠ｺ</b>");}
    else{toast("蜷榊燕繧貞・蜉帙＠縺ｦ縺上□縺輔＞");}
  });
  document.getElementById("btnShare").addEventListener("click",async()=>{
    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length===0){toast("Share: 蜷榊燕縺檎ｩｺ縺ｧ縺・);return;}
    saveNamesToUrl(names);
    const url=window.location.href;
    try{await navigator.clipboard.writeText(url);toast("Share link 繧偵さ繝斐・縺励∪縺励◆・・b>"+url+"</b>");}
    catch{toast("繧ｳ繝斐・縺ｧ縺阪∪縺帙ｓ縲６RL繧呈焔蜍輔さ繝斐・縺励※縺上□縺輔＞・・b>"+url+"</b>");}
  });
  document.getElementById("btnExportCsv").addEventListener("click",exportCsv);
  document.getElementById("btnExportJsonl").addEventListener("click",exportJsonl);
  document.getElementById("btnClear").addEventListener("click",()=>{
    if(!confirm("localStorage 縺ｮ settings/snapshots/events 繧貞炎髯､縺励∪縺吶ゅｈ繧阪＠縺・〒縺吶°・・))return;
    clearLocal();toast("local data cleared");
  });
  document.getElementById("btnTest").addEventListener("click",async()=>{
    const settings=getUiSettings();saveSettings(settings);
    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length===0){toast("Test: 蜷榊燕縺檎ｩｺ縺ｧ縺・);return;}
    const first=names[0];
    try{
      const data=await fetchPlayer(effectiveProxyBase(settings),settings.leaderboardId,settings.platform,first);
      const entry=(data&&Array.isArray(data.data)&&data.data.length)?data.data[0]:null;
      const pts=entry?getPointsFromEntry(entry):null;
      if(pts==null) toast("Test: <b>"+first+"</b> 竊・points 縺悟叙繧後∪縺帙ｓ・・eason/platform/蟇ｾ雎｡螟悶・蜿ｯ閭ｽ諤ｧ・・);
      else toast("Test: <b>"+first+"</b> 竊・points=<b>"+pts+"</b>");
    }catch(e){
      const msg=String(e&&e.message?e.message:e);
      if(isCorsLikeError(msg)) toast("Test螟ｱ謨暦ｼ・ORS縺ｮ蜿ｯ閭ｽ諤ｧ・俄・ 繝ｭ繝ｼ繧ｫ繝ｫ迺ｰ蠅・〒縺ｯ Worker 縺悟ｿ・ｦ√〒縺・);
      else toast("Test螟ｱ謨暦ｼ・b>"+msg+"</b>");
    }
  });
  const si=document.getElementById("playerSearch");
  if(si){
    si.addEventListener("input",async()=>{
      const q=si.value.trim();
      if(q.length<2){hideSearchDropdown();return;}
      await ensureLeaderboardCache();
      renderSearchDropdown(searchLeaderboard(q));
    });
    si.addEventListener("blur",()=>setTimeout(hideSearchDropdown,200));
    si.addEventListener("keydown",ev=>{
      if(ev.key==="Escape"){si.value="";hideSearchDropdown();}
      if(ev.key==="Enter"){const name=si.value.trim();if(name)addPlayerAndStart(name);}
    });
  }
  document.getElementById("tabPersonal").addEventListener("click",()=>{if(viewMode!=="personal")switchToPersonal();});
  document.getElementById("tabGlobal").addEventListener("click",()=>{if(viewMode!=="global")switchToGlobal();});
  // 蝨ｰ蝓溘ヵ繧｣繝ｫ繧ｿ繝ｼ繧ｿ繝・  document.querySelectorAll(".regionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      globalFilter=btn.dataset.region;
      renderGlobalPlayerList();
      const filtered=getFilteredCommunity(globalFilter).length;
      const total=getCommunityList().length;
      document.getElementById("globalStatus").textContent=
        `倹 ${globalFilter==="all"?"蜈ｨ繧ｵ繝ｼ繝舌・":REGION_LABEL[globalFilter]}・・{filtered}莠ｺ / 蜷郁ｨ・{total}莠ｺ`;
      if(running&&currentSettings)pollOnce(getActiveNames(),currentSettings);
    });
  });
  // 繧ｳ繝溘Η繝九ユ繧｣霑ｽ蜉繝輔か繝ｼ繝
  document.getElementById("btnCommunityAdd").addEventListener("click",async()=>{
    // 隱崎ｨｼ繝√ぉ繝・け・夊ｨｱ蜿ｯ繝ｦ繝ｼ繧ｶ繝ｼ縺瑚ｨｭ螳壽ｸ医∩縺ｧ譛ｪ繝ｭ繧ｰ繧､繝ｳ縺ｪ繧峨Δ繝ｼ繝繝ｫ繧定｡ｨ遉ｺ
    if(getEffectiveAllowedUsers().length>0&&!isLoggedIn()){
      showLoginModal(()=>document.getElementById("btnCommunityAdd").click());
      return;
    }
    const name=(document.getElementById("communityName").value||"").trim();
    if(!name){toast("蜷榊燕繧貞・蜉帙＠縺ｦ縺上□縺輔＞");return;}
    const entry={
      name,
      region:document.getElementById("communityRegion").value,
      category:document.getElementById("communityCategory").value,
      note:(document.getElementById("communityNote").value||"").trim(),
    };
    addCommunityEntry(entry);
    document.getElementById("communityName").value="";
    document.getElementById("communityNote").value="";
    toast("倹 <b>"+name+"</b> 繧偵さ繝溘Η繝九ユ繧｣繝ｪ繧ｹ繝医↓霑ｽ蜉 ("+(CAT_LABEL[entry.category]||"")+" / "+(REGION_LABEL[entry.region]||"荳肴・")+")");
    // 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓繧る∽ｿ｡・郁ｨｭ螳壽ｸ医∩縺ｪ繧会ｼ俄・ /community 縺ｫ full entry 繧帝√▲縺ｦ莉悶Θ繝ｼ繧ｶ繝ｼ縺ｫ蜊ｳ蜿肴丐
    const settings=getUiSettings();
    if(effectiveGlobalUrl(settings))await submitCommunityEntryToGlobal(effectiveGlobalUrl(settings),entry);
    renderGlobalPlayerList();
    const total=getCommunityList().length;
    document.getElementById("globalStatus").textContent=`倹 蜷郁ｨ・{total}莠ｺ`;
    if(viewMode==="global")doStart();
  });
  // 險ｭ螳壹・閾ｪ蜍穂ｿ晏ｭ假ｼ医Μ繝ｭ繝ｼ繝峨・繧ｿ繝夜哩縺俶凾縺ｫ繧ょ渚譏・・  window.addEventListener("beforeunload",()=>{try{saveSettings(getUiSettings());}catch{}});
  // 繧医￥螟画峩縺吶ｋ繝槭ャ繝∬ｨｭ螳壼・蜉帙ｒ螟画峩縺励◆繧牙叉菫晏ｭ・  ["matchWait","matchAvg","matchJitter","reflectDelay","pollInterval","tournamentTotal","rsDropThreshold"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener("change",()=>saveSettings(getUiSettings()));
  });
  // personalRegionFilter 繧ｿ繝・  document.querySelectorAll(".personalRegionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      personalRegionFilter=btn.dataset.pregion;
      document.querySelectorAll(".personalRegionTab").forEach(b=>b.classList.toggle("active",b.dataset.pregion===personalRegionFilter));
      renderTable(lastRows);
    });
  });
  // 閾ｪ蛻・・繝ｪ繧ｹ繝・竊・繧ｰ繝ｭ繝ｼ繝舌Ν縺ｫ繧ｳ繝斐・
  document.getElementById("btnCopyToGlobal")?.addEventListener("click",async()=>{
    const names=parseNames(document.getElementById("namesBox").value);
    if(!names.length){toast("繝ｪ繧ｹ繝医′遨ｺ縺ｧ縺・);return;}
    const settings=getUiSettings();
    let added=0;
    const newEntries=[];
    for(const name of names){
      if(!getCommunityList().find(e=>e.name.toLowerCase()===name.toLowerCase())){
        const entry={name,region:"",category:"notable",note:""};
        addCommunityEntry(entry);
        newEntries.push(entry);
        added++;
      }
    }
    if(effectiveGlobalUrl(settings)){
      await Promise.all(newEntries.map(e=>submitCommunityEntryToGlobal(effectiveGlobalUrl(settings),e)));
    }
    toast(`倹 <b>${added}莠ｺ</b> 繧偵げ繝ｭ繝ｼ繝舌Ν繝ｪ繧ｹ繝医↓繧ｳ繝斐・縺励∪縺励◆`);
    if(viewMode==="global")renderGlobalPlayerList();
  });
  // 繝ｭ繧ｰ
  document.getElementById("btnLogTimeline")?.addEventListener("click",()=>{
    logViewMode=logViewMode==="list"?"timeline":"list";
    const btn=document.getElementById("btnLogTimeline");
    if(btn)btn.textContent=logViewMode==="list"?"投 繧ｿ繧､繝繝ｩ繧､繝ｳ":"搭 繝ｪ繧ｹ繝・;
    logViewMode==="timeline"?renderLogTimeline():renderLogList();
  });
  document.getElementById("btnExportLogs")?.addEventListener("click",exportStateLogs);
  document.getElementById("btnClearLogs")?.addEventListener("click",()=>{
    if(!confirm("繝ｭ繧ｰ繧偵け繝ｪ繧｢縺励∪縺吶°・・))return;
    clearStateLogs();renderLogList();toast("繝ｭ繧ｰ繧偵け繝ｪ繧｢縺励∪縺励◆");
    logViewMode="list";
    const btn=document.getElementById("btnLogTimeline");
    if(btn)btn.textContent="投 繧ｿ繧､繝繝ｩ繧､繝ｳ";
  });
  // 笏笏 繝・・繝悶Ν繝倥ャ繝繝ｼ ? 繧｢繧､繧ｳ繝ｳ: fixed 繧ｰ繝ｭ繝ｼ繝舌Ν繝・・繝ｫ繝√ャ繝・笏笏笏笏笏笏笏笏笏笏
  // tableWrap 縺ｮ overflow:auto / position:sticky 縺ｫ繧医ｋ clipping 繧貞屓驕ｿ
  const gTip=document.getElementById("globalTooltip");
  if(gTip){
    let gTipTimer=null;
    document.querySelectorAll("th .thHelpIcon").forEach(icon=>{
      const tipEl=icon.nextElementSibling; // .thHelpTip
      if(!tipEl)return;
      icon.addEventListener("mouseenter",()=>{
        clearTimeout(gTipTimer);
        gTip.innerHTML=tipEl.innerHTML;
        gTip.classList.add("show");
        // 蛻晄悄陦ｨ遉ｺ・亥ｹ・ｨ育ｮ怜燕・・        const rect=icon.getBoundingClientRect();
        let left=rect.left;
        let top=rect.bottom+6;
        gTip.style.left=left+"px";
        gTip.style.top=top+"px";
        // 1繝輔Ξ繝ｼ繝蠕後↓繧ｵ繧､繧ｺ縺檎｢ｺ螳壹＠縺ｦ縺九ｉ菴咲ｽｮ陬懈ｭ｣
        requestAnimationFrame(()=>{
          const tw=gTip.offsetWidth, th2=gTip.offsetHeight;
          if(left+tw>window.innerWidth-8) left=Math.max(8,window.innerWidth-tw-8);
          if(top+th2>window.innerHeight-8) top=Math.max(8,rect.top-th2-6);
          gTip.style.left=left+"px";
          gTip.style.top=top+"px";
        });
      });
      icon.addEventListener("mouseleave",()=>{
        gTipTimer=setTimeout(()=>gTip.classList.remove("show"),80);
      });
    });
  }
  // 笏笏 繝ｭ繧ｰ繧､繝ｳ繝｢繝ｼ繝繝ｫ 繧､繝吶Φ繝・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
  document.getElementById("btnLoginSubmit").addEventListener("click",async()=>{
    const id=document.getElementById("loginId").value.trim();
    const pw=document.getElementById("loginPassword").value;
    if(!id||!pw){document.getElementById("loginError").textContent="ID縺ｨ繝代せ繝ｯ繝ｼ繝峨ｒ蜈･蜉帙＠縺ｦ縺上□縺輔＞";return;}
    const hash=await sha256(pw);
    const ok=getEffectiveAllowedUsers().find(u=>u.id.toLowerCase()===id.toLowerCase()&&u.passwordHash===hash);
    if(ok){setCurrentUser(id);hideLoginModal();if(_loginCallback)_loginCallback();}
    else{document.getElementById("loginError").textContent="ID縺ｾ縺溘・繝代せ繝ｯ繝ｼ繝峨′豁｣縺励￥縺ゅｊ縺ｾ縺帙ｓ";}
  });
  document.getElementById("btnLoginCancel").addEventListener("click",hideLoginModal);
  document.getElementById("loginPassword").addEventListener("keydown",(e)=>{if(e.key==="Enter")document.getElementById("btnLoginSubmit").click();});
  document.getElementById("btnLogout").addEventListener("click",()=>{setCurrentUser(null);toast(t("toast.logout"));});
  // 繝｢繝ｼ繝繝ｫ閭梧勹繧ｯ繝ｪ繝・け縺ｧ髢峨§繧・  document.getElementById("loginModal").addEventListener("click",(e)=>{if(e.target===e.currentTarget)hideLoginModal();});

  // 笏笏 繧｢繝峨Α繝ｳ繝代ロ繝ｫ 繧､繝吶Φ繝・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
  document.getElementById("btnAdminUnlock").addEventListener("click",async()=>{
    const pw=document.getElementById("adminPasswordInput").value;
    if(!pw)return;
    const auth=getAuthData();
    if(!auth.adminPasswordHash){
      // 蛻晏屓・壹ヱ繧ｹ繝ｯ繝ｼ繝峨ｒ譁ｰ隕剰ｨｭ螳・      auth.adminPasswordHash=await sha256(pw);
      saveAuthData(auth);
      toast("泊 繧｢繝峨Α繝ｳ繝代せ繝ｯ繝ｼ繝峨ｒ險ｭ螳壹＠縺ｾ縺励◆");
    }else{
      if(await sha256(pw)!==auth.adminPasswordHash){toast("笶・繝代せ繝ｯ繝ｼ繝峨′豁｣縺励￥縺ゅｊ縺ｾ縺帙ｓ");return;}
    }
    document.getElementById("adminPanel").style.display="";
    renderAllowedUserList();
  });
  document.getElementById("btnAddUser").addEventListener("click",async()=>{
    const id=document.getElementById("newUserId").value.trim();
    const pw=document.getElementById("newUserPassword").value;
    if(!id||!pw){toast("ID縺ｨ繝代せ繝ｯ繝ｼ繝峨ｒ蜈･蜉帙＠縺ｦ縺上□縺輔＞");return;}
    const auth=getAuthData();
    if(auth.allowedUsers.find(u=>u.id.toLowerCase()===id.toLowerCase())){toast("縺昴・ID縺ｯ譌｢縺ｫ逋ｻ骭ｲ縺輔ｌ縺ｦ縺・∪縺・);return;}
    auth.allowedUsers.push({id,passwordHash:await sha256(pw)});
    saveAuthData(auth);
    document.getElementById("newUserId").value="";
    document.getElementById("newUserPassword").value="";
    renderAllowedUserList();
    updateLoginStatus();
    toast("笨・繝ｦ繝ｼ繧ｶ繝ｼ <b>"+id+"</b> 繧定ｿｽ蜉縺励∪縺励◆");
  });
  document.getElementById("btnChangeAdminPassword").addEventListener("click",async()=>{
    const pw=document.getElementById("newAdminPassword").value;
    if(!pw){toast("譁ｰ縺励＞繝代せ繝ｯ繝ｼ繝峨ｒ蜈･蜉帙＠縺ｦ縺上□縺輔＞");return;}
    const auth=getAuthData();
    auth.adminPasswordHash=await sha256(pw);
    saveAuthData(auth);
    document.getElementById("newAdminPassword").value="";
    toast("泊 繧｢繝峨Α繝ｳ繝代せ繝ｯ繝ｼ繝峨ｒ螟画峩縺励∪縺励◆");
  });

  // 笏笏 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓蜷梧悄繝懊ち繝ｳ 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
  document.getElementById("btnSyncAuth").addEventListener("click",async()=>{
    const settings=getUiSettings();
    if(!effectiveGlobalUrl(settings)){toast("笞・・繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓謗･邯壹〒縺阪∪縺帙ｓ・医Ο繝ｼ繧ｫ繝ｫ迺ｰ蠅・〒縺ｯ Worker URL 縺ｮ險ｭ螳壹′蠢・ｦ√〒縺呻ｼ・);return;}
    const auth=getAuthData();
    if(!auth.adminPasswordHash){toast("笞・・繧｢繝峨Α繝ｳ繝代せ繝ｯ繝ｼ繝峨ｒ蜈医↓險ｭ螳壹＠縺ｦ縺上□縺輔＞");return;}
    document.getElementById("btnSyncAuth").textContent="蜷梧悄荳ｭ...";
    const ok=await syncAuthToBackend(effectiveGlobalUrl(settings),auth.adminPasswordHash,auth.allowedUsers);
    document.getElementById("btnSyncAuth").textContent="笘・ｸ・繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓蜷梧悄";
    if(ok){
      toast("笨・隱崎ｨｼ險ｭ螳壹ｒ繝舌ャ繧ｯ繧ｨ繝ｳ繝峨↓蜷梧悄縺励∪縺励◆");
      _backendAllowedUsers=auth.allowedUsers;
    }else{
      toast("笶・蜷梧悄縺ｫ螟ｱ謨励＠縺ｾ縺励◆・・RL繝ｻ繝代せ繝ｯ繝ｼ繝峨ｒ遒ｺ隱阪＠縺ｦ縺上□縺輔＞・・);
    }
  });

  // 笏笏 Live table繧ｽ繝ｼ繧ｹ蛻・崛繧ｿ繝・笏笏
  document.getElementById("liveTabPersonal").addEventListener("click",()=>{
    liveTabMode="personal";
    document.querySelectorAll("#liveTabPersonal,#liveTabGlobal,#liveTabPickup").forEach(b=>b.classList.remove("active"));
    document.getElementById("liveTabPersonal").classList.add("active");
    if(viewMode!=="personal")switchToPersonal(); else renderTable(lastRows);
  });
  document.getElementById("liveTabGlobal").addEventListener("click",()=>{
    liveTabMode="global";
    document.querySelectorAll("#liveTabPersonal,#liveTabGlobal,#liveTabPickup").forEach(b=>b.classList.remove("active"));
    document.getElementById("liveTabGlobal").classList.add("active");
    if(viewMode!=="global")switchToGlobal(); else renderTable(lastRows);
  });
  document.getElementById("liveTabPickup").addEventListener("click",()=>{
    liveTabMode="pickup";
    document.querySelectorAll("#liveTabPersonal,#liveTabGlobal,#liveTabPickup").forEach(b=>b.classList.remove("active"));
    document.getElementById("liveTabPickup").classList.add("active");
    renderTable(lastRows);
  });
  // 笏笏 Live table繝ｪ繝ｼ繧ｸ繝ｧ繝ｳ繝輔ぅ繝ｫ繧ｿ繝ｼ 笏笏
  document.querySelectorAll(".liveRegionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      liveRegionFilter=btn.dataset.lregion;
      document.querySelectorAll(".liveRegionTab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      renderTable(lastRows);
    });
  });

  // 笏笏 Live table 讀懃ｴ｢ 笏笏
  document.getElementById("liveSearch").addEventListener("input",e=>{
    liveSearchQuery=e.target.value.trim().toLowerCase();
    renderTable(lastRows);
  });

  // 笏笏 繝倥ャ繝繝ｼ隱崎ｨｼ繝懊ち繝ｳ 笏笏
  document.getElementById("btnHeaderLogin").addEventListener("click",()=>showLoginModal());
  document.getElementById("btnHeaderLogout").addEventListener("click",()=>{setCurrentUser(null);toast(t("toast.logout"));});
  document.getElementById("btnHeaderAdmin").addEventListener("click",()=>{document.getElementById("adminModal").style.display="flex";});
  document.getElementById("btnAdminModalClose").addEventListener("click",()=>{document.getElementById("adminModal").style.display="none";});

  // 笏笏 蛻晄悄繝ｭ繧ｰ繧､繝ｳ迥ｶ諷九ｒ蜿肴丐 + globalUrl 縺後≠繧後・繝舌ャ繧ｯ繧ｨ繝ｳ繝峨°繧牙叙蠕・笏笏
  restoreSession(); // 繝壹・繧ｸ繝ｪ繝ｭ繝ｼ繝牙ｾ後ｂ繝ｭ繧ｰ繧､繝ｳ迥ｶ諷九ｒ蠕ｩ蜈・  updateLoginStatus();
  // 騾夂衍繝懊ち繝ｳ縺ｮ蛻晄悄迥ｶ諷・  setNotifyEnabled(notifyEnabled);
  const _initSettings=getUiSettings();
  if(effectiveGlobalUrl(_initSettings)){
    fetchAuthConfig(effectiveGlobalUrl(_initSettings));
    // 襍ｷ蜍墓凾縺ｫ繧ｳ繝溘Η繝九ユ繧｣繝ｪ繧ｹ繝医ｒ繝舌ャ繧ｯ繧ｨ繝ｳ繝峨→蜷梧悄・亥・繝ｦ繝ｼ繧ｶ繝ｼ縺ｧ蜈ｱ譛峨Μ繧ｹ繝医ｒ蜿肴丐・・    fetchAndMergeCommunity(effectiveGlobalUrl(_initSettings)).then(()=>{
      if(viewMode==="global")renderGlobalPlayerList();
    });
  }

  setRunning(false);
  toast(t("toast.ready"));
}
init();

async function fetchLeaderboardViaProxy(settings){
  const base = effectiveProxyBase(settings);
  const url = base
    ? `${base}/api/leaderboard?season=${encodeURIComponent(settings.leaderboardId)}&platform=${encodeURIComponent(settings.platform)}&cache=${encodeURIComponent(settings.estCacheSec||30)}`
    : `https://api.the-finals-leaderboard.com/v1/leaderboard/${encodeURIComponent(settings.leaderboardId)}/${encodeURIComponent(settings.platform)}`;
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error(`leaderboard ${r.status}`);
  return await r.json();
}

function normalizeLeaderboardArray(json){
  if(Array.isArray(json)) return json;
  if(json && Array.isArray(json.data)) return json.data;
  if(json && Array.isArray(json.entries)) return json.entries;
  return [];
}

function pickPoints(entry){
  if(!entry || typeof entry!=="object") return null;
  const candidates=["points","score","rankScore","rank_score","rank_points","fame","value"];
  for(const k of candidates){
    if(entry[k]!==undefined && entry[k]!==null && entry[k]!=="" && !Number.isNaN(Number(entry[k]))) return Number(entry[k]);
  }
  return null;
}

function pickRank(entry, fallback){
  const candidates=["rank","position","place","leaderboardRank","leaderboard_rank","index"];
  for(const k of candidates){
    if(entry && entry[k]!==undefined && entry[k]!==null && !Number.isNaN(Number(entry[k]))) return Number(entry[k]);
  }
  return fallback;
}

function pickName(entry){
  const candidates=["name","displayName","display_name","userName","username","playerName","player_name","accountName","account_name","id"];
  for(const k of candidates){
    if(entry && typeof entry[k]==="string" && entry[k].trim()) return entry[k].trim();
  }
  return "";
}

function leaderboardFingerprint(entries, start, size){
  const s = Math.max(0, start|0);
  const n = Math.max(1, size|0);
  const slice = entries.slice(s, s+n);
  let changedRows=0;

  const parts=[];
  for(let i=0;i<slice.length;i++){
    const e=slice[i];
    const rank = pickRank(e, s+i+1);
    const name = pickName(e);
    const pts = pickPoints(e);
    parts.push(`${rank}|${name}|${pts}`);
  }
  const joined = parts.join("\n");
  const hash = fnv1a(joined);

  if(estimator.lastSnapshot){
    const prev = estimator.lastSnapshot;
    const m = Math.min(prev.length, slice.length);
    for(let i=0;i<m;i++){
      const a = prev[i], b = slice[i];
      const ar = pickRank(a, s+i+1), br = pickRank(b, s+i+1);
      const an = pickName(a), bn = pickName(b);
      const ap = pickPoints(a), bp = pickPoints(b);
      if(ar!==br || an!==bn || ap!==bp) changedRows++;
    }
    if(slice.length!==prev.length) changedRows += Math.abs(slice.length-prev.length);
  }

  estimator.lastSnapshot = slice;
  return {hash, changedRows};
}

function addInterval(ms){
  if(ms<=0) return;
  estimator.intervals.push(ms);
  if(estimator.intervals.length>200) estimator.intervals.shift();
}

function statsFromIntervals(){
  const arr = estimator.intervals.slice().sort((a,b)=>a-b);
  if(arr.length===0) return null;
  const mean = arr.reduce((s,x)=>s+x,0)/arr.length;
  const median = arr[Math.floor(arr.length*0.5)];
  const p90 = arr[Math.floor(arr.length*0.9)];
  return {mean, median, p90, n: arr.length};
}

function fmtMin(ms){
  if(!ms) return "-";
  return `${(ms/60000).toFixed(1)}m`;
}

function autoUpdateReflect(){
  const s = statsFromIntervals();
  if(!s || s.n < 3) return;
  const newMin = Math.max(1, Math.round(s.median / 60000));
  const el = document.getElementById("reflectDelay");
  if(!el || parseInt(el.value,10) === newMin) return;
  el.value = String(newMin);
  if(currentSettings) currentSettings.reflectDelayMin = newMin;
  const hint = document.getElementById("estReflectHint");
  if(hint) hint.textContent = `竊・Reflect X 繧・${newMin}m 縺ｫ閾ｪ蜍墓峩譁ｰ`;
}
function updateEstimatorUi(){
  const last = document.getElementById("estLastBatch");
  if(!last) return;
  last.textContent = estimator.lastBatchAt ? new Date(estimator.lastBatchAt).toLocaleTimeString() : "-";
  const s = statsFromIntervals();
  document.getElementById("estMean").textContent = s?fmtMin(s.mean):"-";
  document.getElementById("estMedian").textContent = s?fmtMin(s.median):"-";
  document.getElementById("estP90").textContent = s?fmtMin(s.p90):"-";
  document.getElementById("estChanged").textContent = String(estimator.lastChangedRows||0);
  autoUpdateReflect();
}

async function pollLeaderboardEstimator(settings){
  if(!settings.estimatorEnabled) return;
  try{
    const json = await fetchLeaderboardViaProxy(settings);
    const entries = normalizeLeaderboardArray(json);
    if(entries.length===0) return;

    leaderboardCache=entries;
    const {hash, changedRows} = leaderboardFingerprint(entries, settings.estWindowStart||0, settings.estWindowSize||500);
    estimator.lastChangedRows = changedRows;

    if(estimator.lastHash!==null && hash!==estimator.lastHash){
      const now = Date.now();
      if(estimator.lastBatchAt){
        addInterval(now - estimator.lastBatchAt);
      }
      estimator.lastBatchAt = now;
    }
    estimator.lastHash = hash;
    updateEstimatorUi();
  }catch(e){
    updateEstimatorUi();
  }
}

;
