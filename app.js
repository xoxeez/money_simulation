const $ = (id) => document.getElementById(id);
const won = (v) => (Math.round(v)).toLocaleString("ko-KR") + "원";
const eok = (v) => {
  const sign = v < 0 ? "-" : ""; const a = Math.abs(v);
  if (a >= 100000000) return sign + (a/100000000).toFixed(2).replace(/\.00$/,"") + "억";
  if (a >= 10000) return sign + Math.round(a/10000).toLocaleString() + "만";
  return won(v);
};

/* ---------- 기본 데이터 ---------- */
const defaultCfA = [
  { date:"2026-03-10", label:"계약금", amt:-100000000 },
  { date:"2026-06-20", label:"중도금", amt:-150000000 },
  { date:"2026-09-30", label:"주택담보대출 실행", amt:350000000 },
  { date:"2026-09-30", label:"잔금", amt:-400000000 },
  { date:"2026-10-05", label:"법무사·취득세", amt:-15000000 },
];
const defaultCfB = [
  { date:"2026-04-01", label:"계약금", amt:-80000000 },
  { date:"2026-08-15", label:"주택담보대출 실행", amt:300000000 },
  { date:"2026-08-15", label:"잔금", amt:-350000000 },
  { date:"2026-08-20", label:"법무사·취득세", amt:-12000000 },
];
const defaultExpenses = [
  { name:"월세 / 관리비", amt:900000 }, { name:"식비 / 장보기", amt:600000 },
  { name:"공과금 (전기·가스·수도)", amt:200000 }, { name:"통신비 / 구독", amt:150000 },
  { name:"생필품", amt:100000 }, { name:"데이트 / 여가", amt:300000 },
];
let cfA = [...defaultCfA], cfB = [...defaultCfB], expenses = [...defaultExpenses];

/* ---------- 렌더링 ---------- */
function renderCf(list, boxId) {
  const box = $(boxId); box.innerHTML = "";
  list.forEach((e,i) => {
    const row = document.createElement("div"); row.className = "cf-row";
    row.innerHTML = `<input type="date" value="${e.date}" data-i="${i}" data-k="date" />
      <input type="text" value="${e.label}" data-i="${i}" data-k="label" placeholder="항목" />
      <input type="number" value="${e.amt}" data-i="${i}" data-k="amt" placeholder="±금액" />
      <button class="btn-del" data-del="${i}">×</button>`;
    box.appendChild(row);
  });
}
function renderExpenses(list) {
  const box = $("expList"); box.innerHTML = "";
  list.forEach((e,i) => {
    const row = document.createElement("div"); row.className = "exp-row";
    row.innerHTML = `<input type="text" value="${e.name}" data-i="${i}" data-k="name" placeholder="항목명" />
      <input type="number" value="${e.amt}" data-i="${i}" data-k="amt" min="0" />
      <button class="btn-del" data-del="${i}">×</button>`;
    box.appendChild(row);
  });
}
renderCf(cfA,"cfListA"); renderCf(cfB,"cfListB"); renderExpenses(expenses);

function bindCf(boxId, list) {
  $(boxId).addEventListener("input", (ev) => {
    const t = ev.target; if (t.dataset.i === undefined) return;
    const i = +t.dataset.i, k = t.dataset.k;
    if (k === "amt") list[i].amt = +t.value || 0; else list[i][k] = t.value;
  });
  $(boxId).addEventListener("click", (ev) => {
    if (ev.target.dataset.del !== undefined) { list.splice(+ev.target.dataset.del,1); renderCf(list, boxId); }
  });
}
bindCf("cfListA",cfA); bindCf("cfListB",cfB);
$("addCfA").addEventListener("click", ()=>{ cfA.push({date:"2026-01-01",label:"새 항목",amt:0}); renderCf(cfA,"cfListA"); });
$("addCfB").addEventListener("click", ()=>{ cfB.push({date:"2026-01-01",label:"새 항목",amt:0}); renderCf(cfB,"cfListB"); });

$("expList").addEventListener("input", (ev) => {
  const t = ev.target; if (t.dataset.i === undefined) return;
  const i = +t.dataset.i; if (t.dataset.k === "name") expenses[i].name = t.value; else expenses[i].amt = +t.value || 0;
});
$("expList").addEventListener("click", (ev) => {
  if (ev.target.dataset.del !== undefined) { expenses.splice(+ev.target.dataset.del,1); renderExpenses(expenses); }
});
$("addExp").addEventListener("click", ()=>{ expenses.push({name:"새 항목",amt:0}); renderExpenses(expenses); });

/* ---------- 이름 동기화 ---------- */
function syncNames() {
  const a = $("nameA").value || "본인", b = $("nameB").value || "남자친구";
  document.querySelectorAll(".nA,.nA2").forEach(el=>el.textContent=a);
  document.querySelectorAll(".nB,.nB2").forEach(el=>el.textContent=b);
}
$("nameA").addEventListener("input", syncNames);
$("nameB").addEventListener("input", syncNames);

/* ---------- 탭 ---------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active"); $("tab-"+btn.dataset.tab).classList.add("active");
  });
});

/* ---------- 주택 시뮬레이션 ---------- */
let flowChart;
function buildLedger(budget, list) {
  const sorted = [...list].sort((x,y)=> (x.date||"").localeCompare(y.date||""));
  let bal = budget; const rows = [];
  sorted.forEach(e => { bal += (+e.amt||0); rows.push({...e, bal}); });
  return { rows, final: bal };
}
function calcHouse() {
  syncNames();
  const budgetA=+$("budgetA").value||0, budgetB=+$("budgetB").value||0;
  const nameA=$("nameA").value||"본인", nameB=$("nameB").value||"남자친구";
  const inSum=(l)=>l.filter(e=>e.amt>0).reduce((s,e)=>s+e.amt,0);
  const outSum=(l)=>l.filter(e=>e.amt<0).reduce((s,e)=>s+e.amt,0);
  $("inA").textContent=eok(inSum(cfA)); $("outA").textContent=eok(outSum(cfA)); $("netA").textContent=eok(inSum(cfA)+outSum(cfA));
  $("inB").textContent=eok(inSum(cfB)); $("outB").textContent=eok(outSum(cfB)); $("netB").textContent=eok(inSum(cfB)+outSum(cfB));
  const A=buildLedger(budgetA,cfA), B=buildLedger(budgetB,cfB);
  $("rHouseA").textContent=$("houseA").value; $("rHouseB").textContent=$("houseB").value;
  const setBal=(id,descId,val)=>{ $(id).textContent=eok(val); $(id).className="v "+(val<0?"short":"ok");
    $(descId).textContent=val<0?`부족액 ${won(Math.abs(val))} — 추가 자금 필요`:`여유 ${won(val)}`; };
  setBal("rBalA","rBalADesc",A.final); setBal("rBalB","rBalBDesc",B.final);
  const tot=A.final+B.final; $("rBalTotal").textContent=eok(tot); $("rBalTotal").className="v "+(tot<0?"short":"ok");
  $("rBalTotalDesc").textContent=tot<0?`합산 부족액 ${won(Math.abs(tot))}`:`합산 여유 ${won(tot)}`;
  const fillLedger=(rows,tbId,budget)=>{ const tb=$(tbId); tb.innerHTML="";
    const tr0=document.createElement("tr"); tr0.innerHTML=`<td>시작</td><td>보유 예산</td><td>${won(budget)}</td><td>${won(budget)}</td>`; tb.appendChild(tr0);
    rows.forEach(r=>{ const cls=r.amt<0?"amt-minus":"amt-plus"; const balcls=r.bal<0?"short":"";
      const tr=document.createElement("tr"); tr.innerHTML=`<td>${r.date}</td><td>${r.label}</td><td class="${cls}">${won(r.amt)}</td><td class="${balcls}">${won(r.bal)}</td>`; tb.appendChild(tr); }); };
  fillLedger(A.rows,"ledgerA",budgetA); fillLedger(B.rows,"ledgerB",budgetB);
  const allDates=Array.from(new Set([...A.rows,...B.rows].map(r=>r.date))).sort();
  const seriesFor=(rows,budget)=>{ let last=budget; const map={}; rows.forEach(r=>map[r.date]=r.bal);
    return allDates.map(d=>{ if(map[d]!==undefined) last=map[d]; return last; }); };
  if (flowChart) flowChart.destroy();
  flowChart=new Chart($("flowChart"),{ type:"line",
    data:{ labels:["시작",...allDates], datasets:[
      {label:nameA,data:[budgetA,...seriesFor(A.rows,budgetA)],borderColor:"#6c5ce7",backgroundColor:"rgba(108,92,231,.12)",fill:true,tension:.2},
      {label:nameB,data:[budgetB,...seriesFor(B.rows,budgetB)],borderColor:"#00b8a9",backgroundColor:"rgba(0,184,169,.12)",fill:true,tension:.2}] },
    options:{ plugins:{legend:{position:"bottom",labels:{font:{family:"Pretendard"}}},
      tooltip:{callbacks:{label:(c)=>c.dataset.label+": "+won(c.parsed.y)}}},
      scales:{y:{ticks:{callback:(v)=>eok(v)}}}, maintainAspectRatio:false } });
  $("houseResults").style.display="block"; $("houseResults").scrollIntoView({behavior:"smooth"});
}
$("calcHouse").addEventListener("click", calcHouse);

/* ---------- 생활비 시뮬레이션 ---------- */
let pieChart, saveChart;
function calcLiving() {
  syncNames();
  const nameA=$("nameA").value||"본인", nameB=$("nameB").value||"남자친구";
  const incA=+$("incomeA").value||0, incB=+$("incomeB").value||0;
  const totalExp=expenses.reduce((s,e)=>s+(+e.amt||0),0);
  const saveMonthly=+$("saveMonthly").value||0, saveYears=+$("saveYears").value||1;
  const split=document.querySelector('input[name="split"]:checked').value;
  let rA=.5,rB=.5; if(split==="income"&&incA+incB>0){ rA=incA/(incA+incB); rB=incB/(incA+incB); }
  const pot=totalExp+saveMonthly, cA=pot*rA, cB=pot*rB;
  $("rContribA").textContent=won(cA); $("rContribB").textContent=won(cB);
  $("rLeftA").textContent="개인 여유자금 "+won(incA-cA); $("rLeftB").textContent="개인 여유자금 "+won(incB-cB);
  $("rTotal").textContent=won(pot);
  const body=$("detailBody"); body.innerHTML="";
  expenses.forEach(e=>{ const a=+e.amt||0; const tr=document.createElement("tr");
    tr.innerHTML=`<td>${e.name}</td><td>${won(a)}</td><td>${won(a*rA)}</td><td>${won(a*rB)}</td>`; body.appendChild(tr); });
  if(saveMonthly>0){ const tr=document.createElement("tr");
    tr.innerHTML=`<td>공동 저축</td><td>${won(saveMonthly)}</td><td>${won(saveMonthly*rA)}</td><td>${won(saveMonthly*rB)}</td>`; body.appendChild(tr); }
  $("dSum").textContent=won(pot); $("dSumA").textContent=won(cA); $("dSumB").textContent=won(cB);
  const totalSave=saveMonthly*12*saveYears; $("rSaveTotal").textContent=won(totalSave); $("rSaveDesc").textContent=`매월 ${won(saveMonthly)} × ${saveYears}년`;
  if(pieChart) pieChart.destroy();
  pieChart=new Chart($("pieChart"),{ type:"doughnut", data:{ labels:expenses.map(e=>e.name),
    datasets:[{data:expenses.map(e=>+e.amt||0),backgroundColor:["#6c5ce7","#00b8a9","#ff5e8a","#ffa94d","#4dabf7","#82c91e","#e64980","#a78bfa"],borderWidth:2,borderColor:"#fff"}]},
    options:{plugins:{legend:{position:"bottom",labels:{font:{family:"Pretendard"}}}},cutout:"58%",maintainAspectRatio:false} });
  if(saveChart) saveChart.destroy();
  const labels=[],dA=[],dB=[]; for(let y=0;y<=saveYears;y++){ labels.push(y+"년"); dA.push(Math.round(saveMonthly*rA*12*y)); dB.push(Math.round(saveMonthly*rB*12*y)); }
  saveChart=new Chart($("saveChart"),{ type:"line", data:{ labels, datasets:[
    {label:nameA,data:dA,borderColor:"#6c5ce7",backgroundColor:"#efecfd",fill:true,tension:.3},
    {label:nameB,data:dB,borderColor:"#00b8a9",backgroundColor:"#e2f7f4",fill:true,tension:.3}]},
    options:{plugins:{legend:{position:"bottom",labels:{font:{family:"Pretendard"}}}},scales:{y:{ticks:{callback:(v)=>eok(v)}}},maintainAspectRatio:false} });
  $("livingResults").style.display="block"; $("livingResults").scrollIntoView({behavior:"smooth"});
}
$("calcLiving").addEventListener("click", calcLiving);

/* ---------- 데이터 수집 / 적용 ---------- */
function collect() {
  return { nameA:$("nameA").value, nameB:$("nameB").value, budgetA:$("budgetA").value, budgetB:$("budgetB").value,
    houseA:$("houseA").value, houseB:$("houseB").value, cfA, cfB,
    incomeA:$("incomeA").value, incomeB:$("incomeB").value, expenses,
    split:document.querySelector('input[name="split"]:checked').value,
    saveMonthly:$("saveMonthly").value, saveYears:$("saveYears").value, updatedAt:new Date().toISOString() };
}
function apply(d) {
  if(!d) return;
  if(d.nameA!=null)$("nameA").value=d.nameA; if(d.nameB!=null)$("nameB").value=d.nameB;
  if(d.budgetA!=null)$("budgetA").value=d.budgetA; if(d.budgetB!=null)$("budgetB").value=d.budgetB;
  if(d.houseA!=null)$("houseA").value=d.houseA; if(d.houseB!=null)$("houseB").value=d.houseB;
  if(d.incomeA!=null)$("incomeA").value=d.incomeA; if(d.incomeB!=null)$("incomeB").value=d.incomeB;
  if(d.saveMonthly!=null)$("saveMonthly").value=d.saveMonthly; if(d.saveYears!=null)$("saveYears").value=d.saveYears;
  if(d.split==="income")$("split-income").checked=true;
  if(Array.isArray(d.cfA)){ cfA=d.cfA; renderCf(cfA,"cfListA"); bindCf("cfListA",cfA); }
  if(Array.isArray(d.cfB)){ cfB=d.cfB; renderCf(cfB,"cfListB"); bindCf("cfListB",cfB); }
  if(Array.isArray(d.expenses)){ expenses=d.expenses; renderExpenses(expenses); }
  syncNames();
}

/* ---------- Firebase (firebase-config.js 의 firebaseConfig / DOC_PATH 사용) ---------- */
let db=null;
function setStatus(text,state){ $("fbStatus").textContent=text; $("fbDot").className="fb-dot"+(state?" "+state:""); }
function initFirebase() {
  if (typeof firebaseConfig === "undefined") {
    setStatus("firebase-config.js 를 찾을 수 없습니다","err"); return;
  }
  if (String(firebaseConfig.apiKey).startsWith("여기에")) {
    setStatus("Firebase 미설정 (firebase-config.js 값 입력 필요)","err"); return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    setStatus("Firebase 연결됨 · "+firebaseConfig.projectId,"on");
    loadFromCloud(true);
  } catch(e){ console.error(e); setStatus("Firebase 연결 오류: "+e.message,"err"); }
}
async function saveToCloud() {
  const data=collect(); localStorage.setItem("coupleFund",JSON.stringify(data));
  if(!db){ alert("로컬에 저장했어요. (firebase-config.js 값을 채우면 클라우드에도 저장됩니다)"); return; }
  try { await db.collection(DOC_PATH[0]).doc(DOC_PATH[1]).set(data);
    setStatus("저장 완료 · "+new Date().toLocaleString("ko-KR"),"on"); }
  catch(e){ console.error(e); alert("클라우드 저장 실패: "+e.message); }
}
async function loadFromCloud(silent) {
  if(!db){ const s=localStorage.getItem("coupleFund");
    if(s){ apply(JSON.parse(s)); if(!silent) alert("로컬 데이터를 불러왔어요."); } else if(!silent) alert("저장된 데이터가 없어요."); return; }
  try { const snap=await db.collection(DOC_PATH[0]).doc(DOC_PATH[1]).get();
    if(snap.exists){ apply(snap.data()); setStatus("불러오기 완료 · "+new Date().toLocaleString("ko-KR"),"on"); }
    else if(!silent) alert("클라우드에 저장된 데이터가 아직 없어요. 먼저 저장해 주세요."); }
  catch(e){ console.error(e); if(!silent) alert("불러오기 실패: "+e.message); }
}
$("saveBtn").addEventListener("click", saveToCloud);
$("loadBtn").addEventListener("click", ()=>loadFromCloud(false));

/* ---------- 시작 ---------- */
(function boot(){
  const s=localStorage.getItem("coupleFund"); if(s){ try{ apply(JSON.parse(s)); }catch(e){} }
  syncNames(); initFirebase();
})();
