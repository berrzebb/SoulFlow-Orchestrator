/** 대시보드 프론트엔드 자산 — 서비스 내부 인라인 제공. */

const CSS = /* css */ `
:root {
  --bg: #121619; --panel: #1b2228; --line: #2b3742;
  --text: #dbe7f3; --muted: #91a4b7;
  --ok: #2fb171; --warn: #d9a441; --err: #c56a6a; --off: #7c8a98; --accent: #4a9eff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:"Consolas","Menlo",monospace;height:100%}
body{display:flex;flex-direction:column;gap:10px;padding:10px}
.topbar{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line);background:var(--panel);padding:10px 12px}
.topbar h1{font-size:16px;margin:0}
.meta{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:12px}
.pill{border:1px solid var(--line);padding:2px 8px;border-radius:999px;font-size:11px}
.layout{display:grid;grid-template-columns:1fr 360px;gap:10px;min-height:420px}
.panel{border:1px solid var(--line);background:var(--panel);padding:10px}
.panel h2{margin:0 0 8px 0;font-size:13px;color:var(--muted)}
.full{min-height:100px}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.section-header h2{margin:0}
.office-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.desk{border:1px solid var(--line);background:#141b20;padding:8px;min-height:82px;display:flex;flex-direction:column}
.desk .name{font-size:12px;font-weight:bold}
.desk .role{font-size:11px;color:var(--muted);margin-top:2px}
.desk .status{font-size:11px;margin-top:4px}
.desk-actions{margin-top:auto;padding-top:6px;display:flex;gap:4px}
.status.online{color:var(--ok)}.status.working{color:var(--warn)}.status.offline{color:var(--off)}
.kv{display:grid;gap:4px;font-size:12px;color:var(--muted);margin-bottom:8px}
.list{list-style:none;padding:0;margin:0;display:grid;gap:4px;max-height:220px;overflow:auto}
.list.compact{max-height:160px}
.list li{border:1px solid var(--line);background:#141b20;padding:6px 8px;font-size:12px;white-space:pre-wrap;display:flex;align-items:center;justify-content:space-between;gap:6px}
.list li .li-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.btn{background:#263040;color:var(--text);border:1px solid var(--line);padding:4px 10px;font-size:11px;font-family:inherit;cursor:pointer;border-radius:3px}
.btn:hover{background:#334055}
.btn-sm{padding:3px 8px;font-size:11px}
.btn-xs{padding:2px 6px;font-size:10px}
.btn-danger{color:var(--err);border-color:var(--err)}.btn-danger:hover{background:#3a2020}
.btn-ok{color:var(--ok);border-color:var(--ok)}.btn-ok:hover{background:#1a3a2a}
.btn-warn{color:var(--warn);border-color:var(--warn)}.btn-warn:hover{background:#3a3020}
.data-table{width:100%;border-collapse:collapse;font-size:12px}
.data-table th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:normal;font-size:11px}
.data-table td{padding:5px 8px;border-bottom:1px solid #1e2830}
.data-table tbody tr:hover{background:#1e2830}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold}
.badge-ok{background:#1a3a2a;color:var(--ok)}
.badge-warn{background:#3a3020;color:var(--warn)}
.badge-err{background:#3a2020;color:var(--err)}
.badge-off{background:#252c32;color:var(--off)}
.badge-info{background:#1a2a3a;color:var(--accent)}
.toggle{cursor:pointer;font-size:11px;user-select:none}
.toggle-on{color:var(--ok)}.toggle-off{color:var(--off)}
.empty{color:var(--muted);font-size:12px;font-style:italic}
.cron-controls{display:flex;gap:4px}
@media(max-width:980px){.layout{grid-template-columns:1fr}}
`;

const JS = /* js */ `
const $=id=>document.getElementById(id);
const nowText=$("nowText"),connText=$("connText"),runtimeInfo=$("runtimeInfo"),officeGrid=$("officeGrid");
const processList=$("processList"),taskList=$("taskList"),messageList=$("messageList");
const workflowEventList=$("workflowEventList"),decisionList=$("decisionList");
const cronStatus=$("cronStatus"),cronBody=$("cronBody");

function text(v){return String(v??"")}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function setConn(c){connText.textContent=c?"CONNECTED":"DISCONNECTED";connText.style.color=c?"var(--ok)":"var(--err)"}
function fmtTime(ms){if(!ms)return"-";return new Date(typeof ms==="number"?ms:ms).toLocaleString("sv-SE",{timeZone:"Asia/Seoul",hour12:false}).replace(" "," ")}
function fmtSchedule(s){if(!s)return"-";if(s.kind==="every")return"every "+fmtMs(s.every_ms);if(s.kind==="cron")return"cron: "+text(s.expr);if(s.kind==="at")return"at "+fmtTime(s.at_ms);return text(s.kind)}
function fmtMs(ms){if(!ms)return"-";if(ms<60000)return Math.round(ms/1000)+"s";if(ms<3600000)return Math.round(ms/60000)+"m";return(ms/3600000).toFixed(1)+"h"}

const STATUS_ICON={running:"\\u{1F504}",completed:"\\u2705",failed:"\\u274C",cancelled:"\\u{1F6AB}",waiting_approval:"\\u{1F510}",waiting_user_input:"\\u{1F4AC}",stopped:"\\u23F9\\uFE0F",max_turns_reached:"\\u26A0\\uFE0F"};

function statusBadge(status){
  const s=text(status).toLowerCase();let cls="badge-off";
  if(s.includes("run")||s.includes("work"))cls="badge-warn";
  else if(s.includes("complete")||s==="ok")cls="badge-ok";
  else if(s.includes("fail")||s.includes("error")||s.includes("cancel"))cls="badge-err";
  else if(s.includes("wait")||s==="idle")cls="badge-info";
  return '<span class="badge '+cls+'">'+esc(s)+'</span>';
}
function classifyStatus(a){const r=text(a.status).toLowerCase();if(r.includes("offline"))return"offline";if(r.includes("work")||r.includes("run"))return"working";return"online"}

async function apiPost(url,body){
  const opts={method:"POST",headers:{"Content-Type":"application/json"}};
  if(body!==undefined)opts.body=JSON.stringify(body);
  return(await fetch(url,opts)).ok;
}
async function cancelAgent(id){if(await apiPost("/api/agents/"+id+"/cancel"))refresh()}
function sendToAgent(id){const t=prompt("Send text to agent:");if(!t)return;apiPost("/api/agents/"+id+"/send",{text:t}).then(()=>refresh())}
async function cancelProcess(id){if(await apiPost("/api/processes/"+id+"/cancel"))refresh()}
async function cancelTask(id){if(await apiPost("/api/tasks/"+id+"/cancel"))refresh()}
async function toggleCronJob(id,en){if(await apiPost("/api/cron/jobs/"+id+"/enable",{enabled:en}))refresh()}
async function runCronJob(id){if(await apiPost("/api/cron/jobs/"+id+"/run",{force:true}))refresh()}
async function removeCronJob(id){if(!confirm("Remove cron job?"))return;if((await fetch("/api/cron/jobs/"+id,{method:"DELETE"})).ok)refresh()}
async function pauseCron(){if(await apiPost("/api/cron/pause"))refresh()}
async function resumeCron(){if(await apiPost("/api/cron/resume"))refresh()}
window.__dash={pauseCron,resumeCron};

function render(state){
  nowText.textContent=text(state.now||"-");
  runtimeInfo.innerHTML=[
    "queue: in="+text(state?.queue?.inbound??0)+" out="+text(state?.queue?.outbound??0),
    "channels: "+text((state?.channels?.enabled||[]).join(", ")||"-"),
    "mention_loop: "+text(state?.channels?.mention_loop_running??false),
  ].map(l=>"<div>"+l+"</div>").join("");

  officeGrid.innerHTML="";
  const agents=Array.isArray(state.agents)?state.agents:[];
  if(!agents.length)officeGrid.innerHTML='<div class="empty">No agents</div>';
  for(const a of agents){
    const s=classifyStatus(a),div=document.createElement("article");div.className="desk";
    div.innerHTML='<div class="name">'+esc(a.label||a.id)+'</div><div class="role">'+esc(a.role||"-")+'</div><div class="status '+s+'">'+s.toUpperCase()+'</div><div class="desk-actions"><button class="btn btn-xs btn-danger" data-action="cancel-agent" data-id="'+esc(a.id)+'">Cancel</button><button class="btn btn-xs" data-action="send-agent" data-id="'+esc(a.id)+'">Send</button></div>';
    officeGrid.appendChild(div);
  }

  renderProcesses(state.processes);
  renderTasks(state.tasks);
  renderSimpleList(messageList,state.messages||[],m=>esc(m.sender_id)+": "+esc(m.content));
  renderCron(state.cron);
  renderSimpleList(workflowEventList,state.workflow_events||[],e=>statusBadge(e.phase)+" "+esc(e.task_id||"-")+" \\u00B7 "+esc(e.agent_id||"-")+" \\u00B7 "+esc(e.summary||""));
  renderSimpleList(decisionList,state.decisions||[],d=>'<span class="badge badge-info">p'+esc(String(d.priority))+"</span> "+esc(d.canonical_key)+" = "+esc(String(d.value)));
}

function renderProcesses(procs){
  processList.innerHTML="";
  if(!procs){processList.innerHTML='<li><span class="li-text empty">-</span></li>';return}
  const active=procs.active||[],recent=procs.recent||[];
  if(!active.length&&!recent.length){processList.innerHTML='<li><span class="li-text empty">No processes</span></li>';return}
  for(const p of active){const li=document.createElement("li");li.innerHTML='<span class="li-text">'+statusBadge(p.status)+' <b>'+esc(p.alias)+'</b> ['+esc(p.mode)+'] tool:'+p.tool_calls_count+'</span><button class="btn btn-xs btn-danger" data-action="cancel-process" data-id="'+esc(p.run_id)+'">Cancel</button>';processList.appendChild(li)}
  for(const p of recent.slice(0,5)){const li=document.createElement("li");li.innerHTML='<span class="li-text">'+statusBadge(p.status)+" "+esc(p.alias)+" ["+esc(p.mode)+"] tool:"+p.tool_calls_count+(p.error?" \\u26A0":"")+"</span>";processList.appendChild(li)}
}

function renderTasks(tasks){
  taskList.innerHTML="";
  if(!tasks||!tasks.length){taskList.innerHTML='<li><span class="li-text empty">No tasks</span></li>';return}
  for(const t of tasks){
    const icon=STATUS_ICON[t.status]||"\\u2753";
    const isActive=t.status==="running"||t.status==="waiting_approval"||t.status==="waiting_user_input";
    const li=document.createElement("li");
    li.innerHTML='<span class="li-text">'+icon+' <b>'+esc(t.title||t.taskId)+'</b> '+statusBadge(t.status)+' turn '+(t.currentTurn||0)+'/'+(t.maxTurns||0)+'</span>'+(isActive?'<button class="btn btn-xs btn-danger" data-action="cancel-task" data-id="'+esc(t.taskId)+'">Cancel</button>':"");
    taskList.appendChild(li);
  }
}

function renderCron(cron){
  if(!cron){cronStatus.innerHTML='<div class="empty">Cron unavailable</div>';cronBody.innerHTML="";return}
  const paused=cron.paused?'<span class="badge badge-warn">PAUSED</span>':'<span class="badge badge-ok">ACTIVE</span>';
  cronStatus.innerHTML="<div>"+paused+" jobs: "+(cron.jobs?.length??0)+" \\u00B7 next wake: "+fmtTime(cron.next_wake_at_ms)+"</div>";
  cronBody.innerHTML="";
  const jobs=cron.jobs||[];
  if(!jobs.length){cronBody.innerHTML='<tr><td colspan="6" class="empty">No cron jobs</td></tr>';return}
  for(const j of jobs){
    const tr=document.createElement("tr");
    const lastBadge=j.state?.last_status?statusBadge(j.state.last_status):"-";
    const eCls=j.enabled?"toggle-on":"toggle-off";
    const eLabel=j.enabled?"ON":"OFF";
    const isRunning=j.state?.running;
    tr.innerHTML='<td><b>'+esc(j.name)+'</b><br><span style="color:var(--muted);font-size:10px">'+esc(j.id.slice(0,12))+'</span></td><td>'+fmtSchedule(j.schedule)+'</td><td><span class="toggle '+eCls+'" data-action="toggle-cron" data-id="'+esc(j.id)+'" data-enabled="'+(j.enabled?"1":"0")+'">'+eLabel+'</span></td><td>'+fmtTime(j.state?.next_run_at_ms)+'</td><td>'+lastBadge+(j.state?.last_error?' <span style="color:var(--err);font-size:10px">'+esc(j.state.last_error.slice(0,40))+"</span>":"")+'</td><td><button class="btn btn-xs btn-ok" data-action="run-cron" data-id="'+esc(j.id)+'"'+(isRunning?" disabled":"")+'>Run</button> <button class="btn btn-xs btn-danger" data-action="remove-cron" data-id="'+esc(j.id)+'">Del</button></td>';
    cronBody.appendChild(tr);
  }
}

function renderSimpleList(el,rows,mapFn){
  el.innerHTML="";
  if(!rows||!rows.length){el.innerHTML='<li><span class="li-text empty">-</span></li>';return}
  for(const row of rows){const li=document.createElement("li");li.innerHTML='<span class="li-text">'+mapFn(row)+"</span>";el.appendChild(li)}
}

document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-action]");if(!btn)return;
  const action=btn.dataset.action,id=btn.dataset.id;
  switch(action){
    case"cancel-agent":cancelAgent(id);break;case"send-agent":sendToAgent(id);break;
    case"cancel-process":cancelProcess(id);break;case"cancel-task":cancelTask(id);break;
    case"toggle-cron":toggleCronJob(id,btn.dataset.enabled==="0");break;
    case"run-cron":runCronJob(id);break;case"remove-cron":removeCronJob(id);break;
  }
});

async function pullState(){const r=await fetch("/api/state",{cache:"no-store"});if(!r.ok)throw new Error("state_http_"+r.status);return r.json()}
async function refresh(){try{render(await pullState());setConn(true)}catch{setConn(false)}}
let _refreshTimer=null;
function debouncedRefresh(){if(_refreshTimer)return;_refreshTimer=setTimeout(()=>{_refreshTimer=null;void refresh()},300)}
function startSse(){const es=new EventSource("/api/events");es.addEventListener("ready",()=>setConn(true));es.addEventListener("reload",()=>void refresh());es.addEventListener("process",()=>debouncedRefresh());es.addEventListener("cron",()=>debouncedRefresh());es.addEventListener("message",()=>debouncedRefresh());es.onerror=()=>setConn(false)}
startSse();void refresh();setInterval(()=>void refresh(),10000);
`;

const HTML_TEMPLATE = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Orchestrator Dashboard</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="topbar">
    <h1>Orchestrator Dashboard</h1>
    <div class="meta">
      <span id="nowText">-</span>
      <span id="connText" class="pill">DISCONNECTED</span>
    </div>
  </header>
  <main class="layout">
    <section class="panel office">
      <h2>Agents</h2>
      <div id="officeGrid" class="office-grid"></div>
    </section>
    <aside class="panel side">
      <h2>Runtime</h2>
      <div id="runtimeInfo" class="kv"></div>
      <h2>Processes</h2>
      <ul id="processList" class="list"></ul>
      <h2>Tasks</h2>
      <ul id="taskList" class="list"></ul>
      <h2>Messages</h2>
      <ul id="messageList" class="list compact"></ul>
    </aside>
  </main>
  <section class="panel full">
    <div class="section-header">
      <h2>Cron Jobs</h2>
      <div class="cron-controls">
        <button class="btn btn-sm" onclick="window.__dash.pauseCron()">Pause</button>
        <button class="btn btn-sm" onclick="window.__dash.resumeCron()">Resume</button>
      </div>
    </div>
    <div id="cronStatus" class="kv"></div>
    <table class="data-table"><thead><tr>
      <th>Name</th><th>Schedule</th><th>Enabled</th><th>Next Run</th><th>Last</th><th>Actions</th>
    </tr></thead><tbody id="cronBody"></tbody></table>
  </section>
  <section class="panel full">
    <h2>Workflow Events</h2>
    <ul id="workflowEventList" class="list compact"></ul>
  </section>
  <section class="panel full">
    <h2>Decisions</h2>
    <ul id="decisionList" class="list compact"></ul>
  </section>
  <script>${JS}</script>
</body>
</html>`;

export function get_dashboard_html(): string {
  return HTML_TEMPLATE;
}
