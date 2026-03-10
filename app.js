const LS={settings:"finals_tracker_settings_v3",snapshots:"finals_tracker_snapshots_v3",events:"finals_tracker_events_v3",names:"finals_tracker_names_v1",community:"finals_tracker_community_v1",auth:"finals_tracker_auth_v1",session:"finals_tracker_session_v1"};
const DEFAULTS={proxyBase:"",globalUrl:"",leaderboardId:"s9",platform:"crossplay",pollIntervalSec:60,reflectDelayMin:8,matchWaitMin:5,matchAvgMin:31,matchJitterMin:3,tournamentTotalMin:45,estimatorEnabled:true,estWindowStart:2000,estWindowSize:500,estCacheSec:30,maxEvents:5000,rsDropThreshold:1000};
// バックエンド URL 自動解決：明示設定がなければ同オリジン（Worker 配信時）を使用
function autoOrigin(){const o=location.origin;return(o==="null"||o.startsWith("file:")||o.includes("localhost")||o.includes("127.0.0.1"))?"":o;}
function effectiveProxyBase(s){return(s.proxyBase||"").replace(/\/$/,"")||autoOrigin();}
function effectiveGlobalUrl(s){return(s.globalUrl||"").replace(/\/$/,"")||autoOrigin();}
let timer=null,running=false,currentSettings=null;
let lastCommunitySync=0; // グローバルリスト自動同期の最終実行時刻
let viewMode="personal",globalNames=[],globalFilter="all";
const expandedRows=new Set();
let pendingScrollY=null; // リロード後スクロール位置復元用
let lastRows=[]; // 最後に描画した行データ（遭遇ボタン即時再描画用）
let pickedUp=new Set(); // pickup（大型グラフ対象）
let personalRegionFilter="all"; // 自分のリスト サーバーフィルター
let liveRegionFilter="all";    // Live tableリージョンフィルター
let liveTabMode="personal";    // "personal" | "global" | "pickup"
let liveSearchQuery="";        // Live table検索
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
    bar.title=`+${i}分後: ${probs[i]}%`;
    barsEl.appendChild(bar);
  }
  const axisEl=document.createElement("div");axisEl.className="psAxis";
  [0,5,10,15,20,25].forEach(m=>{const s=document.createElement("span");s.textContent=m===0?"今":"+"+m+"m";axisEl.appendChild(s);});
  wrap.appendChild(barsEl);wrap.appendChild(axisEl);
  return wrap;
}
function buildExpandRow(r,key){
  const tr=document.createElement("tr");tr.className="expandRow";tr.dataset.for=key;
  const td=document.createElement("td");td.colSpan=10;td.className="expandCell";
  // ── 遭遇記録パネル ──
  const panel=document.createElement("div");panel.className="encounterPanel";
  const elabel=document.createElement("div");elabel.className="encounterLabel";elabel.textContent="📝 遭遇記録";panel.appendChild(elabel);
  const btns=document.createElement("div");btns.className="encounterBtns";
  const s=currentSettings||getUiSettings();
  for(const et of ENCOUNTER_TYPES){
    if(et.group){
      // ── グループボタン（R1/R2）：クリックでサブパネル展開 ──
      const wrap=document.createElement("div");wrap.className="encounterGroup";
      const gBtn=document.createElement("button");gBtn.className="encounterBtn encounterGroupBtn";
      gBtn.title=et.desc;
      gBtn.innerHTML=et.label+' <span class="groupCaret">▾</span>';
      const subPanel=document.createElement("div");subPanel.className="encounterSubPanel";
      for(const sub of et.sub){
        const sBtn=document.createElement("button");sBtn.className="encounterSubBtn";
        sBtn.textContent=sub.label;sBtn.title="offset: -"+sub.getOffset(s)+"分";
        sBtn.addEventListener("click",(e)=>{
          e.stopPropagation();
          applyEncounterEvent(r.name,sub.key);
          subPanel.classList.remove("open");
          gBtn.querySelector(".groupCaret").textContent="▾";
        });
        subPanel.appendChild(sBtn);
      }
      gBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const isOpen=subPanel.classList.contains("open");
        // 他のサブパネルを全部閉じる
        btns.querySelectorAll(".encounterSubPanel.open").forEach(p=>{
          p.classList.remove("open");
          const gc=p.previousElementSibling&&p.previousElementSibling.querySelector(".groupCaret");if(gc)gc.textContent="▾";
        });
        if(!isOpen){subPanel.classList.add("open");gBtn.querySelector(".groupCaret").textContent="▴";}
      });
      wrap.appendChild(gBtn);wrap.appendChild(subPanel);btns.appendChild(wrap);
    }else{
      const btn=document.createElement("button");
      btn.className="encounterBtn"+(et.key==="offline"?" encounterBtn--offline":"");
      btn.title=et.desc;btn.textContent=et.label+(et.overrideDurationMs?" ("+Math.round(et.overrideDurationMs/60000)+"分)":"");
      btn.addEventListener("click",(e)=>{e.stopPropagation();applyEncounterEvent(r.name,et.key);});
      btns.appendChild(btn);
    }
  }
  panel.appendChild(btns);
  // アクティブな手動記録があれば残り時間を表示
  if(r.manualEvent){
    const now2=nowMs();
    const rem=manualRem(r.manualEvent);
    const activeEl=document.createElement("div");activeEl.className="encounterActive";
    const et=findEncounterType(r.manualEvent.type);
    activeEl.innerHTML="📌 <b>"+(et?et.label:r.manualEvent.type)+"</b> 記録中・残 <b>"+rem+"分</b> 優先予測";
    panel.appendChild(activeEl);
  }
  td.appendChild(panel);
  td.appendChild(buildPlayerSparkEl(r));
  // ── ポイント推移グラフ ──
  const evts=getEvents().filter(e=>e.name.toLowerCase()===r.name.toLowerCase()&&e.delta!=null).slice(-48);
  if(evts.length>=2){
    const latestPts=evts[evts.length-1]?.points ?? null;
    const startPts=evts[0]?.points ?? null;
    const diffPts=(latestPts!=null&&startPts!=null)?latestPts-startPts:null;
    const chartWrap=document.createElement("div");chartWrap.style.cssText="margin-top:12px;";
    const chartTitle=document.createElement("div");
    chartTitle.style.cssText="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;";
    chartTitle.innerHTML=`<span>📈 ポイント推移（直近${evts.length}回）</span><span style="font-weight:600;color:${diffPts>0?"#ff6b6b":diffPts<0?"#6ea8ff":"#8ea0b7"}">${diffPts==null?"":(diffPts>0?"+":"")+diffPts.toLocaleString()}</span>`;
    const canvas=document.createElement("canvas");
    canvas.width=520;canvas.height=140;
    canvas.style.cssText="width:100%;max-width:520px;height:140px;display:block;border-radius:8px;background:#081522;border:1px solid #16304a;";
    chartWrap.appendChild(chartTitle);chartWrap.appendChild(canvas);td.appendChild(chartWrap);
    requestAnimationFrame(()=>{
      const ctx=canvas.getContext("2d");if(!ctx)return;
      const W=canvas.width,H=canvas.height,padL=28,padR=10,padT=12,padB=18;
      const pts=evts.map(e=>e.points).filter(p=>p!=null);
      if(pts.length<2)return;
      const mn=Math.min(...pts),mx=Math.max(...pts),range=mx-mn||1;
      const sx=(i)=>padL+(i/(pts.length-1))*(W-padL-padR);
      const sy=(v)=>H-padB-((v-mn)/range)*(H-padT-padB);
      ctx.clearRect(0,0,W,H);
      // grid
      ctx.strokeStyle="rgba(90,122,170,0.18)";
      ctx.lineWidth=1;
      for(let g=0;g<4;g++){
        const y=padT+((H-padT-padB)/3)*g;
        ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
      }
      // fill
      const grad=ctx.createLinearGradient(0,padT,0,H-padB);
      grad.addColorStop(0,"rgba(94,168,255,0.30)");
      grad.addColorStop(1,"rgba(94,168,255,0.02)");
      ctx.beginPath();ctx.moveTo(sx(0),sy(pts[0]));
      for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
      ctx.lineTo(sx(pts.length-1),H-padB);ctx.lineTo(sx(0),H-padB);ctx.closePath();
      ctx.fillStyle=grad;ctx.fill();
      // line
      ctx.beginPath();ctx.moveTo(sx(0),sy(pts[0]));
      for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
      ctx.strokeStyle="#73b7ff";ctx.lineWidth=2;ctx.stroke();
      // points
      for(let i=0;i<pts.length;i++){
        const x=sx(i),y=sy(pts[i]);
        ctx.beginPath();ctx.arc(x,y,i===pts.length-1?4:2.5,0,Math.PI*2);
        ctx.fillStyle=i===pts.length-1?"#9dd0ff":"#73b7ff";
        ctx.fill();
      }
      // labels
      ctx.font="10px monospace";ctx.fillStyle="#6f89ab";
      ctx.fillText(mx.toLocaleString(),2,padT+4);
      ctx.fillText(mn.toLocaleString(),2,H-padB);
      const lx=sx(pts.length-1),ly=sy(pts[pts.length-1]);
      ctx.font="bold 10px monospace";ctx.fillStyle="#a9d4ff";
      ctx.fillText(pts[pts.length-1].toLocaleString(),Math.max(padL,lx-24),Math.max(padT+10,ly-8));
      // x axis hints
      ctx.font="9px monospace";ctx.fillStyle="#4f6b8f";
      [0,Math.floor((pts.length-1)/2),pts.length-1].forEach((idx,i)=>{
        const label=i===0?"old":i===1?"mid":"new";
        const x=sx(idx)-8;
        ctx.fillText(label,x,H-4);
      });
    });
  }
  // ── サーバー選択 ──
  const regionWrap=document.createElement("div");regionWrap.style.cssText="margin-top:10px;display:flex;align-items:center;gap:8px;";
  const rLabel=document.createElement("span");rLabel.textContent="Server";rLabel.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;";
  const rSel=document.createElement("select");rSel.style.cssText="height:28px;font-size:12px;padding:2px 6px;";
  [["","—"],["AS","🌏 AS"],["EU","🌍 EU"],["NA","🌎 NA"]].forEach(([v,l])=>{
    const o=document.createElement("option");o.value=v;o.textContent=l;if((r.region||"")===v)o.selected=true;rSel.appendChild(o);
  });
  rSel.addEventListener("change",()=>{
    const snaps=getSnapshots();const k2=r.name.toLowerCase();
    if(!snaps[k2])snaps[k2]={};snaps[k2].region=rSel.value;saveSnapshots(snaps);
    lastRows=lastRows.map(row=>row.name.toLowerCase()===k2?{...row,region:rSel.value}:row);
    renderTable(lastRows);toast("Server: <b>"+r.name+"</b> → "+(rSel.value||"—"));
    // グローバルリスト編集の backend 同期
    const _rs=getUiSettings();
    {
      const _re=getCommunityList().find(e=>e.name.toLowerCase()===k2);
      if(_re)submitCommunityEntryToGlobal(effectiveGlobalUrl(_rs),{..._re,region:rSel.value});
    }
  });
  regionWrap.appendChild(rLabel);regionWrap.appendChild(rSel);td.appendChild(regionWrap);
  // ── メモ ──
  const memoWrap=document.createElement("div");memoWrap.style.cssText="margin-top:8px;display:flex;align-items:flex-start;gap:8px;";
  const memoLbl=document.createElement("span");memoLbl.textContent="📝 Memo";memoLbl.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;min-width:44px;padding-top:4px;white-space:nowrap;";
  const memoTa=document.createElement("textarea");memoTa.style.cssText="flex:1;height:44px;font-size:12px;padding:4px 6px;background:#0a1a2e;border:1px solid #1e2e40;color:#e7edf5;border-radius:4px;resize:vertical;font-family:inherit;";
  memoTa.value=(getSnapshots()[r.name.toLowerCase()]||{}).memo||"";
  memoTa.placeholder="個人メモ（自分のみ表示）";
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
    const c=rowEl.querySelector(".expandCaret");if(c)c.textContent="▾";
  }else{
    expandedRows.add(key);rowEl.insertAdjacentElement("afterend",buildExpandRow(r,key));
    const c=rowEl.querySelector(".expandCaret");if(c)c.textContent="▴";
  }
}
const estimator={lastHash:null,lastBatchAt:null,lastSnapshot:null,intervals:[],lastChangedRows:0};
let leaderboardCache=[],leaderboardFetching=false;
function fnv1a(str){let h=2166136261;for(let i=0;i<str.length;i++){h=(h^str.charCodeAt(i))>>>0;h=Math.imul(h,16777619)>>>0;}return h>>>0;}
const nowMs=()=>Date.now();
const fmtTs=(ms)=>{
  if(!ms)return"—";
  const diff=Date.now()-ms;
  const min=Math.floor(diff/60000);
  const t=new Date(ms).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
  if(min<1)return`<1m (${t})`;
  if(min<60)return`${min}m (${t})`;
  const h=Math.floor(min/60);
  return`${h}h${min%60|0}m (${t})`;
};
const fmtAgo=(ms)=>{
  if(!ms)return"—";
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
// ── ブラウザ通知 ─────────────────────────────────────────────────
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
  if(btn)btn.title=on?"通知ON（クリックでOFF）":"通知OFF（クリックでON）";
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
// イベント履歴から指定プレイヤーの最後のポイント変動時刻を取得
function getLastChangeAtFromEvents(key){
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
// ── コミュニティリスト（ローカル + バックエンド同期） ─────────
// entry: { name, region:"AS"|"EU"|"NA"|"", category:"cheater"|"suspicious"|"notable", note, addedAt }
const REGION_LABEL={"AS":"🌏 AS","EU":"🌍 EU","NA":"🌎 NA","":"🌐 不明"};
const REGION_ORDER=["AS","EU","NA",""];
const CAT_LABEL={"cheater":"🚫 チーター","suspicious":"⚠️ 疑い","notable":"👁 注目"};
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
    if(!r.ok){setGlobalSyncStatus("⚠️ 同期失敗 (HTTP "+r.status+")",true);return;}
    const remote=await r.json();
    const arr=Array.isArray(remote)?remote:(remote.entries||[]);
    const localMap=new Map(getCommunityList().map(e=>[e.name.toLowerCase(),e]));
    // サーバーリストを正として同期（推測なし）
    // ・server に無いエントリは除外（削除反映）
    // ・server にあるエントリは採用。ただし local の updatedAt がより新しければ local 優先
    //   （submitCommunityEntryToGlobal 直後など、サーバーへの反映前を保護するため）
    const merged=arr.map(re=>{
      const k=re.name.toLowerCase();
      const loc=localMap.get(k);
      if(loc&&loc.updatedAt&&re.updatedAt&&loc.updatedAt>re.updatedAt)return loc;
      return re;
    });
    saveCommunityList(merged);
  }catch(e){
    setGlobalSyncStatus("⚠️ 同期エラー",true);
    console.error("fetchAndMergeCommunity:",e);
  }
}
// スナップショット（状態タイミング）をバックエンドと定期同期
// 責務: /community = 共有リスト本体、/snapshots = 状態共有（lastChangeAt timing）
// ポーリングで直接取得した points/state は上書きしない。lastChangeAt timing のみ更新する
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
        // 手動遭遇は自端末の操作を優先
        ...(locSnap.manualEvent?{manualEvent:locSnap.manualEvent}:{}),
      };
      // lastChangeAt が無いデータで current state が落ちるのを防ぐ
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
// ── グローバルバックエンド API ──────────────────────────────
async function fetchGlobalNames(globalUrl){
  const r=await fetch(globalUrl.replace(/\/$/,"")+"/names",{cache:"no-store"});
  if(!r.ok)throw new Error("global /names failed: "+r.status);
  const d=await r.json();return Array.isArray(d)?d:(d.names||[]);
}
async function fetchGlobalSnapshots(globalUrl){
  try{const r=await fetch(globalUrl.replace(/\/$/,"")+"/snapshots",{cache:"no-store"});if(!r.ok)return{};return await r.json();}catch{return{};}
}
// UI エラー表示ヘルパー（#globalStatus に最大10秒表示）
function setGlobalSyncStatus(msg,isError=false){
  const el=document.getElementById("globalStatus");
  if(!el)return;
  el.textContent=msg;
  el.style.color=isError?"#ff6b6b":"";
  if(isError)setTimeout(()=>{if(el.textContent===msg)el.style.color="";},10000);
}
// 書き込みリクエスト用ヘッダー
// 優先順位: admin hash → ログイン中 allowed user の hash → 無し（未ログイン）
function getWriteHeaders(){
  const h={"Content-Type":"application/json"};
  const auth=getAuthData();
  // admin として設定済みなら admin hash を使う
  if(auth.adminPasswordHash){
    h["X-Write-Key"]=auth.adminPasswordHash;
    return h;
  }
  // allowed user としてログイン中なら、その user の hash を使う
  // auth.allowedUsers は fetchAuthConfig() でバックエンドから取得済み ({id, passwordHash}[])
  if(currentUser&&Array.isArray(auth.allowedUsers)){
    const u=auth.allowedUsers.find(u=>u.id===currentUser.id);
    if(u&&u.passwordHash)h["X-Write-Key"]=u.passwordHash;
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
// コミュニティエントリをバックエンドの /community に送信（他ユーザーへ即時反映）
// /community は共有リスト本体のみ（status/lastSeen 等の状態は /submit で管理）
// updatedAt / sourceUser を付与して worker 側の条件 merge を有効にする
async function submitCommunityEntryToGlobal(globalUrl,entry){
  try{
    const now=Date.now();
    const payload={
      name:       entry.name,
      region:     entry.region     || "",
      category:   entry.category   || "notable",
      note:       entry.note       || "",
      addedAt:    entry.addedAt    || now,
      updatedAt:  entry.updatedAt  || now,
      sourceUser: currentUser?.id  || "",
    };
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/community",{method:"POST",headers:getWriteHeaders(),body:JSON.stringify(payload)});
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      setGlobalSyncStatus("⚠️ 追加失敗: "+(err.error||r.status),true);
      console.error("submitCommunityEntryToGlobal HTTP",r.status,err);
    }
  }catch(e){
    setGlobalSyncStatus("⚠️ 追加エラー",true);
    console.error("submitCommunityEntryToGlobal:",e);
  }
}
// コミュニティエントリをバックエンドから削除
async function deleteCommunityEntryFromGlobal(globalUrl,name){
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/community?name="+encodeURIComponent(name),{method:"DELETE",headers:getWriteHeaders()});
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      setGlobalSyncStatus("⚠️ 削除失敗: "+(err.error||r.status),true);
      console.error("deleteCommunityEntryFromGlobal HTTP",r.status,err);
      return false;
    }
    return true;
  }catch(e){
    setGlobalSyncStatus("⚠️ 削除エラー",true);
    console.error("deleteCommunityEntryFromGlobal:",e);
    return false;
  }
}
// 遭遇タイプ: group:true のものは sub[] をドロップダウン表示
const ENCOUNTER_TYPES=[
  {key:"won",label:"🏆 勝利",desc:"試合に勝利した（即ロビーへ）",getOffset:s=>0},
  {key:"final_end",label:"💀 FINAL終了",desc:"FINALラウンド終了（負け）",getOffset:s=>0},
  {key:"r1",label:"R1",desc:"ラウンド1で遭遇",group:true,sub:[
    {key:"r1_early",label:"序盤",getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r1_mid",label:"中盤",getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r1_late",label:"終盤",getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  {key:"r2",label:"R2",desc:"ラウンド2で遭遇",group:true,sub:[
    {key:"r2_early",label:"序盤",getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r2_mid",label:"中盤",getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r2_late",label:"終盤",getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  {key:"offline",label:"⚫ オフライン",desc:"オフライン確認（5分のみ有効）",overrideDurationMs:300000,getOffset:s=>s.reflectDelayMin+s.tournamentTotalMin+30},
];
function findEncounterType(key){
  for(const et of ENCOUNTER_TYPES){
    if(et.key===key)return et;
    if(et.sub){const s=et.sub.find(s=>s.key===key);if(s)return s;}
  }
  return null;
}
function isManualActive(me){if(!me)return false;return(nowMs()-me.recordedAt)<(me.overrideDurationMs??3600000);}
function manualRem(me){if(!me)return 0;return Math.max(0,Math.round(((me.recordedAt+(me.overrideDurationMs??3600000))-nowMs())/60000));}
function isEncounterDanger(me){return isManualActive(me)&&me.type!=="offline"&&me.type!=="won"&&me.type!=="final_end";}

async function sha256(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function getAuthData(){
  try{const r=localStorage.getItem(LS.auth);return r?JSON.parse(r):{adminPasswordHash:"",allowedUsers:[]};}
  catch{return{adminPasswordHash:"",allowedUsers:[]};}
}
function saveAuthData(d){try{localStorage.setItem(LS.auth,JSON.stringify(d));}catch{}}

let currentUser=null;
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
  const headerUserInfo=document.getElementById("headerUserInfo");
  const btnHeaderLogout=document.getElementById("btnHeaderLogout");
  const btnHeaderLogin=document.getElementById("btnHeaderLogin");
  if(!headerUserInfo)return;
  if(currentUser){
    headerUserInfo.textContent="👤 "+currentUser.id;
    headerUserInfo.style.display="";
    btnHeaderLogout.style.display="";
    btnHeaderLogin.style.display="none";
  }else{
    headerUserInfo.style.display="none";
    btnHeaderLogout.style.display="none";
    btnHeaderLogin.style.display="";
  }
}

let _backendAllowedUsers=null;
async function fetchAuthConfig(globalUrl){
  if(!globalUrl)return;
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/auth",{cache:"no-store"});
    if(!r.ok)return;
    const d=await r.json();
    if(Array.isArray(d.allowedUsers)){
      _backendAllowedUsers=d.allowedUsers;
      if(currentUser&&d.allowedUsers.length>0&&!d.allowedUsers.find(u=>u.id.toLowerCase()===currentUser.id.toLowerCase())){
        setCurrentUser(null);
      }
      updateLoginStatus();
    }
  }catch{}
}
async function syncAuthToBackend(globalUrl,adminPasswordHash,allowedUsers){
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
function getEffectiveAllowedUsers(){
  if(_backendAllowedUsers!==null)return _backendAllowedUsers;
  return getAuthData().allowedUsers;
}

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

function renderAllowedUserList(){
  const auth=getAuthData();
  const el=document.getElementById("allowedUserList");
  if(!el)return;
  if(auth.allowedUsers.length===0){
    el.innerHTML="<div class='hint' style='margin:6px 0'>許可ユーザーなし（空の場合は誰でも追加可能）</div>";
    return;
  }
  el.innerHTML=auth.allowedUsers.map(u=>
    `<div class="allowedUserRow"><span class="allowedUserId">${u.id}</span>`+
    `<button class="deleteBtn allowedDelBtn" data-id="${u.id}" title="${u.id}を削除">✕</button></div>`
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
  if(!et||et.group)return;
  const now=nowMs();
  const offsetMin=et.getOffset(settings);
  const lastChangeAtOverride=now-offsetMin*60000;
  const snapshots=getSnapshots();
  const key=name.toLowerCase();
  if(!snapshots[key])snapshots[key]={};
  const dur=et.overrideDurationMs??3600000;
  snapshots[key].manualEvent={type:typeKey,recordedAt:now,lastChangeAtOverride,overrideDurationMs:dur};
  saveSnapshots(snapshots);
  const durMin=Math.round(dur/60000);
  toast(et.label+" <b>"+name+"</b> を記録 (offset -"+offsetMin+"分 / "+durMin+"分優先)");
  if(lastRows.length>0){
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
  const seen=new Set();
  const all=[];
  for(const n of [...personal,...community]){
    const k=n.toLowerCase();
    if(!seen.has(k)){seen.add(k);all.push(n);}
  }
  return all;
}
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
  POST_MATCH_WAIT:"state.LOBBY",
  LOBBY:"state.LOBBY",
  IN_MATCH:"state.IN_MATCH_R1",
  IN_TOURNAMENT_DEEP:"state.IN_MATCH_R2",
  RETURNING:"state.FINAL",
  OFFLINE:"state.OFFLINE",
  UNKNOWN:"state.UNKNOWN",
  NOT_FOUND:"state.NOT_FOUND",
  BANNED:"state.BANNED",
  NAME_CHANGED:"state.NAME_CHANGED",
};
function stateLabel(s){return(typeof t==="function"?t(STATE_I18N_KEY[s]||"state.UNKNOWN"):s)||s;}
function renderBadge(rank,league){
  const tier=league||inferLeagueFromRank(rank);
  const rankStr=rank?"#"+rank.toLocaleString():"—";
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
  const tMin=(now-lastChangeAtMs)/60000;
  const X=reflectDelayMin;
  if(!skipOffline20){
    const lastBatch=estimator.lastBatchAt;
    const BATCH_BUF_MS=5*60*1000;
    if(lastBatch && lastBatch > lastChangeAtMs + BATCH_BUF_MS){
      return { state:"OFFLINE", nextMatchProb:0 };
    }
    if(!lastBatch && tMin>=20) return { state:"OFFLINE", nextMatchProb:0 };
  }
  const W=Math.max(0,Math.min(30,matchWaitMin??5));
  const M=Math.max(20,Math.min(60,matchAvgMin||31));
  const J=Math.max(0,Math.min(10,matchJitterMin??3));
  const T=Math.max(M+W+5,Math.min(180,tournamentTotalMin||70));
  let state="LOBBY";
  if(tMin < X) state="POST_MATCH_WAIT";
  else if(tMin < X+W) state="LOBBY";
  else if(tMin < X+W+M) state="IN_MATCH";
  else if(tMin < X+W+M+J) state="IN_MATCH";
  else if(tMin < X+T) state="IN_TOURNAMENT_DEEP";
  else if(tMin < X+T+25) state="RETURNING";
  else state="OFFLINE";
  const peak=X+W;
  const matchEnd=X+W+M+J;
  let p=0;
  if(tMin < X){ p = 0.05 * (tMin / Math.max(1,X)); }
  else if(tMin <= peak){ p = 0.10 + 0.90 * ((tMin-X)/Math.max(1,W)); }
  else if(tMin <= peak + M*0.25){ p = 1.00 - 0.55 * ((tMin-peak)/Math.max(1,M*0.25)); }
  else if(tMin <= matchEnd){ p = 0.45 - 0.25 * ((tMin-(peak+M*0.25))/Math.max(1,matchEnd-peak-M*0.25)); }
  else if(tMin <= X+T){ p = 0.20 - 0.10 * ((tMin-matchEnd)/Math.max(1,X+T-matchEnd)); }
  else { p = 0.05; }
  p=Math.min(0.80,clamp01(p));
  return { state, nextMatchProb:Math.round(p*100) };
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
// ...
