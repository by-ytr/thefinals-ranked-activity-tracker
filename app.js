const LS={settings:"finals_tracker_settings_v3",snapshots:"finals_tracker_snapshots_v3",events:"finals_tracker_events_v3",names:"finals_tracker_names_v1",community:"finals_tracker_community_v1",auth:"finals_tracker_auth_v1"};
const DEFAULTS={proxyBase:"",globalUrl:"",leaderboardId:"s9",platform:"crossplay",pollIntervalSec:60,reflectDelayMin:8,matchWaitMin:5,matchAvgMin:31,matchJitterMin:3,tournamentTotalMin:45,estimatorEnabled:true,estWindowStart:2000,estWindowSize:500,estCacheSec:30,maxEvents:5000,rsDropThreshold:1000};
let timer=null,running=false,currentSettings=null;
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
  });
  regionWrap.appendChild(rLabel);regionWrap.appendChild(rSel);td.appendChild(regionWrap);
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
    if(!r.ok)return;
    const remote=await r.json();
    const arr=Array.isArray(remote)?remote:(remote.entries||[]);
    const local=getCommunityList();
    const merged=[...local];
    for(const re of arr){
      const k=(re.name||"").toLowerCase();
      if(!merged.find(e=>e.name.toLowerCase()===k))merged.push(re);
    }
    saveCommunityList(merged);
  }catch{}
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
async function submitSnapshotToGlobal(globalUrl,name,snap){
  try{await fetch(globalUrl.replace(/\/$/,"")+"/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,snapshot:snap})});}catch{}
}
async function addNameToGlobal(globalUrl,name){
  try{await fetch(globalUrl.replace(/\/$/,"")+"/names",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});}catch{}
}
// 遭遇タイプ: group:true のものは sub[] をドロップダウン表示
const ENCOUNTER_TYPES=[
  {key:"won",       label:"🏆 勝利",     desc:"試合に勝利した（即ロビーへ）",     getOffset:s=>0},
  {key:"final_end", label:"💀 FINAL終了", desc:"FINALラウンド終了（負け）",        getOffset:s=>0},
  {key:"r1", label:"R1", desc:"ラウンド1で遭遇", group:true, sub:[
    {key:"r1_early", label:"序盤", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r1_mid",   label:"中盤", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r1_late",  label:"終盤", getOffset:s=>s.reflectDelayMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  {key:"r2", label:"R2", desc:"ラウンド2で遭遇", group:true, sub:[
    {key:"r2_early", label:"序盤", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.2)},
    {key:"r2_mid",   label:"中盤", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.5)},
    {key:"r2_late",  label:"終盤", getOffset:s=>s.reflectDelayMin+s.matchAvgMin+s.matchWaitMin+Math.round(s.matchAvgMin*0.8)},
  ]},
  // オフラインのみ有効期間5分固定・offset は必ずOFFLINE状態になる値
  {key:"offline", label:"⚫ オフライン", desc:"オフライン確認（5分のみ有効）", overrideDurationMs:300000, getOffset:s=>s.reflectDelayMin+s.tournamentTotalMin+30},
];
// サブタイプを含むフラット検索
function findEncounterType(key){
  for(const et of ENCOUNTER_TYPES){
    if(et.key===key)return et;
    if(et.sub){const s=et.sub.find(s=>s.key===key);if(s)return s;}
  }
  return null;
}
// manualEvent 有効期間ヘルパー（overrideDurationMs が未設定なら 1時間）
function isManualActive(me){if(!me)return false;return(nowMs()-me.recordedAt)<(me.overrideDurationMs??3600000);}
function manualRem(me){if(!me)return 0;return Math.max(0,Math.round(((me.recordedAt+(me.overrideDurationMs??3600000))-nowMs())/60000));}
// offline / won / final_end は「遭遇中」ではないので danger 扱いしない
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
  updateLoginStatus();
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
      updateLoginStatus(); // バックエンドリストで状態を更新
    }
  }catch{}
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
  if(!et||et.group)return; // groupボタン自体は無視（サブボタンで呼ぶ）
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
  // API呼び出しなし → キャッシュ行をその場で更新して即時再描画（フラッシュなし）
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
  if(viewMode==="global"){
    const filtered=getFilteredCommunity(globalFilter);
    return filtered.map(e=>e.name);
  }
  return parseNames(document.getElementById("namesBox").value);
}
// ────────────────────────────────────────────────────────────
function applySettingsToUi(s){
  document.getElementById("proxyBase").value=s.proxyBase||"";
  if(document.getElementById("globalUrl"))document.getElementById("globalUrl").value=s.globalUrl||"";
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
    proxyBase:document.getElementById("proxyBase").value.trim(),
    globalUrl:document.getElementById("globalUrl")?document.getElementById("globalUrl").value.trim():"",
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
  const X = reflectDelayMin;

  if(!skipOffline20){
    // ① バッチ検出済み：lastBatchAt が lastChangeAt より 5分以上新しい
    //    → 最新バッチでこのプレイヤーのポイント変動なし = OFFLINE確定
    const lastBatch = estimator.lastBatchAt;
    const BATCH_BUF_MS = 5 * 60 * 1000; // ポーリングズレ吸収バッファ
    if(lastBatch && lastBatch > lastChangeAtMs + BATCH_BUF_MS){
      return { state:"OFFLINE", nextMatchProb:0 };
    }
    // ② バッチデータなし（エスティメーター未起動）→ 時間ベースのフォールバック（20分固定）
    if(!lastBatch && tMin >= 20) return { state:"OFFLINE", nextMatchProb:0 };
  }
  const W = Math.max(0, Math.min(30, matchWaitMin ?? 5));   // lobby/queue wait before next match
  const M = Math.max(20, Math.min(60, matchAvgMin || 31));  // minimum match duration (31min fastest)
  const J = Math.max(0, Math.min(10, matchJitterMin ?? 3)); // +jitter tolerance (one-sided)
  const T = Math.max(M + W + 5, Math.min(180, tournamentTotalMin || 70));

  // State transitions
  let state = "LOBBY";
  if(tMin < X)                 state = "POST_MATCH_WAIT";
  else if(tMin < X + W)        state = "LOBBY";              // queuing for next match
  else if(tMin < X + W + M)    state = "IN_MATCH";           // minimum 31min not elapsed → in match
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

  p = Math.min(0.80, clamp01(p)); // 最高80%（100%前提の見え方を避ける）
  return { state, nextMatchProb: Math.round(p * 100) };
}

function isCorsLikeError(msg){
  const m=String(msg||"");
  return m.includes("Failed to fetch")||m.includes("NetworkError")||m.includes("CORS");
}
async function fetchPlayer(proxyBase,leaderboardId,platform,name){
  const qp=new URLSearchParams({name,leaderboardId,platform});
  if(proxyBase){
    const url=proxyBase.replace(/\/$/,"")+"/api/player?"+qp.toString();
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
      ?'<span class="badge" style="background:#2a0808;color:#ff5555;border-color:#7a1a1a;margin:0 5px 0 2px">⛔ BAN</span>'
      :isNameChange
        ?'<span class="badge" style="background:#082030;color:#6de9ff;border-color:#1e5a8a;margin:0 5px 0 2px">🔵 NC</span>'
        :"";
    const missingBadge=(!isBan&&!isNameChange&&isMissing)
      ?'<span class="badge" style="background:#2a1200;color:#ff9944;border-color:#7a3800;">🟠 Missing</span>'
      :"";
    const regionBadge=r.region?`<span class="regionTag regionTag-${r.region}">${r.region}</span>`:"";
    const key=r.name.toLowerCase();
    const isExpanded=expandedRows.has(key);
    const isPicked=pickedUp.has(key);
    const manualActive=isManualActive(r.manualEvent);
    const manualType=r.manualEvent?.type;
    const isWonOrFinal=manualType==="won"||manualType==="final_end";
    const manualRemMin=manualActive?manualRem(r.manualEvent):0;
    const manualBadge=manualActive?`<span class="manualBadge">📌 ${manualRemMin}m</span>`:"";
    const tr=document.createElement("tr");
    if(manualActive&&!isWonOrFinal&&manualType!=="offline")tr.classList.add("tr--danger");
    else if(manualActive&&isWonOrFinal)tr.classList.add("tr--watching");
    tr.innerHTML=`
      <td class="nameCell"><button class="pickupBtn${isPicked?" pickupOn":""}" title="ピックアップ（大型グラフに追加）">★</button>${statusBadge}${r.name} ${regionBadge}${missingBadge}<span class="expandCaret">${isExpanded?"▴":"▾"}</span></td>
      <td class="rankCell">${renderBadge(r.leaderboardRank,r.league)}</td>
      <td class="num">${(r.points==null)?"N/A":r.points.toLocaleString()}</td>
      <td class="num">${(r.delta==null)?"—":(r.delta>=0?("+"+r.delta):r.delta)}</td>
      <td class="tsCell">${fmtAgo(r.lastRealChangeAt)}</td>
      <td><span class="state ${displayState}">${stateLabel(displayState)}</span>${manualBadge}</td>
      <td class="num">${isMissing?"—":r.nextMatchProb??0}%</td>
      <td class="tsCell">${r.lastOkAt?fmtTs(r.lastOkAt):"—"}</td>
      <td class="errCell">${r.error||""}</td>
      <td class="actCell"><button class="resetBtn" title="遭遇記録（クリックで展開）">⚔</button><button class="deleteBtn" title="削除">✕</button></td>
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
    const now2=nowMs();
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
  await Promise.all(names.map(async(name)=>{
    const key=name.toLowerCase();
    const prev=snapshots[key]||{};
    let points=null,stale=false,errMsg="",freshRank=null,freshLeague=null,freshAltNames=null;
    try{
      const data=await fetchPlayer(settings.proxyBase,settings.leaderboardId,settings.platform,name);
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
    let lastChangeAt=prev.lastChangeAt??null;
    let lastRealChangeAt=prev.lastRealChangeAt??null; // 実際のポイント変動のみ記録（表示用）
    let manualEvent=prev.manualEvent??null; // 手動遭遇記録
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
        if(delta!==0){lastChangeAt=now;lastRealChangeAt=now;pushEvent({ts:now,name,points:currentPoints,delta,inferred_state:null},settings.maxEvents);}
        // RS急落アラート
        if(delta<=-settings.rsDropThreshold){
          const prevRk=prev.leaderboardRank;
          const newRk=freshRank??leaderboardRank;
          const rankPart=(prevRk&&newRk)?" / #"+prevRk.toLocaleString()+" → #"+newRk.toLocaleString():"";
          toast("📉 <b>"+name+"</b> RS急減: "+prev.points.toLocaleString()+" → "+currentPoints.toLocaleString()+" (<b>"+delta+"</b>)"+rankPart);
        }
      }else if(prev.points==null){
        // 初回観測：prev.lastChangeAt がなければ lastBatchAt か now で設定
        // （prev.lastChangeAt がある場合は上書きしない→追加後オフライン判定を正常化）
        if(!lastChangeAt) lastChangeAt=estimator.lastBatchAt??now;
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
    // manualEvent: APIでポイント変化を検出したらクリア。1時間経過でも無効化
    if(delta!==null&&delta!==0)manualEvent=null;
    const manualActive=isManualActive(manualEvent);
    if(!manualActive)manualEvent=null;
    const effectiveLCA=manualActive?manualEvent.lastChangeAtOverride:lastChangeAt;
    const region=prev.region??"";
    snapshots[key]={points:currentPoints,lastChangeAt,lastRealChangeAt,lastOkAt,leaderboardRank,league,notFoundCount,lastFoundAt,banNotified,altNames,suspectedReason,suspectedNewName,region,...(manualEvent?{manualEvent}:{})};
    const inf=(manualActive&&manualEvent?.type==="offline")?{state:"OFFLINE",nextMatchProb:0}:inferState(now,effectiveLCA,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,manualActive);
    // 状態変化をログ記録
    const prevRowState=lastRows.find(r=>r.name.toLowerCase()===key)?.state;
    if(prevRowState && prevRowState!==inf.state) pushStateLog({ts:now,name,from:prevRowState,to:inf.state,points:currentPoints,delta});
    rows.push({name,points:currentPoints,delta,lastChangeAt,lastRealChangeAt,effectiveLCA,manualEvent:manualActive?manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt,leaderboardRank,league,region,notFoundCount,lastFoundAt,suspectedReason,suspectedNewName,error:stale?errMsg:""});
  }));
  saveSnapshots(snapshots);
  // グローバルモード: スナップショットをバックエンドに送信（他ユーザーと共有）
  if(viewMode==="global"){const _gs=getUiSettings();if(_gs.globalUrl){Object.entries(snapshots).forEach(([k,s])=>submitSnapshotToGlobal(_gs.globalUrl,k,s));}}
  rows.sort((a,b)=>{
    const ta=a.lastChangeAt?(now-a.lastChangeAt):1e18;
    const tb=b.lastChangeAt?(now-b.lastChangeAt):1e18;
    if(ta!==tb)return ta-tb;
    return a.name.localeCompare(b.name);
  });
  document.getElementById("lastPoll").textContent=new Date(now).toLocaleTimeString();
  if(anyCors && !settings.proxyBase) setNetHint("CORSっぽい失敗あり → worker.js をデプロイして Proxy Base URL を設定推奨");
  else setNetHint("");
  lastRows=rows; // 遭遇ボタンの即時再描画用にキャッシュ
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
      bar.title=`+${i}分後: ${combined[i]}%`;
      barsEl.appendChild(bar);
    }
  }
  const axEl=document.getElementById("pickupAxis");
  if(axEl){axEl.innerHTML="";[0,5,10,15,20,25].forEach(m=>{const s=document.createElement("span");s.textContent=m===0?"今":"+"+m+"m";axEl.appendChild(s);});}
  const nameEl=document.getElementById("pickupNames");if(nameEl)nameEl.textContent=picked.map(r=>r.name).join("、");
  const pctEl=document.getElementById("pickupPeak");if(pctEl)pctEl.textContent=`ピーク ${combined[peak]}% (+${peak}分後)`;
}
function renderLogList(){
  const el=document.getElementById("logList");if(!el)return;
  const logs=getStateLogs().slice(-200).reverse();
  const count=document.getElementById("logCount");
  if(count)count.textContent=`(${getStateLogs().length}件)`;
  if(logs.length===0){el.innerHTML='<div style="color:#5a7aaa;padding:8px 0">ログなし</div>';return;}
  const stateColor={OFFLINE:"#8ea0b7",LOBBY:"#5b9cf6","In Match (Est. R1)":"#39d98a","In Match (Est. R2)":"#39d98a","Final Round":"#c77dff"};
  el.innerHTML=logs.map(e=>{
    const t=new Date(e.ts).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const delta=e.delta!=null?(e.delta>0?"+"+e.delta:String(e.delta)):"";
    const toLabel=STATE_LABEL[e.to]||e.to||"?";
    const col=stateColor[toLabel]||"#e7edf5";
    return`<div class="logEntry"><span class="logTime">${t}</span><span class="logName">${e.name}</span><span class="logFrom">${STATE_LABEL[e.from]||e.from||"?"}</span><span class="logArrow">→</span><span class="logTo" style="color:${col}">${toLabel}</span>${delta?`<span class="logDelta" style="color:${e.delta>0?"#39d98a":"#ff7b7b"}">${delta}</span>`:""}</div>`;
  }).join("");
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
function doStart(){
  if(timer){clearInterval(timer);timer=null;}
  const settings=getUiSettings();saveSettings(settings);
  const names=getActiveNames();
  if(names.length===0)return;
  if(viewMode==="personal"){try{saveNamesToUrl(names);}catch{}saveNamesToLocal(names);}
  currentSettings=settings;
  setRunning(true);
  pollOnce(names,settings);
  timer=setInterval(()=>{pollOnce(getActiveNames(),settings);},settings.pollIntervalSec*1000);
}
// グローバルモード: バックエンドのスナップショットを取得してテーブルに先行表示
async function preloadRemoteSnapshots(settings){
  const remote=await fetchGlobalSnapshots(settings.globalUrl);
  if(!remote||typeof remote!=="object")return;
  const names=getActiveNames();
  const now=Date.now();
  const rows=names.map(name=>{
    const snap=remote[name.toLowerCase()];
    if(!snap||snap.points==null)return null;
    const inf=inferState(now,snap.lastChangeAt,settings.reflectDelayMin,settings.matchWaitMin,settings.matchAvgMin,settings.matchJitterMin,settings.tournamentTotalMin,false);
    return {name,points:snap.points,delta:null,lastChangeAt:snap.lastChangeAt,effectiveLCA:snap.lastChangeAt,manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:settings.reflectDelayMin,matchWaitMin:settings.matchWaitMin,matchAvgMin:settings.matchAvgMin,matchJitterMin:settings.matchJitterMin,tournamentTotalMin:settings.tournamentTotalMin,lastOkAt:snap.lastOkAt,leaderboardRank:snap.leaderboardRank,league:snap.league,region:snap.region,notFoundCount:snap.notFoundCount||0,lastFoundAt:snap.lastFoundAt,suspectedReason:snap.suspectedReason,suspectedNewName:snap.suspectedNewName,error:"🌐 共有データ",isShared:true};
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
  if(settings.globalUrl){
    document.getElementById("globalStatus").textContent="🌐 同期中...";
    await fetchAndMergeCommunity(settings.globalUrl);
  }
  renderGlobalPlayerList();
  const total=getCommunityList().length;
  const filtered=getFilteredCommunity(globalFilter).length;
  document.getElementById("globalStatus").textContent=
    total===0?"ℹ️ まだ登録がありません。下のフォームから追加してください"
    :`🌐 ${globalFilter==="all"?"全サーバー":REGION_LABEL[globalFilter]}：${filtered}人 / 合計${total}人`;
  if(settings.globalUrl) preloadRemoteSnapshots(settings);
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
  document.querySelectorAll(".regionTab").forEach(btn=>{
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
      const catLabel=CAT_LABEL[e.category]||e.category||"";
      const catClass=e.category==="cheater"?"catCheater":e.category==="suspicious"?"catSuspicious":"catNotable";
      return `<div class="globalPlayerItem">
        <span class="globalPlayerName">${e.name}</span>
        <span class="catBadge ${catClass}">${catLabel}</span>
        ${e.note?`<span class="communityNote">${e.note}</span>`:""}
        ${inPersonal?'<span class="badge" style="background:#0d2a0d;color:#39d98a;border-color:#1e5a1e;font-size:10px;">監視中</span>'
          :`<button class="globalAddBtn" data-name="${e.name}">＋監視</button>`}
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
        toast("＋ <b>"+btn.dataset.name+"</b> を自分のリストに追加");
        renderGlobalPlayerList();
      }
    });
  });
  el.querySelectorAll(".communityDelBtn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(!confirm(btn.dataset.name+" をリストから削除しますか？"))return;
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
  if(timer){clearInterval(timer);timer=null;}
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
    const prevManual=prev.manualEvent??null;
    const prevManualActive=isManualActive(prevManual);
    const effectiveLCA=prevManualActive?prevManual.lastChangeAtOverride:(prev.lastChangeAt??null);
    const inf=inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,prevManualActive);
    const newRow={name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,manualEvent:prevManualActive?prevManual:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:0,lastFoundAt:null,suspectedReason:null,suspectedNewName:null,error:""};
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
        const manualEvent=prev.manualEvent??null;
        const manualActive=isManualActive(manualEvent);
        const effectiveLCA=manualActive?manualEvent.lastChangeAtOverride:(prev.lastChangeAt??null);
        const inf=(manualActive&&manualEvent?.type==="offline")?{state:"OFFLINE",nextMatchProb:0}:inferState(now,effectiveLCA,s.reflectDelayMin,s.matchWaitMin,s.matchAvgMin,s.matchJitterMin,s.tournamentTotalMin,manualActive);
        return {name,points:prev.points??null,delta:null,lastChangeAt:prev.lastChangeAt??null,effectiveLCA,manualEvent:manualActive?manualEvent:null,state:inf.state,nextMatchProb:inf.nextMatchProb,reflectDelayMin:s.reflectDelayMin,matchWaitMin:s.matchWaitMin,matchAvgMin:s.matchAvgMin,matchJitterMin:s.matchJitterMin,tournamentTotalMin:s.tournamentTotalMin,lastOkAt:prev.lastOkAt??null,leaderboardRank:prev.leaderboardRank??null,league:prev.league??null,notFoundCount:prev.notFoundCount??0,lastFoundAt:prev.lastFoundAt??null,suspectedReason:prev.suspectedReason??null,suspectedNewName:prev.suspectedNewName??null,error:""};
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
    if(timer){clearInterval(timer);timer=null;}
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
      const data=await fetchPlayer(settings.proxyBase,settings.leaderboardId,settings.platform,first);
      const entry=(data&&Array.isArray(data.data)&&data.data.length)?data.data[0]:null;
      const pts=entry?getPointsFromEntry(entry):null;
      if(pts==null) toast("Test: <b>"+first+"</b> → points が取れません（season/platform/対象外の可能性）");
      else toast("Test: <b>"+first+"</b> → points=<b>"+pts+"</b>");
    }catch(e){
      const msg=String(e&&e.message?e.message:e);
      if(isCorsLikeError(msg) && !settings.proxyBase) toast("Test失敗（CORSの可能性）→ Worker をデプロイして Proxy Base URL を設定してください");
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
  // 地域フィルタータブ
  document.querySelectorAll(".regionTab").forEach(btn=>{
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
    // 認証チェック：許可ユーザーが設定済みで未ログインならモーダルを表示
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
    document.getElementById("communityName").value="";
    document.getElementById("communityNote").value="";
    toast("🌐 <b>"+name+"</b> をコミュニティリストに追加 ("+(CAT_LABEL[entry.category]||"")+" / "+(REGION_LABEL[entry.region]||"不明")+")");
    // バックエンドにも送信（設定済みなら）
    const settings=getUiSettings();
    if(settings.globalUrl)await addNameToGlobal(settings.globalUrl,name);
    renderGlobalPlayerList();
    const total=getCommunityList().length;
    document.getElementById("globalStatus").textContent=`🌐 合計${total}人`;
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
  document.getElementById("btnCopyToGlobal")?.addEventListener("click",()=>{
    const names=parseNames(document.getElementById("namesBox").value);
    if(!names.length){toast("リストが空です");return;}
    let added=0;
    for(const name of names){
      if(!getCommunityList().find(e=>e.name.toLowerCase()===name.toLowerCase())){
        addCommunityEntry({name,region:"",category:"notable",note:""});added++;
      }
    }
    toast(`🌐 <b>${added}人</b> をグローバルリストにコピーしました`);
    if(viewMode==="global")renderGlobalPlayerList();
  });
  // ログ
  document.getElementById("btnExportLogs")?.addEventListener("click",exportStateLogs);
  document.getElementById("btnClearLogs")?.addEventListener("click",()=>{
    if(!confirm("ログをクリアしますか？"))return;
    clearStateLogs();renderLogList();toast("ログをクリアしました");
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
    if(!settings.globalUrl){toast("⚠️ Global Backend URL を先に設定してください");return;}
    const auth=getAuthData();
    if(!auth.adminPasswordHash){toast("⚠️ アドミンパスワードを先に設定してください");return;}
    document.getElementById("btnSyncAuth").textContent="同期中...";
    const ok=await syncAuthToBackend(settings.globalUrl,auth.adminPasswordHash,auth.allowedUsers);
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

  // ── ヘッダー認証ボタン ──
  document.getElementById("btnHeaderLogin").addEventListener("click",()=>showLoginModal());
  document.getElementById("btnHeaderLogout").addEventListener("click",()=>{setCurrentUser(null);toast(t("toast.logout"));});
  document.getElementById("btnHeaderAdmin").addEventListener("click",()=>{document.getElementById("adminModal").style.display="flex";});
  document.getElementById("btnAdminModalClose").addEventListener("click",()=>{document.getElementById("adminModal").style.display="none";});

  // ── 初期ログイン状態を反映 + globalUrl があればバックエンドから取得 ──
  updateLoginStatus();
  const _initSettings=getUiSettings();
  if(_initSettings.globalUrl)fetchAuthConfig(_initSettings.globalUrl);

  setRunning(false);
  toast(t("toast.ready"));
}
init();

async function fetchLeaderboardViaProxy(settings){
  const base = settings.proxyBase ? settings.proxyBase.replace(/\/$/,"") : "";
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