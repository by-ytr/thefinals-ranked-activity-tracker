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
let lastRows=[]; // 最後に描画した行データ（即時再描画用）
let pickedUp=new Set(); // pickup（大型グラフ対象）
let personalRegionFilter="all"; // 自分のリスト サーバーフィルター
let liveRegionFilter="all";    // Live tableリージョンフィルター
let liveTabMode="personal";    // "personal" | "global" | "pickup"
let liveSearchQuery="";        // Live table検索
let liveStateFilter=new Set(); // 状態フィルター（空=全表示、複数選択可）
let liveCatFilter=new Set();   // カテゴリフィルター（空=全表示）

function uiLang(){
  const doc=(document.documentElement.getAttribute("lang")||"").toLowerCase();
  const nav=(navigator.language||navigator.userLanguage||"en").toLowerCase();
  const raw=doc||nav;
  if(raw.startsWith("ja")) return "ja";
  if(raw.startsWith("ko")) return "ko";
  return "en";
}
function uiText(key){
  const lang=uiLang();
  const dict={
    ja:{"enc.won":"勝","enc.offline":"オフ","enc.r1":"R1","enc.r2":"R2","enc.fr":"FR","enc.early":"序盤","enc.mid":"中盤","enc.late":"終盤","action.delete":"削除","th.error.short":"Error","pickup.title":"ピックアップ（大型グラフに追加）"},
    ko:{"enc.won":"승","enc.offline":"오프","enc.r1":"R1","enc.r2":"R2","enc.fr":"FR","enc.early":"초반","enc.mid":"중반","enc.late":"후반","action.delete":"삭제","th.error.short":"오류","pickup.title":"픽업(대형 그래프에 추가)"},
    en:{"enc.won":"WIN","enc.offline":"OFF","enc.r1":"R1","enc.r2":"R2","enc.fr":"FR","enc.early":"Early","enc.mid":"Mid","enc.late":"Late","action.delete":"Delete","th.error.short":"Error","pickup.title":"Pick up (add to large graph)"}
  };
  return (dict[lang]&&dict[lang][key]) || (dict.en[key]) || key;
}
function encounterDisplayLabel(typeKey){
  const map={
    won:uiText("enc.won"), offline:uiText("enc.offline"),
    r1:uiText("enc.r1"), r2:uiText("enc.r2"), fr:uiText("enc.fr"),
    r1_early:`${uiText("enc.r1")}${uiText("enc.early")}`,
    r1_mid:`${uiText("enc.r1")}${uiText("enc.mid")}`,
    r1_late:`${uiText("enc.r1")}${uiText("enc.late")}`,
    r2_early:`${uiText("enc.r2")}${uiText("enc.early")}`,
    r2_mid:`${uiText("enc.r2")}${uiText("enc.mid")}`,
    r2_late:`${uiText("enc.r2")}${uiText("enc.late")}`,
    fr_early:`${uiText("enc.fr")}${uiText("enc.early")}`,
    fr_mid:`${uiText("enc.fr")}${uiText("enc.mid")}`,
    fr_late:`${uiText("enc.fr")}${uiText("enc.late")}`
  };
  return map[typeKey] || typeKey;
}
function compactErrorText(err){ return err ? uiText("th.error.short") : ""; }
function renderQuickEncounterGroup(group){
  const subMap={r1:["r1_early","r1_mid","r1_late"],r2:["r2_early","r2_mid","r2_late"],fr:["fr_early","fr_mid","fr_late"]};
  const items=(subMap[group]||[]).map(ev=>`<button class="encQuickSubBtn" data-ev="${ev}" style="display:block;width:100%;padding:5px 8px;border:0;background:transparent;color:#d9e7ff;text-align:left;font-size:11px;cursor:pointer;">${encounterDisplayLabel(ev)}</button>`).join("");
  return `<div class="encQuickGroup" style="position:relative;display:inline-block;"><button class="encQuickGroupBtn" data-group="${group}" title="${encounterDisplayLabel(group)}" style="min-width:40px;height:24px;padding:0 8px;border-radius:6px;border:1px solid #244a6b;background:#0c1d2d;color:#d9e7ff;font-size:11px;">${encounterDisplayLabel(group)} ▾</button><div class="encQuickMenu" style="display:none;position:absolute;top:26px;left:0;z-index:30;min-width:92px;background:#091626;border:1px solid #183450;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px;"><div>${items}</div></div></div>`;
}
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
  const contentRow=document.createElement("div");contentRow.style.cssText="display:flex;gap:12px;align-items:flex-start;";
  const graphArea=document.createElement("div");graphArea.style.cssText="flex:1;min-width:0;";
  graphArea.appendChild(buildPlayerSparkEl(r));

// ── ポイント推移グラフ ──
const evts=getEvents().filter(e=>e.name.toLowerCase()===r.name.toLowerCase()&&e.delta!=null).slice(-48);
if(evts.length>=2){
  const chartWrap=document.createElement("div");chartWrap.style.cssText="margin-top:12px;";
  const chartTitle=document.createElement("div");
  chartTitle.style.cssText="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;";
  const pts=evts.map(e=>e.points).filter(p=>p!=null);
  const latestPts=pts[pts.length-1];
  const startPts=pts[0];
  const diffPts=(latestPts!=null&&startPts!=null)?latestPts-startPts:null;
  chartTitle.innerHTML=`<span>📈 ポイント推移（直近${evts.length}回）</span><span style="font-weight:600;color:${diffPts>0?"#ff6b6b":diffPts<0?"#6ea8ff":"#8ea0b7"}">${diffPts==null?"":(diffPts>0?"+":"")+diffPts.toLocaleString()}</span>`;
  const canvas=document.createElement("canvas");
  canvas.width=720;canvas.height=180;
  canvas.style.cssText="width:100%;max-width:520px;height:140px;display:block;border-radius:8px;background:#091626;border:1px solid #16314f;";
  chartWrap.appendChild(chartTitle);chartWrap.appendChild(canvas);graphArea.appendChild(chartWrap);
  requestAnimationFrame(()=>{
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const W=canvas.width,H=canvas.height,padL=42,padR=12,padT=14,padB=24;
    if(pts.length<2)return;
    const mn=Math.min(...pts),mx=Math.max(...pts),range=(mx-mn)||1;
    const sx=(i)=>padL+(i/(pts.length-1))*(W-padL-padR);
    const sy=(v)=>H-padB-((v-mn)/range)*(H-padT-padB);
    ctx.clearRect(0,0,W,H);

    // grid
    ctx.strokeStyle="rgba(120,150,190,0.18)";
    ctx.lineWidth=1;
    for(let i=0;i<4;i++){
      const y=padT+i*((H-padT-padB)/3);
      ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    }
    for(let i=0;i<4;i++){
      const x=padL+i*((W-padL-padR)/3);
      ctx.beginPath();ctx.moveTo(x,padT);ctx.lineTo(x,H-padB);ctx.stroke();
    }

    // y labels
    ctx.fillStyle="#7f93ad";
    ctx.font="10px monospace";
    [mx, mn + range*0.5, mn].forEach((val,idx)=>{
      const y=idx===0?padT+3:idx===1?padT+(H-padT-padB)/2+3:H-padB+3;
      ctx.fillText(Math.round(val).toLocaleString(),4,y);
    });

    // area
    const grad=ctx.createLinearGradient(0,padT,0,H-padB);
    grad.addColorStop(0,"rgba(94,168,255,0.38)");
    grad.addColorStop(1,"rgba(94,168,255,0.05)");
    ctx.beginPath();
    ctx.moveTo(sx(0),sy(pts[0]));
    for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
    ctx.lineTo(sx(pts.length-1),H-padB);
    ctx.lineTo(sx(0),H-padB);
    ctx.closePath();
    ctx.fillStyle=grad;
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(sx(0),sy(pts[0]));
    for(let i=1;i<pts.length;i++)ctx.lineTo(sx(i),sy(pts[i]));
    ctx.strokeStyle="#73b7ff";
    ctx.lineWidth=2.2;
    ctx.stroke();

    // points
    for(let i=0;i<pts.length;i++){
      const x=sx(i), y=sy(pts[i]);
      ctx.beginPath();ctx.arc(x,y,i===pts.length-1?4:2.5,0,Math.PI*2);
      ctx.fillStyle=i===pts.length-1?"#9dd0ff":"#73b7ff";
      ctx.fill();
    }

    // last label
    const lx=sx(pts.length-1),ly=sy(pts[pts.length-1]);
    ctx.font="bold 11px monospace";
    ctx.fillStyle="#d9ecff";
    const lastLabel=pts[pts.length-1].toLocaleString();
    ctx.fillText(lastLabel,Math.max(padL,Math.min(lx-16,W-padR-ctx.measureText(lastLabel).width)),Math.max(padT+12,ly-8));

    // x labels
    ctx.font="10px monospace";
    ctx.fillStyle="#7f93ad";
    ctx.fillText("old",padL,H-8);
    ctx.fillText("new",W-padR-18,H-8);
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
  regionWrap.appendChild(rLabel);regionWrap.appendChild(rSel);
  // ── メモ（グラフ横に配置） ──
  const memoWrap=document.createElement("div");memoWrap.style.cssText="width:160px;flex-shrink:0;display:flex;flex-direction:column;gap:4px;";
  const memoLbl=document.createElement("span");memoLbl.textContent=t("label.memo");memoLbl.style.cssText="font-size:11px;font-weight:700;color:#5a7aaa;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;";
  const memoTa=document.createElement("textarea");memoTa.style.cssText="width:100%;height:100%;min-height:44px;font-size:12px;padding:4px 6px;background:#0a1a2e;border:1px solid #1e2e40;color:#e7edf5;border-radius:4px;resize:vertical;font-family:inherit;box-sizing:border-box;";
  memoTa.value=(getSnapshots()[r.name.toLowerCase()]||{}).memo||"";
  memoTa.placeholder=t("memo.placeholder");
  let _memoTimer=null;
  memoTa.addEventListener("input",()=>{
    clearTimeout(_memoTimer);
    _memoTimer=setTimeout(()=>{
      const snaps=getSnapshots();const k2=r.name.toLowerCase();
      if(!snaps[k2])snaps[k2]={};snaps[k2].memo=memoTa.value;saveSnapshots(snaps);
    },500);
  });
  memoWrap.appendChild(memoLbl);memoWrap.appendChild(memoTa);
  contentRow.appendChild(graphArea);contentRow.appendChild(memoWrap);
  td.appendChild(contentRow);td.appendChild(regionWrap);
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
function catLabel(cat){const m={"cheater":"opt.cat.cheater","suspicious":"opt.cat.suspicious","notable":"opt.cat.notable","pro":"opt.cat.pro"};return m[cat]?t(m[cat]):cat||"";}
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
  if(auth.adminPasswordHash){
    h["X-Write-Key"]=auth.adminPasswordHash;
    return h;
  }
  if(currentUser){
    const allowed=getEffectiveAllowedUsers();
    if(Array.isArray(allowed)){
      const u=allowed.find(u=>String(u.id||"").toLowerCase()===String(currentUser.id||"").toLowerCase());
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
      updatedAt:  entry.updatedAt  || now,  // merge 判定用タイムスタンプ
      sourceUser: currentUser?.id  || "",   // 書き込んだユーザーID
      // status / lastSeen は /submit (snapshots) で管理するためここには含めない
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
  // サーバー削除の成否を boolean で返す（呼び出し元がローカル削除を制御するため）
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
// ラウンド時間の基準値（要件）:
// R1 = 10〜12分 / R2 = 10〜12分 / Final Round = 8〜10分
const ROUND_WINDOWS={
  r1:{min:10,max:12},
  r2:{min:10,max:12},
  fr:{min:8,max:10},
};
function roundAvg(key){
  const r=ROUND_WINDOWS[key];
  return r?Math.round((r.min+r.max)/2):0;
}
function roundPhaseOffset(key,phase){
  const r=ROUND_WINDOWS[key];
  if(!r)return 0;
  const avg=roundAvg(key);
  switch(phase){
    case "early": return Math.max(1,Math.round(r.min*0.25));
    case "mid":   return Math.max(2,Math.round(avg*0.55));
    case "late":  return Math.max(r.min,Math.round(r.max*0.85));
    default:       return avg;
  }
}
function tournamentRoundBase(s,key){
  const base=(s.reflectDelayMin||0)+(s.matchWaitMin||0);
  if(key==="r1") return base;
  if(key==="r2") return base+roundAvg("r1");
  if(key==="fr") return base+roundAvg("r1")+roundAvg("r2");
  return base;
}
const ENCOUNTER_TYPES=[
  {key:"won",       label:"🏆 勝利",      desc:"試合に勝利した（即ロビーへ）",        getOffset:s=>0},
  {key:"final_end", label:"💀 FINAL終了",  desc:"FINALラウンド終了（負け）",           getOffset:s=>0},
  {key:"r1", label:"R1", desc:"ラウンド1で遭遇", group:true, sub:[
    {key:"r1_early", label:"序盤", getOffset:s=>tournamentRoundBase(s,"r1")+roundPhaseOffset("r1","early")},
    {key:"r1_mid",   label:"中盤", getOffset:s=>tournamentRoundBase(s,"r1")+roundPhaseOffset("r1","mid")},
    {key:"r1_late",  label:"終盤", getOffset:s=>tournamentRoundBase(s,"r1")+roundPhaseOffset("r1","late")},
  ]},
  {key:"r2", label:"R2", desc:"ラウンド2で遭遇", group:true, sub:[
    {key:"r2_early", label:"序盤", getOffset:s=>tournamentRoundBase(s,"r2")+roundPhaseOffset("r2","early")},
    {key:"r2_mid",   label:"中盤", getOffset:s=>tournamentRoundBase(s,"r2")+roundPhaseOffset("r2","mid")},
    {key:"r2_late",  label:"終盤", getOffset:s=>tournamentRoundBase(s,"r2")+roundPhaseOffset("r2","late")},
  ]},
  {key:"fr", label:"FR", desc:"Final Roundで遭遇", group:true, sub:[
    {key:"fr_early", label:"序盤", getOffset:s=>tournamentRoundBase(s,"fr")+roundPhaseOffset("fr","early")},
    {key:"fr_mid",   label:"中盤", getOffset:s=>tournamentRoundBase(s,"fr")+roundPhaseOffset("fr","mid")},
    {key:"fr_late",  label:"終盤", getOffset:s=>tournamentRoundBase(s,"fr")+roundPhaseOffset("fr","late")},
  ]},
  {key:"offline", label:"⚫ オフライン", desc:"オフライン確認（5分のみ有効）", overrideDurationMs:300000, getOffset:s=>s.reflectDelayMin+s.tournamentTotalMin+30},
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

// ── 認証（ID + パスワード制限） ───────────────────────────────
// SHA-256 ハッシュ（Web Crypto API）
async function sha256(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
// 認証データ読み書き（LS.auth）
function getAuthData(){
  try{const r=localStorage.getItem(LS.auth);return r?JSON.parse(r):{adminPasswordHash:"",allowedUsers:[]};}
  catch{return{adminPasswordHash:"",allowedUsers:[]};}
}
function saveAuthData(d){try{localStorage.setItem(LS.auth,JSON.stringify(d));}catch{}}

// セッション（in-memory: ページリロードでクリア）
let currentUser=null; // {id:string} | null
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
  // グローバルリスト内のステータスバー
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
  // ヘッダーのログインボタン
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

// ── バックエンド認証同期 ──────────────────────────────────────────
// バックエンドから許可ユーザーリストを取得してセッション変数に保持
let _backendAllowedUsers=null; // null = 未フェッチ or globalUrl なし
async function fetchAuthConfig(globalUrl){
  if(!globalUrl)return;
  try{
    const r=await fetch(globalUrl.replace(/\/$/,"")+"/auth",{cache:"no-store"});
    if(!r.ok)return;
    const d=await r.json();
    if(Array.isArray(d.allowedUsers)){
      _backendAllowedUsers=d.allowedUsers;
      const auth=getAuthData();
      saveAuthData({...auth,allowedUsers:d.allowedUsers});
      if(currentUser&&d.allowedUsers.length>0&&!d.allowedUsers.find(u=>String(u.id||"").toLowerCase()===String(currentUser.id||"").toLowerCase())){
        setCurrentUser(null);
      }
      renderAllowedUserList();
      updateLoginStatus();
    }
  }catch(e){
    console.error("fetchAuthConfig:",e);
  }
}
// バックエンドに認証設定を同期（アドミンパネルのボタンから呼ぶ）
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
// 有効な許可ユーザーリストを返す（バックエンド優先、fallback はローカル）
function getEffectiveAllowedUsers(){
  if(_backendAllowedUsers!==null)return _backendAllowedUsers;
  return getAuthData().allowedUsers;
}

// ログインモーダル制御
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

// 許可ユーザー一覧レンダリング（アドミンパネル内）
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
  // 個人リストとグローバルリスト両方を常にポーリング → 状態を共有
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
// ────────────────────────────────────────────────────────────
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

function stateExplain(row,displayState){
  const manual=row?.manualEvent;
  if(manual&&isManualActive(manual)){
    const et=findEncounterType(manual.type);
    if(manual.type==="offline") return "手動でオフライン状態として記録中";
    if(manual.type==="won") return "手動で勝利後の戻り時間帯を記録中";
    if(manual.type==="final_end") return "手動でFinal Round終了後の戻り時間帯を記録中";
    if(String(manual.type||"").startsWith("r1_")) return "手動でR1試合中として記録中";
    if(String(manual.type||"").startsWith("r2_")) return "手動でR2試合中として記録中";
    if(String(manual.type||"").startsWith("fr_")) return "手動でFinal Round試合中として記録中";
    return `手動記録「${et?et.label:manual.type}」を優先表示中`;
  }
  switch(displayState){
    case "POST_MATCH_WAIT": return "試合終了直後の反映待ち時間帯です。";
    case "LOBBY": return "試合終了後の待機中と推定。次の試合開始候補です。";
    case "IN_MATCH": return "R1試合中と推定。次の更新までは試合継続扱いです。";
    case "IN_TOURNAMENT_DEEP": return "R2以降の試合中と推定。Final進行中の可能性を含みます。";
    case "RETURNING": return "Final Round終了後の戻り時間帯を推定中。次の更新待ちです。";
    case "OFFLINE": return "最近の更新がなく、現在は非アクティブと推定。";
    case "UNKNOWN": return "情報不足のため状態を判定できません。";
    case "NOT_FOUND": return "リーダーボードで連続未検出。BANまたは名前変更の可能性があります。";
    case "BANNED": return "リーダーボードから完全消失。BANの可能性が高い状態です。";
    case "NAME_CHANGED": return "別名義の候補を検出。名前変更の可能性があります。";
    default: return "";
  }
}
function stateSortPriority(row){
  const isMissing=row.notFoundCount>=3&&row.lastFoundAt;
  const displayState=(isMissing&&row.suspectedReason==="BAN")?"BANNED":
    (isMissing&&row.suspectedReason==="NAME_CHANGE")?"NAME_CHANGED":
    isMissing?"NOT_FOUND":row.state;
  switch(displayState){
    case "POST_MATCH_WAIT": return 0;
    case "LOBBY": return 1;
    case "IN_MATCH": return 2;
    case "IN_TOURNAMENT_DEEP": return 3;
    case "RETURNING": return 4;
    case "UNKNOWN": return 5;
    case "OFFLINE": return 6;
    case "NOT_FOUND": return 7;
    case "NAME_CHANGED": return 8;
    case "BANNED": return 9;
    default: return 10;
  }
}
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

  const tMin = (now - lastChangeAtMs) / 60000;
  const X = Math.max(0, reflectDelayMin||0);

  if(!skipOffline20){
    // ① バッチ検出済み：lastBatchAt が lastChangeAt より 5分以上新しい
    //    → 最新バッチでこのプレイヤーのポイント変動なし = OFFLINE確定
    const lastBatch = estimator.lastBatchAt;
    const BATCH_BUF_MS = 5 * 60 * 1000; // ポーリングズレ吸収バッファ
    if(lastBatch && lastBatch > lastChangeAtMs + BATCH_BUF_MS){
      return { state:"OFFLINE", nextMatchProb:0 };
    }
    // ② バッチデータなし（エスティメーター未起動）→ 時間ベースのフォールバック
    //    ラウンド長の要件（R1 10-12 / R2 10-12 / FR 8-10）に合わせて上限を決定
    if(!lastBatch){
      const offlineFallback = X + (matchWaitMin||5) + ROUND_WINDOWS.r1.max + ROUND_WINDOWS.r2.max + ROUND_WINDOWS.fr.max + 5;
      if(tMin >= offlineFallback) return { state:"OFFLINE", nextMatchProb:0 };
    }
  }

  const W = Math.max(0, Math.min(30, matchWaitMin ?? 5));
  const R1 = ROUND_WINDOWS.r1.max; // 10〜12分 → 状態判定は上限側で保持
  const R2 = ROUND_WINDOWS.r2.max; // 10〜12分
  const FR = ROUND_WINDOWS.fr.max; // 8〜10分
  const startR1 = X + W;
  const startR2 = startR1 + R1;
  const startFR = startR2 + R2;
  const endFR = startFR + FR;

  let state = "LOBBY";
  if(tMin < X)            state = "POST_MATCH_WAIT";
  else if(tMin < startR1) state = "LOBBY";
  else if(tMin < startR2) state = "IN_MATCH";            // R1
  else if(tMin < startFR) state = "IN_TOURNAMENT_DEEP";  // R2
  else if(tMin < endFR)   state = "RETURNING";           // UI表示は Final Round
  else                    state = "OFFLINE";

  // next_match%: ロビーで上昇し、試合開始後はラウンド進行に応じて低下
  const peak = startR1;
  let p = 0;
  if(tMin < X){
    p = 0.05 * (tMin / Math.max(1, X));
  }else if(tMin <= peak){
    p = 0.10 + 0.90 * ((tMin - X) / Math.max(1, W));
  }else if(tMin <= startR2){
    p = 1.00 - 0.55 * ((tMin - startR1) / Math.max(1, R1));
  }else if(tMin <= startFR){
    p = 0.45 - 0.20 * ((tMin - startR2) / Math.max(1, R2));
  }else if(tMin <= endFR){
    p = 0.25 - 0.20 * ((tMin - startFR) / Math.max(1, FR));
  }else{
    p = 0.05;
  }

  p = Math.min(0.80, clamp01(p));
  return { state, nextMatchProb: Math.round(p * 100) };
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
  const communityMap=new Map(getCommunityList().map(e=>[e.name.toLowerCase(),e]));
  let filtered=rows;
  if(viewMode==="personal"){
    const pset=new Set(parseNames(document.getElementById("namesBox").value).map(n=>n.toLowerCase()));
    filtered=filtered.filter(r=>pset.has(r.name.toLowerCase()));
  }else if(viewMode==="global"){
    const gset=new Set(getFilteredCommunity(globalFilter).map(e=>e.name.toLowerCase()));
    filtered=filtered.filter(r=>gset.has(r.name.toLowerCase()));
  }
  if(liveTabMode==="pickup") filtered=filtered.filter(r=>pickedUp.has(r.name.toLowerCase()));
  if(liveRegionFilter!=="all") filtered=filtered.filter(r=>(r.region||"")===liveRegionFilter);
  if(liveSearchQuery) filtered=filtered.filter(r=>r.name.toLowerCase().includes(liveSearchQuery));
  if(liveStateFilter.size>0) filtered=filtered.filter(r=>{
    const isMissing=r.notFoundCount>=3&&r.lastFoundAt;
    const ds=isMissing&&r.suspectedReason==="BAN"?"BANNED":isMissing&&r.suspectedReason==="NAME_CHANGE"?"NAME_CHANGED":isMissing?"NOT_FOUND":r.state;
    return liveStateFilter.has(ds);
  });
  if(liveCatFilter.size>0) filtered=filtered.filter(r=>{
    const ce=communityMap.get(r.name.toLowerCase());
    const cat=ce?ce.category||"":"";
    if(!cat) return liveCatFilter.has("none");
    return liveCatFilter.has(cat);
  });

  const statePriority=(r)=>{
    const isMissing=r.notFoundCount>=3&&r.lastFoundAt;
    if(isMissing)return 8;
    switch(r.state){
      case "LOBBY": return 0;
      case "POST_MATCH_WAIT": return 1;
      case "IN_MATCH": return 2;
      case "IN_TOURNAMENT_DEEP": return 3;
      case "RETURNING": return 4;
      case "OFFLINE": return 6;
      case "UNKNOWN": return 7;
      default: return 5;
    }
  };

  filtered=filtered.slice().sort((a,b)=>{
    const pa=statePriority(a),pb=statePriority(b);
    if(pa!==pb)return pa-pb;
    const ta=a.lastChangeAt?(Date.now()-a.lastChangeAt):1e18;
    const tb=b.lastChangeAt?(Date.now()-b.lastChangeAt):1e18;
    if(ta!==tb)return ta-tb;
    return a.name.localeCompare(b.name);
  });

  const isGlobalView=(viewMode==="global"||liveTabMode==="global");
  for(const r of filtered){
    const isMissing=r.notFoundCount>=3&&r.lastFoundAt;
    const isBan=isMissing&&r.suspectedReason==="BAN";
    const isNameChange=isMissing&&r.suspectedReason==="NAME_CHANGE";
    const displayState=isBan?"BANNED":isNameChange?"NAME_CHANGED":isMissing?"NOT_FOUND":r.state;
    const statusBadge=isBan
      ?'<span class="badge" style="background:#2a0808;color:#ff5555;border-color:#7a1a1a;margin:0 5px 0 2px">⛔ BAN</span>'
      :isNameChange
        ?'<span class="badge" style="background:#082030;color:#6de9ff;border-color:#1e5a8a;margin:0 5px 0 2px">🔵 NC</span>'
        :"";
    const missingBadge=(!isBan&&!isNameChange&&isMissing)
      ?'<span class="badge" style="background:#2a1200;color:#ff9944;border-color:#7a3800;">🟠 Missing</span>'
      :"";
    const regionBadge=r.region?`<span class="regionTag regionTag-${r.region}">${r.region}</span>`:"";
    const key=r.name.toLowerCase();
    const comEntry=communityMap.get(key);
    const comCatBadge=comEntry&&comEntry.category?`<span class="catBadge ${comEntry.category==="cheater"?"catCheater":comEntry.category==="suspicious"?"catSuspicious":comEntry.category==="pro"?"catPro":"catNotable"}">${catLabel(comEntry.category)}</span>`:"";
    const isExpanded=expandedRows.has(key);
    const isPicked=pickedUp.has(key);
    const manualActive=isManualActive(r.manualEvent);
    const manualType=r.manualEvent?.type;
    const isWonOrFinal=manualType==="won"||manualType==="final_end";
    const manualBadge=manualActive?`<span class="manualBadge">📌 記録中</span>`:"";
    const errShort=compactErrorText(r.error);
    const actionHtml=[
      renderQuickEncounterGroup("r1"),
      renderQuickEncounterGroup("r2"),
      renderQuickEncounterGroup("fr"),
      `<button class="encQuickBtn encQuickSingle" data-ev="won" title="${encounterDisplayLabel("won")}" style="min-width:36px;height:24px;padding:0 8px;border-radius:6px;border:1px solid #2d5f15;background:#122b09;color:#d8ffd0;font-size:11px;cursor:pointer;">${encounterDisplayLabel("won")}</button>`,
      `<button class="encQuickBtn encQuickSingle" data-ev="offline" title="${encounterDisplayLabel("offline")}" style="min-width:36px;height:24px;padding:0 8px;border-radius:6px;border:1px solid #39475c;background:#151d29;color:#d4dceb;font-size:11px;cursor:pointer;">${encounterDisplayLabel("offline")}</button>`
    ].join("");
    const deleteHtml=isGlobalView?"":`<button class="deleteBtn" title="${uiText("action.delete")}" style="margin-left:4px;">✕</button>`;
    const tr=document.createElement("tr");
    if(manualActive&&!isWonOrFinal&&manualType!=="offline")tr.classList.add("tr--danger");
    else if(manualActive&&isWonOrFinal)tr.classList.add("tr--watching");
    tr.innerHTML=`
      <td class="nameCell"><button class="pickupBtn${isPicked?" pickupOn":""}" title="${uiText("pickup.title")}">★</button>${statusBadge}<span class="playerName">${r.name}</span>${regionBadge}${comCatBadge}${missingBadge}<span class="expandCaret">${isExpanded?"▴":"▾"}</span></td>
      <td class="rankCell">${renderBadge(r.leaderboardRank,r.league)}</td>
      <td class="num">${(r.points==null)?"N/A":r.points.toLocaleString()}</td>
      <td class="num">${r.lastDelta==null?"—":r.lastDelta>0?`<span style="color:#ff4d4d;font-weight:700">+${r.lastDelta}</span>`:`<span style="color:#5b9cf6;font-weight:700">${r.lastDelta}</span>`}</td>
      <td class="tsCell">${r.lastDelta==null?"—":fmtAgo(r.lastRealChangeAt)}</td>
      <td><span class="state ${displayState}" title="${stateExplain(r,displayState)}">${stateLabel(displayState)}</span>${manualBadge}</td>
      <td class="num">${isMissing?"—":r.nextMatchProb??0}%</td>
      <td class="tsCell">${r.lastOkAt?fmtTs(r.lastOkAt):"—"}</td>
      <td class="errCell" title="${(r.error||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" style="max-width:68px;width:68px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${errShort}</td>
      <td class="actCell" style="white-space:nowrap;display:flex;align-items:center;gap:4px;">${actionHtml}${deleteHtml}</td>
    `;
    tr.querySelector(".pickupBtn")?.addEventListener("click",(e)=>{e.stopPropagation();if(pickedUp.has(key))pickedUp.delete(key);else pickedUp.add(key);renderTable(lastRows);renderPickupGraph();});
    tr.querySelector(".nameCell")?.addEventListener("click",()=>toggleExpand(r,tr,key));
    tr.querySelectorAll(".encQuickSingle").forEach(btn=>btn.addEventListener("click",(e)=>{e.stopPropagation();applyEncounterEvent(r.name,btn.dataset.ev);renderTable(lastRows);}));
    tr.querySelectorAll(".encQuickGroupBtn").forEach(btn=>btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const wrap=btn.closest(".encQuickGroup");
      const menu=wrap?.querySelector(".encQuickMenu");
      const isOpen=menu&&menu.style.display!=="none";
      tr.querySelectorAll(".encQuickMenu").forEach(m=>m.style.display="none");
      if(menu) menu.style.display=isOpen?"none":"block";
    }));
    tr.querySelectorAll(".encQuickSubBtn").forEach(btn=>btn.addEventListener("click",(e)=>{e.stopPropagation();applyEncounterEvent(r.name,btn.dataset.ev);renderTable(lastRows);}));
    tr.querySelector(".deleteBtn")?.addEventListener("click",(e)=>{e.stopPropagation();removePlayer(r.name);});
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
    const dangerNow=activeRows.filter(r=>isEncounterDanger(r.manualEvent)).length;
    const hotNow=activeRows.filter(r=>!r.manualEvent&&r.nextMatchProb>=60).length;
    let html="";
    if(dangerNow>0) html+=`<span class="dangerCount">🚨 ${dangerNow}人遭遇！</span>`;
    if(hotNow>0)    html+=`<span class="hotCount">${hotNow}人が試合開始近い</span>`;
    if(!html)       html=`<span style="color:#5a7aaa;font-size:12px;">試合開始が近いプレイヤーなし</span>`;
    hotEl.innerHTML=html;
  }
  if(activeRows.length===0){
    wrap.innerHTML="<div class='psEmpty'>プレイヤーを追加すると予測グラフが表示されます</div>";
    return;
  }
  for(const r of activeRows){
    const isDanger=isEncounterDanger(r.manualEvent);
    const item=document.createElement("div");item.className="psItem"+(isDanger?" psItem--danger":"");
    const [handle,tag]=r.name.split("#");
    const prob=r.nextMatchProb??0;
    const probColor=isDanger?"#ff4444":prob>=60?"#39d98a":prob>=30?"#ffcf5c":"#5a7aaa";
    const header=document.createElement("div");header.className="psHeader";
    const dangerBadge=isDanger?`<span class="psDangerBadge">🚨 遭遇</span>`:"";
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
    const icon=isBan?"⛔":isNameChange?"🔵":"🟠";
    const reasonText=isBan
      ?"リーダーボードから完全消去"
      :isNameChange?`新しい名前: <b>${r.suspectedNewName||"不明"}</b>`
      :"消失中（調査中…）";
    return `<div class="banAlertItem ${cls}">
      <span class="banAlertIcon">${icon}</span>
      <span class="banAlertName">${r.name}</span>
      <span class="banAlertReason">${reasonText}</span>
      <span class="banAlertMeta">最終確認: ${fmtTs(r.lastFoundAt)}　連続未検出: ${r.notFoundCount}回</span>
    </div>`;
  }
  let html="";
  if(banned.length)    html+=`<div class="banAlertTitle banTitleBan">⛔ BANされた可能性</div>`+banned.map(itemHtml).join("");
  if(nameChanged.length) html+=`<div class="banAlertTitle banTitleNameChange">🔵 名前変更</div>`+nameChanged.map(itemHtml).join("");
  if(unknown.length)   html+=`<div class="banAlertTitle">🟠 消失中（調査中）</div>`+unknown.map(itemHtml).join("");
  el.innerHTML=html;
}
async function pollOnce(names,settings){
  const snapshots=getSnapshots();
  const now=nowMs();
  const rows=[];
  let anyCors=false;
  // コミュニティリストの region をマップ化（Live table region filter 用）
  const communityRegionMap=new Map(getCommunityList().map(e=>[e.name.toLowerCase(),e.region||""]));
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
    let lastDelta=prev.lastDelta??null; // 最後の非ゼロ変動値（表示固定用）
    let lastChangeAt=prev.lastChangeAt??null;
    let lastRealChangeAt=prev.lastRealChangeAt??null; // 実際のポイント変動のみ記録（表示用）
    let manualEvent=prev.manualEvent??null;
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
        // RS急落アラート
        if(delta<=-settings.rsDropThreshold){
          const prevRk=prev.leaderboardRank;
          const newRk=freshRank??leaderboardRank;
          const rankPart=(prevRk&&newRk)?" / #"+prevRk.toLocaleString()+" → #"+newRk.toLocaleString():"";
          toast("📉 <b>"+name+"</b> RS急減: "+prev.points.toLocaleString()+" → "+currentPoints.toLocaleString()+" (<b>"+delta+"</b>)"+rankPart);
        }
      }else if(prev.points==null){
        // 初回観測：優先順位: イベント履歴 → lastBatchAt → null(UNKNOWN)
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
          toast("🔄 <b>"+name+"</b> が名前を変更しました → <b>"+(suspectedNewName||"不明")+"</b>");
        }else{
          suspectedReason="BAN";
          toast("⛔ <b>"+name+"</b> がBANされた可能性があります");
        }
        banNotified=true;
      }
    }
    if(delta!==null&&delta!==0)manualEvent=null;
    const manualActive=isManualActive(manualEvent);
    if(!manualActive)manualEvent=null;
    const effectiveLCA=manualActive?manualEvent.lastChangeAtOverride:lastChangeAt;
    const region=communityRegionMap.get(key)||prev.region||"";
    snapshots[key]={points:currentPoints,lastDelta,lastChangeAt,lastRealChangeAt,lastOkAt,leaderboardRank,league,notFoundCount,lastFoundAt,banNotified,altNames,suspectedReason,suspectedNewName,region,...(manualEvent?{manualEvent}:{})};
    const inf=(manualActive&&manualEvent?.type==="offline")?{state:"OFFLINE",nextMatchProb:0}:inferState(now,effectiveLCA,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,manualActive);
    // 状態変化をログ記録
    const prevRowState=lastRows.find(r=>r.name.toLowerCase()===key)?.state;
    if(prevRowState && prevRowState!==inf.state){
      pushStateLog({ts:now,name,from:prevRowState,to:inf.state,points:currentPoints,delta});
      // ★付きプレイヤーの状態変化通知
      if(pickedUp.has(key)){
        const entering=["IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING"].includes(inf.state);
        const leaving=["IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING"].includes(prevRowState);
        if(entering)sendNotification(`🎮 ${name} が試合中`,`${stateLabel(prevRowState)} → ${stateLabel(inf.state)}`);
        else if(leaving)sendNotification(`🏁 ${name} が試合終了`,`${stateLabel(prevRowState)} → ${stateLabel(inf.state)}`);
      }
    }
    rows.push({name,points:currentPoints,delta,lastDelta,lastChangeAt,lastRealChangeAt,effectiveLCA,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt,leaderboardRank,league,region,notFoundCount,lastFoundAt,suspectedReason,suspectedNewName,manualEvent,error:stale?errMsg:""});
  }));
  saveSnapshots(snapshots);
  // コミュニティ登録済みプレイヤーのスナップショットをバックエンドに送信（タブに関係なく共有）
  const _gs=getUiSettings();
  const _gUrl=effectiveGlobalUrl(_gs);
  if(_gUrl){
    const activeKeys=new Set(getCommunityList().map(e=>e.name.toLowerCase()));
    if(activeKeys.size>0){
      Object.entries(snapshots).forEach(([k,s])=>{
        if(activeKeys.has(k))submitSnapshotToGlobal(_gUrl,k,s);
      });
    }
  }
  rows.sort((a,b)=>{
    const ta=a.lastChangeAt?(now-a.lastChangeAt):1e18;
    const tb=b.lastChangeAt?(now-b.lastChangeAt):1e18;
    if(ta!==tb)return ta-tb;
    return a.name.localeCompare(b.name);
  });
  document.getElementById("lastPoll").textContent=new Date(now).toLocaleTimeString();
  if(anyCors) setNetHint("CORSっぽい失敗あり → ローカル環境の場合は worker.js をデプロイして使用してください");
  else setNetHint("");
  lastRows=rows; // 即時再描画用にキャッシュ
  renderTable(rows);renderSpark(rows);renderBanList(rows);renderPickupGraph();
  // リロード後スクロール位置をテーブル描画完了後に復元（1フレーム後）
  if(pendingScrollY!==null){
    const y=pendingScrollY;pendingScrollY=null;
    requestAnimationFrame(()=>window.scrollTo({top:y,behavior:"instant"}));
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
      const inf=inferState(future,lca,r.reflectDelayMin,r.matchWaitMin,r.matchAvgMin,r.matchJitterMin,r.tournamentTotalMin,false);
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
      bar.title=`+${i}分後: ${combined[i]}%`;
      barsEl.appendChild(bar);
    }
  }
  const axEl=document.getElementById("pickupAxis");
  if(axEl){axEl.innerHTML="";[0,5,10,15,20,25].forEach(m=>{const s=document.createElement("span");s.textContent=m===0?"今":"+"+m+"m";axEl.appendChild(s);});}
  const nameEl=document.getElementById("pickupNames");if(nameEl)nameEl.textContent=picked.map(r=>r.name).join("、");
  const pctEl=document.getElementById("pickupPeak");if(pctEl)pctEl.textContent=`ピーク ${combined[peak]}% (+${peak}分後)`;
}
let logViewMode="list";
const LOG_STATE_COLOR={OFFLINE:"#8ea0b7",LOBBY:"#5b9cf6",POST_MATCH_WAIT:"#7bb8f0",IN_MATCH:"#39d98a",IN_TOURNAMENT_DEEP:"#c77dff",RETURNING:"#c77dff",UNKNOWN:"#3a4a60",NOT_FOUND:"#ff9944",BANNED:"#ff5555",NAME_CHANGED:"#6de9ff"};

function renderLogList(){
  const el=document.getElementById("logList");if(!el)return;
  const allLogs=getStateLogs();
  const logs=allLogs.slice(-300).reverse();
  const count=document.getElementById("logCount");
  if(count)count.textContent=`(${allLogs.length}件)`;
  if(logs.length===0){el.innerHTML='<div style="color:#5a7aaa;padding:8px 0">ログなし</div>';return;}
  let html="";let lastDate="";
  for(const e of logs){
    const d=new Date(e.ts);
    const dateStr=d.toLocaleDateString(undefined,{month:"short",day:"numeric",weekday:"short"});
    const timeStr=d.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    if(dateStr!==lastDate){html+=`<div class="logDateSep">${dateStr}</div>`;lastDate=dateStr;}
    const fromC=LOG_STATE_COLOR[e.from]||"#8ea0b7";
    const toC=LOG_STATE_COLOR[e.to]||"#e7edf5";
    const delta=e.delta!=null?(e.delta>0?`<span class="logDelta pos">+${e.delta}</span>`:`<span class="logDelta neg">${e.delta}</span>`):"";
    html+=`<div class="logEntry"><span class="logTime">${timeStr}</span><span class="logName">${e.name}</span><span class="logState" style="color:${fromC}">${stateLabel(e.from)}</span><span class="logArrow">→</span><span class="logState" style="color:${toC}">${stateLabel(e.to)}</span>${delta}</div>`;
  }
  el.innerHTML=html;
}

function renderLogTimeline(){
  const el=document.getElementById("logList");if(!el)return;
  const allLogs=getStateLogs();
  const count=document.getElementById("logCount");
  if(count)count.textContent=`(${allLogs.length}件)`;
  if(allLogs.length===0){el.innerHTML='<div style="color:#5a7aaa;padding:8px 0">ログなし</div>';return;}

  // プレイヤー別にグループ化
  const playerMap={};
  for(const log of allLogs){
    if(!playerMap[log.name])playerMap[log.name]=[];
    playerMap[log.name].push(log);
  }
  // 最新のログがあるプレイヤーから並べる（最大20名）
  const playerNames=Object.keys(playerMap)
    .sort((a,b)=>Math.max(...playerMap[b].map(l=>l.ts))-Math.max(...playerMap[a].map(l=>l.ts)))
    .slice(0,20);

  const now=Date.now();
  // 本日 00:00:00（ローカル）〜 翌 00:00:00 の固定 24 時間軸
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

    // セグメント計算（今日 0:00〜現在にクリップ）
    const segs=[];
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

    // ラベル（省略）
    const label=name.length>16?name.slice(0,14)+"…":name;
    svgRows+=`<text x="${labelW-6}" y="${y+rowH/2+4}" text-anchor="end" fill="#b8c4d6" font-size="11" font-family="system-ui,sans-serif">${label}</text>`;

    // セグメント描画
    for(const seg of segs){
      const x=labelW+((seg.start-timeStart)/totalDur)*trackW;
      const w=Math.max(((seg.end-seg.start)/totalDur)*trackW,1);
      const color=LOG_STATE_COLOR[seg.state]||"#8ea0b7";
      const startStr=new Date(seg.start).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",hour12:false});
      const endStr=new Date(seg.end).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",hour12:false});
      svgRows+=`<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" fill="${color}" opacity="0.82" rx="2"><title>${stateLabel(seg.state)}\n${startStr} → ${endStr}</title></rect>`;
    }
    // 区切り線
    svgRows+=`<line x1="${labelW}" y1="${y+rowH+2}" x2="${W-4}" y2="${y+rowH+2}" stroke="#1e2a3a" stroke-width="1"/>`;
  });

  // 時刻軸（2時間ごと: 00:00, 02:00, ..., 24:00）
  const axisY=padTop+playerNames.length*(rowH+rowGap)+4;
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

  // 現在時刻の垂直 NOW ライン
  const nowX=labelW+((now-timeStart)/totalDur)*trackW;
  axis+=`<line x1="${nowX.toFixed(1)}" y1="${padTop}" x2="${nowX.toFixed(1)}" y2="${axisY}" stroke="#ff9944" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>`;
  axis+=`<text x="${nowX.toFixed(1)}" y="${padTop-3}" text-anchor="middle" fill="#ff9944" font-size="9" font-weight="bold" font-family="system-ui,sans-serif">NOW</text>`;

  // 凡例
  const legendStates=[["OFFLINE","#8ea0b7","Offline"],["LOBBY","#5b9cf6","Lobby"],["IN_MATCH","#39d98a","In Match"],["IN_TOURNAMENT_DEEP","#c77dff","Final/Tournament"],["NOT_FOUND","#ff9944","Missing"],["BANNED","#ff5555","Banned"]];
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
    const alts=[e.steamName,e.psnName,e.xboxName].filter(Boolean).join(" · ");
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

function ensureSeedRowsForActiveNames(settings){
  const names=getActiveNames();
  if(!names.length) return;
  const now=nowMs();
  const snap=getSnapshots();
  const existing=new Map((lastRows||[]).map(r=>[String(r.name||'').toLowerCase(),r]));
  const communityRegionMap=new Map(getCommunityList().map(e=>[String(e.name||'').toLowerCase(),e.region||'']));
  let changed=false;
  for(const name of names){
    const key=name.toLowerCase();
    if(existing.has(key)) continue;
    const prev=snap[key]||{};
    const effectiveLCA=prev.lastChangeAt??null;
    const inf=inferState(now,effectiveLCA,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,false);
    const row={
      name,
      points:prev.points??null,
      delta:null,
      lastDelta:prev.lastDelta??null,
      lastChangeAt:prev.lastChangeAt??null,
      lastRealChangeAt:prev.lastRealChangeAt??null,
      effectiveLCA,
      state:inf.state,
      nextMatchProb:inf.nextMatchProb,
      reflectDelayMin:settings.reflectDelayMin,
      matchWaitMin:settings.matchWaitMin,
      matchAvgMin:settings.matchAvgMin,
      matchJitterMin:settings.matchJitterMin,
      tournamentTotalMin:settings.tournamentTotalMin,
      lastOkAt:prev.lastOkAt??null,
      leaderboardRank:prev.leaderboardRank??null,
      league:prev.league??null,
      region:communityRegionMap.get(key)||prev.region||'',
      notFoundCount:prev.notFoundCount??0,
      lastFoundAt:prev.lastFoundAt??null,
      suspectedReason:prev.suspectedReason??null,
      suspectedNewName:prev.suspectedNewName??null,
      error:prev.error??''
    };
    existing.set(key,row);
    changed=true
  }
  if(changed){
    lastRows=Array.from(existing.values());
    renderTable(lastRows);
    renderSpark(lastRows);
  }
}

function doStart(){
  if(timer){clearTimeout(timer);timer=null;}
  const settings=getUiSettings();saveSettings(settings);
  const names=getActiveNames();
  if(names.length===0)return;
  if(viewMode==="personal"){
    // namesBox の内容だけを保存（community との union を保存すると community players が
    // namesBox に混入してしまうため、ここでは personal 分のみを対象にする）
    const personalOnly=parseNames(document.getElementById("namesBox").value);
    try{saveNamesToUrl(personalOnly);}catch{}
    saveNamesToLocal(personalOnly);
  }
  currentSettings=settings;
  ensureSeedRowsForActiveNames(settings);
  setRunning(true);
  (function schedulePoll(){
    // グローバルリストを 120 秒ごとにバックエンドと自動同期（他ユーザーの追加を反映）
    const now=Date.now();
    const communitySync=effectiveGlobalUrl(settings)&&(now-lastCommunitySync>120000)
      // コミュニティリスト同期（追加・更新・削除） + スナップショット状態同期 を並列実行
      ?Promise.all([
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
// グローバルモード: バックエンドのスナップショットを取得してテーブルに先行表示
async function preloadRemoteSnapshots(settings){
  const remote=await fetchGlobalSnapshots(effectiveGlobalUrl(settings));
  if(!remote||typeof remote!=="object")return;
  const localSnaps=getSnapshots();
  let snapshotsMerged=false;
  const remoteTs=s=>Math.max(s?.lastOkAt||0,s?.lastRealChangeAt||0,s?.lastChangeAt||0,s?.updatedAt||0,0);
  const localTs=s=>Math.max(s?.lastOkAt||0,s?.lastRealChangeAt||0,s?.lastChangeAt||0,0);
  for(const [key,remSnap] of Object.entries(remote)){
    if(!remSnap||typeof remSnap!=="object")continue;
    const loc=localSnaps[key]||{};
    if(remoteTs(remSnap) >= localTs(loc)){
      localSnaps[key]={...loc,...remSnap};
      snapshotsMerged=true;
    }
  }
  if(snapshotsMerged)saveSnapshots(localSnaps);
  const names=getActiveNames();
  const now=Date.now();
  const rows=names.map(name=>{
    const snap=(localSnaps[name.toLowerCase()]||remote[name.toLowerCase()]);
    if(!snap||snap.points==null)return null;
    const effectiveLCA=snap.lastChangeAt??null;
    const inf=inferState(now,effectiveLCA,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,false);
    return {name,points:snap.points,delta:null,lastDelta:snap.lastDelta??null,lastChangeAt:snap.lastChangeAt??null,lastRealChangeAt:snap.lastRealChangeAt??null,effectiveLCA,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt:snap.lastOkAt??null,leaderboardRank:snap.leaderboardRank??null,league:snap.league??null,region:snap.region??"",notFoundCount:snap.notFoundCount||0,lastFoundAt:snap.lastFoundAt,suspectedReason:snap.suspectedReason,suspectedNewName:snap.suspectedNewName,error:"🌐 共有データ",isShared:true};
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
  // バックエンドがあればリモートとマージ
  if(effectiveGlobalUrl(settings)){
    document.getElementById("globalStatus").textContent="🌐 同期中...";
    await Promise.all([
      fetchAndMergeCommunity(effectiveGlobalUrl(settings)),
      fetchAndMergeSnapshots(effectiveGlobalUrl(settings)),
    ]);
  }
  renderGlobalPlayerList();
  const total=getCommunityList().length;
  const filtered=getFilteredCommunity(globalFilter).length;
  document.getElementById("globalStatus").textContent=
    total===0?"ℹ️ まだ登録がありません。下のフォームから追加してください"
    :`🌐 ${globalFilter==="all"?"全サーバー":REGION_LABEL[globalFilter]}：${filtered}人 / 合計${total}人`;
  if(effectiveGlobalUrl(settings)) preloadRemoteSnapshots(settings);
  ensureSeedRowsForActiveNames(settings);
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
  // フィルタータブのアクティブ状態更新
  document.querySelectorAll(".globalRegionTab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.region===globalFilter);
  });
  const entries=getFilteredCommunity(globalFilter);
  const personalSet=new Set(parseNames(document.getElementById("namesBox").value).map(n=>n.toLowerCase()));
  if(entries.length===0){
    el.innerHTML="<div class='hint' style='padding:12px 0'>このフィルターには登録がありません</div>";
    return;
  }
  // 地域ごとにグループ表示（全て選択時）
  const groups=globalFilter==="all"
    ?REGION_ORDER.map(r=>({region:r,items:entries.filter(e=>(e.region||"")===r)})).filter(g=>g.items.length>0)
    :[{region:globalFilter,items:entries}];
  el.innerHTML=groups.map(g=>{
    const header=globalFilter==="all"?`<div class="regionGroupLabel">${REGION_LABEL[g.region]}</div>`:"";
    return header+g.items.map(e=>{
      const inPersonal=personalSet.has(e.name.toLowerCase());
      const catLbl=catLabel(e.category);
      const catClass=e.category==="cheater"?"catCheater":e.category==="suspicious"?"catSuspicious":e.category==="pro"?"catPro":"catNotable";
      return `<div class="globalPlayerItem">
        <span class="globalPlayerName">${e.name}</span>
        <span class="catBadge ${catClass}">${catLbl}</span>
        ${e.note?`<span class="communityNote">${e.note}</span>`:""}
        ${inPersonal?`<span class="badge" style="background:#0d2a0d;color:#39d98a;border-color:#1e5a1e;font-size:10px;">${t("global.inMyList")}</span>`
          :`<button class="globalAddBtn" data-name="${e.name}">${t("global.addMyList")}</button>`}
        <button class="communityDelBtn" data-name="${e.name}" title="削除">×</button>
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
        toast(t("toast.addMyList").replace("{name}",btn.dataset.name));
        renderGlobalPlayerList();
      }
    });
  });
  el.querySelectorAll(".communityDelBtn").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      if(!confirm(btn.dataset.name+" をリストから削除しますか？"))return;
      const _ds=getUiSettings();
      const _gUrl=effectiveGlobalUrl(_ds);
      // サーバー削除を先に実行し、成功時のみローカルから除去
      // （失敗時は UI を変えず、次回 fetchAndMergeCommunity でもサーバーが正として維持される）
      if(_gUrl){
        const ok=await deleteCommunityEntryFromGlobal(_gUrl,btn.dataset.name);
        if(!ok)return;
      }
      removeCommunityEntry(btn.dataset.name);
      renderGlobalPlayerList();
      const total=getCommunityList().length;
      document.getElementById("globalStatus").textContent=`🌐 合計${total}人`;
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
  toast("削除: <b>"+name+"</b>");
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
  // 即時テーブル表示（APIレスポンス前でもプレイヤーを表示）
  if(isNew){
    const s=currentSettings||getUiSettings();
    const now=nowMs();
    const snap=getSnapshots();
    const prev=snap[name.toLowerCase()]||{};
    const effectiveLCA=prev.lastChangeAt??null;
    const inf=inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,false);
    const newRow={name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:0,lastFoundAt:null,suspectedReason:null,suspectedNewName:null,error:""};
    const updated=[...lastRows.filter(r=>r.name.toLowerCase()!==name.toLowerCase()),newRow];
    lastRows=updated;
    renderTable(updated);renderSpark(updated);
    toast("追加: <b>"+name+"</b>");
  }
  doStart();
}
async function init(){
  // ── リロード後のシームレス復元 ──────────────────────────────
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
    // viewMode=globalなら UI をグローバル表示に切り替え（アニメなし）
    if(viewMode==="global"){
      document.getElementById("tabPersonal")?.classList.remove("active");
      document.getElementById("tabGlobal")?.classList.add("active");
      document.querySelector(".personalView")?.style.setProperty("display","none");
      document.getElementById("globalListView")?.style.setProperty("display","");
    }
    // globalFilterのタブ表示を更新
    document.querySelectorAll(".regionTab").forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.region===globalFilter);
    });
  }catch{}
  // ────────────────────────────────────────────────────────────
  try{
    const s=loadSettings();applySettingsToUi(s);
    // URL → localStorage の優先順でプレイヤーリストを復元
    const urlNames=loadNamesFromUrl();
    const savedNames=urlNames&&urlNames.length?urlNames:loadNamesFromLocal();
    if(savedNames && savedNames.length){
      document.getElementById("namesBox").value=savedNames.join("\n");
      if(reloadScroll!==null)pendingScrollY=reloadScroll; // pollOnce完了後に復元
      // スナップショットから即時プレビュー描画（API応答前に状態予測を表示）
      const snap=getSnapshots();
      const now=nowMs();
      const preRows=savedNames.map(name=>{
        const key=name.toLowerCase();
        const prev=snap[key]||{};
        const effectiveLCA=prev.lastChangeAt??null;
        const inf=inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,false);
        return {name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:prev.notFoundCount??0,lastFoundAt:prev.lastFoundAt??null,suspectedReason:prev.suspectedReason??null,suspectedNewName:prev.suspectedNewName??null,error:""};
      });
      lastRows=preRows;
      renderTable(preRows);renderSpark(preRows);
      doStart(); // 名前があれば自動スタート（リロード・再訪問後も継続）
    }
  }catch(e){console.error("init:",e);}
  // テキストエリア変更時にlocalStorageへ随時保存
  const ta=document.getElementById("namesBox");
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
    // 検索バーが空の場合 → namesBox の内容でモニタリング開始
    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length>0){doStart();toast("監視開始：<b>"+names.length+"人</b>");}
    else{toast("名前を入力してください");}
  });
  document.getElementById("btnShare").addEventListener("click",async()=>{
    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length===0){toast("Share: 名前が空です");return;}
    saveNamesToUrl(names);
    const url=window.location.href;
    try{await navigator.clipboard.writeText(url);toast("Share link をコピーしました：<b>"+url+"</b>");}
    catch{toast("コピーできません。URLを手動コピーしてください：<b>"+url+"</b>");}
  });
  document.getElementById("btnExportCsv").addEventListener("click",exportCsv);
  document.getElementById("btnExportJsonl").addEventListener("click",exportJsonl);
  document.getElementById("btnClear").addEventListener("click",()=>{
    if(!confirm("localStorage の settings/snapshots/events を削除します。よろしいですか？"))return;
    clearLocal();toast("local data cleared");
  });
  document.getElementById("btnTest").addEventListener("click",async()=>{
    const settings=getUiSettings();saveSettings(settings);
    const names=parseNames(document.getElementById("namesBox").value);
    if(names.length===0){toast("Test: 名前が空です");return;}
    const first=names[0];
    try{
      const data=await fetchPlayer(effectiveProxyBase(settings),settings.leaderboardId,settings.platform,first);
      const entry=(data&&Array.isArray(data.data)&&data.data.length)?data.data[0]:null;
      const pts=entry?getPointsFromEntry(entry):null;
      if(pts==null) toast("Test: <b>"+first+"</b> → points が取れません（season/platform/対象外の可能性）");
      else toast("Test: <b>"+first+"</b> → points=<b>"+pts+"</b>");
    }catch(e){
      const msg=String(e&&e.message?e.message:e);
      if(isCorsLikeError(msg)) toast("Test失敗（CORSの可能性）→ ローカル環境では Worker が必要です");
      else toast("Test失敗：<b>"+msg+"</b>");
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
  // 地域フィルタータブ（グローバルリスト用）
  document.querySelectorAll(".globalRegionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      globalFilter=btn.dataset.region;
      renderGlobalPlayerList();
      const filtered=getFilteredCommunity(globalFilter).length;
      const total=getCommunityList().length;
      document.getElementById("globalStatus").textContent=
        `🌐 ${globalFilter==="all"?"全サーバー":REGION_LABEL[globalFilter]}：${filtered}人 / 合計${total}人`;
      if(running&&currentSettings)pollOnce(getActiveNames(),currentSettings);
    });
  });
// コミュニティ追加フォーム
document.getElementById("btnCommunityAdd").addEventListener("click",async()=>{
  if(getEffectiveAllowedUsers().length>0&&!isLoggedIn()){
    showLoginModal(()=>document.getElementById("btnCommunityAdd").click());
    return;
  }
  const name=(document.getElementById("communityName").value||"").trim();
  if(!name){toast("名前を入力してください");return;}

  const entry={
    name,
    region:document.getElementById("communityRegion").value,
    category:document.getElementById("communityCategory").value,
    note:(document.getElementById("communityNote").value||"").trim(),
  };

  addCommunityEntry(entry);
  renderGlobalPlayerList();

  document.getElementById("communityName").value="";
  document.getElementById("communityNote").value="";
  toast("🌐 <b>"+name+"</b> → Global ("+catLabel(entry.category)+" / "+(REGION_LABEL[entry.region]||"?")+")");

  const settings=getUiSettings();
  const gUrl=effectiveGlobalUrl(settings);
  if(gUrl){
    try{
      await submitCommunityEntryToGlobal(gUrl,entry);
      await fetchAndMergeCommunity(gUrl);
      renderGlobalPlayerList();
    }catch(e){
      setGlobalSyncStatus("ローカルには追加済み / 共有反映は未完了",true);
    }
  }

  const total=getCommunityList().length;
  document.getElementById("globalStatus").textContent=`合計${total}人`;
  if(viewMode==="global")doStart();
});
  // 設定の自動保存（リロード・タブ閉じ時にも反映）
  window.addEventListener("beforeunload",()=>{try{saveSettings(getUiSettings());}catch{}});
  // よく変更するマッチ設定入力を変更したら即保存
  ["matchWait","matchAvg","matchJitter","reflectDelay","pollInterval","tournamentTotal","rsDropThreshold"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener("change",()=>saveSettings(getUiSettings()));
  });
  // personalRegionFilter タブ
  document.querySelectorAll(".personalRegionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      personalRegionFilter=btn.dataset.pregion;
      document.querySelectorAll(".personalRegionTab").forEach(b=>b.classList.toggle("active",b.dataset.pregion===personalRegionFilter));
      renderTable(lastRows);
    });
  });
  // 自分のリスト → グローバルにコピー
  document.getElementById("btnCopyToGlobal")?.addEventListener("click",async()=>{
    const names=parseNames(document.getElementById("namesBox").value);
    if(!names.length){toast("リストが空です");return;}
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
    toast(`🌐 <b>${added}人</b> をグローバルリストにコピーしました`);
    if(viewMode==="global")renderGlobalPlayerList();
  });
  // ログ
  document.getElementById("btnLogTimeline")?.addEventListener("click",()=>{
    logViewMode=logViewMode==="list"?"timeline":"list";
    const btn=document.getElementById("btnLogTimeline");
    if(btn)btn.textContent=logViewMode==="list"?"📊 タイムライン":"📋 リスト";
    logViewMode==="timeline"?renderLogTimeline():renderLogList();
  });
  document.getElementById("btnExportLogs")?.addEventListener("click",exportStateLogs);
  document.getElementById("btnClearLogs")?.addEventListener("click",()=>{
    if(!confirm("ログをクリアしますか？"))return;
    clearStateLogs();renderLogList();toast("ログをクリアしました");
    logViewMode="list";
    const btn=document.getElementById("btnLogTimeline");
    if(btn)btn.textContent="📊 タイムライン";
  });
  // ── テーブルヘッダー ? アイコン: fixed グローバルツールチップ ──────────
  // tableWrap の overflow:auto / position:sticky による clipping を回避
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
        // 初期表示（幅計算前）
        const rect=icon.getBoundingClientRect();
        let left=rect.left;
        let top=rect.bottom+6;
        gTip.style.left=left+"px";
        gTip.style.top=top+"px";
        // 1フレーム後にサイズが確定してから位置補正
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
  // ── ログインモーダル イベント ────────────────────────────────
  document.getElementById("btnLoginSubmit").addEventListener("click",async()=>{
    const id=document.getElementById("loginId").value.trim();
    const pw=document.getElementById("loginPassword").value;
    if(!id||!pw){document.getElementById("loginError").textContent="IDとパスワードを入力してください";return;}
    const hash=await sha256(pw);
    const ok=getEffectiveAllowedUsers().find(u=>u.id.toLowerCase()===id.toLowerCase()&&u.passwordHash===hash);
    if(ok){setCurrentUser(id);hideLoginModal();if(_loginCallback)_loginCallback();}
    else{document.getElementById("loginError").textContent="IDまたはパスワードが正しくありません";}
  });
  document.getElementById("btnLoginCancel").addEventListener("click",hideLoginModal);
  document.getElementById("loginPassword").addEventListener("keydown",(e)=>{if(e.key==="Enter")document.getElementById("btnLoginSubmit").click();});
  document.getElementById("btnLogout").addEventListener("click",()=>{setCurrentUser(null);toast(t("toast.logout"));});
  // モーダル背景クリックで閉じる
  document.getElementById("loginModal").addEventListener("click",(e)=>{if(e.target===e.currentTarget)hideLoginModal();});

  // ── アドミンパネル イベント ──────────────────────────────────
  document.getElementById("btnAdminUnlock").addEventListener("click",async()=>{
    const pw=document.getElementById("adminPasswordInput").value;
    if(!pw)return;
    const auth=getAuthData();
    if(!auth.adminPasswordHash){
      // 初回：パスワードを新規設定
      auth.adminPasswordHash=await sha256(pw);
      saveAuthData(auth);
      toast("🔑 アドミンパスワードを設定しました");
    }else{
      if(await sha256(pw)!==auth.adminPasswordHash){toast("❌ パスワードが正しくありません");return;}
    }
    document.getElementById("adminPanel").style.display="";
    renderAllowedUserList();
  });
  document.getElementById("btnAddUser").addEventListener("click",async()=>{
    const id=document.getElementById("newUserId").value.trim();
    const pw=document.getElementById("newUserPassword").value;
    if(!id||!pw){toast("IDとパスワードを入力してください");return;}
    const auth=getAuthData();
    if(auth.allowedUsers.find(u=>u.id.toLowerCase()===id.toLowerCase())){toast("そのIDは既に登録されています");return;}
    auth.allowedUsers.push({id,passwordHash:await sha256(pw)});
    saveAuthData(auth);
    // バックエンドキャッシュを無効化してローカルリストにフォールバックさせる。
    // fetchAuthConfig がページロード時に _backendAllowedUsers=[] をセットしているため、
    // null に戻さないと作成直後のログイン照合でバックエンドの空リストが使われてしまう。
    _backendAllowedUsers=null;
    document.getElementById("newUserId").value="";
    document.getElementById("newUserPassword").value="";
    renderAllowedUserList();
    updateLoginStatus();
    toast("✅ ユーザー <b>"+id+"</b> を追加しました");
  });
  document.getElementById("btnChangeAdminPassword").addEventListener("click",async()=>{
    const pw=document.getElementById("newAdminPassword").value;
    if(!pw){toast("新しいパスワードを入力してください");return;}
    const auth=getAuthData();
    auth.adminPasswordHash=await sha256(pw);
    saveAuthData(auth);
    document.getElementById("newAdminPassword").value="";
    toast("🔑 アドミンパスワードを変更しました");
  });

  // ── バックエンドに同期ボタン ─────────────────────────────────
  document.getElementById("btnSyncAuth").addEventListener("click",async()=>{
    const settings=getUiSettings();
    if(!effectiveGlobalUrl(settings)){toast("⚠️ バックエンドに接続できません（ローカル環境では Worker URL の設定が必要です）");return;}
    const auth=getAuthData();
    if(!auth.adminPasswordHash){toast("⚠️ アドミンパスワードを先に設定してください");return;}
    document.getElementById("btnSyncAuth").textContent="同期中...";
    const ok=await syncAuthToBackend(effectiveGlobalUrl(settings),auth.adminPasswordHash,auth.allowedUsers);
    document.getElementById("btnSyncAuth").textContent="☁️ バックエンドに同期";
    if(ok){
      toast("✅ 認証設定をバックエンドに同期しました");
      _backendAllowedUsers=auth.allowedUsers;
    }else{
      toast("❌ 同期に失敗しました（URL・パスワードを確認してください）");
    }
  });

  // ── Live tableソース切替タブ ──
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
  // ── Live tableリージョンフィルター ──
  document.querySelectorAll(".liveRegionTab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      liveRegionFilter=btn.dataset.lregion;
      document.querySelectorAll(".liveRegionTab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      renderTable(lastRows);
    });
  });

  // ── Live table 検索 ──
  document.getElementById("liveSearch").addEventListener("input",e=>{
    liveSearchQuery=e.target.value.trim().toLowerCase();
    renderTable(lastRows);
  });

  // ── Live table 状態フィルター（ドロップダウン+チェックボックス） ──
  (function initStateFilter(){
    const STATES=["LOBBY","POST_MATCH_WAIT","IN_MATCH","IN_TOURNAMENT_DEEP","RETURNING","OFFLINE","UNKNOWN","NOT_FOUND","BANNED","NAME_CHANGED"];
    const toggle=document.getElementById("stateFilterToggle");
    const menu=document.getElementById("stateFilterMenu");
    if(!toggle||!menu)return;
    function updateToggleLabel(){
      const n=liveStateFilter.size;
      toggle.textContent=n===0?t("filter.state")+" ▾":`${t("filter.state.n")} (${n}) ▾`;
      toggle.classList.toggle("hasFilter",n>0);
    }
    toggle.addEventListener("click",(e)=>{
      e.stopPropagation();
      menu.style.display=menu.style.display==="none"?"block":"none";
    });
    document.addEventListener("click",(e)=>{
      if(!e.target.closest("#stateFilterWrap"))menu.style.display="none";
    });
    const FILTER_LABEL={POST_MATCH_WAIT:"state.REFLECT"};
    for(const s of STATES){
      const item=document.createElement("label");item.className="stateFilterItem";
      const cb=document.createElement("input");cb.type="checkbox";cb.dataset.state=s;
      const lbl=FILTER_LABEL[s]?t(FILTER_LABEL[s]):stateLabel(s);
      const label=document.createElement("span");label.className=`state ${s}`;label.style.cssText="font-size:11px;padding:2px 8px;";label.textContent=lbl;
      item.appendChild(cb);item.appendChild(label);
      cb.addEventListener("change",()=>{
        if(cb.checked)liveStateFilter.add(s);else liveStateFilter.delete(s);
        updateToggleLabel();renderTable(lastRows);
      });
      menu.appendChild(item);
    }
    const reset=document.createElement("button");reset.className="stateFilterReset";reset.textContent=t("filter.reset");
    reset.addEventListener("click",(e)=>{
      e.stopPropagation();
      liveStateFilter.clear();
      menu.querySelectorAll("input[type=checkbox]").forEach(cb=>cb.checked=false);
      updateToggleLabel();renderTable(lastRows);
    });
    menu.appendChild(reset);
  })();

  // ── Live table カテゴリフィルター（ドロップダウン+チェックボックス） ──
  (function initCatFilter(){
    const CATS=[
      {key:"cheater",cls:"catCheater",label:()=>catLabel("cheater")},
      {key:"suspicious",cls:"catSuspicious",label:()=>catLabel("suspicious")},
      {key:"notable",cls:"catNotable",label:()=>catLabel("notable")},
      {key:"pro",cls:"catPro",label:()=>catLabel("pro")},
      {key:"none",cls:"",label:()=>t("filter.cat.none")}
    ];
    const toggle=document.getElementById("catFilterToggle");
    const menu=document.getElementById("catFilterMenu");
    if(!toggle||!menu)return;
    function updateToggleLabel(){
      const n=liveCatFilter.size;
      toggle.textContent=n===0?t("filter.category")+" ▾":`${t("filter.category.n")} (${n}) ▾`;
      toggle.classList.toggle("hasFilter",n>0);
    }
    toggle.addEventListener("click",(e)=>{
      e.stopPropagation();
      menu.style.display=menu.style.display==="none"?"block":"none";
    });
    document.addEventListener("click",(e)=>{
      if(!e.target.closest("#catFilterWrap"))menu.style.display="none";
    });
    for(const c of CATS){
      const item=document.createElement("label");item.className="stateFilterItem";
      const cb=document.createElement("input");cb.type="checkbox";cb.dataset.cat=c.key;
      const span=document.createElement("span");
      if(c.cls)span.className=c.cls;
      span.style.cssText="font-size:11px;padding:2px 8px;border-radius:4px;";
      span.textContent=c.label();
      item.appendChild(cb);item.appendChild(span);
      cb.addEventListener("change",()=>{
        if(cb.checked)liveCatFilter.add(c.key);else liveCatFilter.delete(c.key);
        updateToggleLabel();renderTable(lastRows);
      });
      menu.appendChild(item);
    }
    const reset=document.createElement("button");reset.className="stateFilterReset";reset.textContent=t("filter.reset");
    reset.addEventListener("click",(e)=>{
      e.stopPropagation();
      liveCatFilter.clear();
      menu.querySelectorAll("input[type=checkbox]").forEach(cb=>cb.checked=false);
      updateToggleLabel();renderTable(lastRows);
    });
    menu.appendChild(reset);
  })();

  // ── ヘッダー認証ボタン ──
  document.getElementById("btnHeaderLogin").addEventListener("click",()=>showLoginModal());
  document.getElementById("btnHeaderLogout").addEventListener("click",()=>{setCurrentUser(null);toast(t("toast.logout"));});
  document.getElementById("btnHeaderAdmin").addEventListener("click",()=>{document.getElementById("adminModal").style.display="flex";});
  document.getElementById("btnAdminModalClose").addEventListener("click",()=>{document.getElementById("adminModal").style.display="none";});

  // ── 初期ログイン状態を反映 + globalUrl があればバックエンドから取得 ──
  restoreSession(); // ページリロード後もログイン状態を復元
  updateLoginStatus();
  // 通知ボタンの初期状態
  setNotifyEnabled(notifyEnabled);
  const _initSettings=getUiSettings();
  if(effectiveGlobalUrl(_initSettings)){
    fetchAuthConfig(effectiveGlobalUrl(_initSettings));
    // 起動時にコミュニティリストをバックエンドと同期（全ユーザーで共有リストを反映）
    fetchAndMergeCommunity(effectiveGlobalUrl(_initSettings)).then(()=>{
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
  if(hint) hint.textContent = `→ Reflect X を ${newMin}m に自動更新`;
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