const nowText = document.getElementById("nowText");
const connText = document.getElementById("connText");
const runtimeInfo = document.getElementById("runtimeInfo");
const officeGrid = document.getElementById("officeGrid");
const taskList = document.getElementById("taskList");
const messageList = document.getElementById("messageList");
const decisionList = document.getElementById("decisionList");

function text(v) {
  return String(v ?? "");
}

function setConn(connected) {
  connText.textContent = connected ? "CONNECTED" : "DISCONNECTED";
  connText.style.color = connected ? "#2fb171" : "#c56a6a";
}

function setList(el, rows, map) {
  el.innerHTML = "";
  if (!rows || rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "-";
    el.appendChild(li);
    return;
  }
  for (const row of rows) {
    const li = document.createElement("li");
    li.textContent = map(row);
    el.appendChild(li);
  }
}

function classifyStatus(agent) {
  const raw = text(agent.status).toLowerCase();
  if (raw.includes("offline")) return "offline";
  if (raw.includes("work") || raw.includes("run")) return "working";
  return "online";
}

function render(state) {
  nowText.textContent = text(state.now || "-");
  runtimeInfo.innerHTML = [
    `queue.in: ${text(state?.queue?.inbound ?? 0)}`,
    `queue.out: ${text(state?.queue?.outbound ?? 0)}`,
    `channels: ${text((state?.channels?.enabled || []).join(", ") || "-")}`,
    `mention_loop: ${text(state?.channels?.mention_loop_running ?? false)}`,
    `heartbeat: ${text(state?.heartbeat?.enabled ?? false)}`,
  ].map((line) => `<div>${line}</div>`).join("");

  officeGrid.innerHTML = "";
  const agents = Array.isArray(state.agents) ? state.agents : [];
  for (const a of agents) {
    const status = classifyStatus(a);
    const div = document.createElement("article");
    div.className = "desk";
    div.innerHTML = `
      <div class="name">${text(a.label || a.id)}</div>
      <div class="role">${text(a.role || "-")}</div>
      <div class="status ${status}">${status.toUpperCase()}</div>
    `;
    officeGrid.appendChild(div);
  }

  setList(taskList, state.tasks || [], (t) => `${text(t.taskId)} | ${text(t.status)} | step=${text(t.currentStep)}`);
  setList(messageList, state.messages || [], (m) => `${text(m.sender_id)}: ${text(m.content)}`);
  setList(decisionList, state.decisions || [], (d) => `[p${text(d.priority)}] ${text(d.canonical_key)} = ${text(d.value)}`);
}

async function pullState() {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (!r.ok) throw new Error(`state_http_${r.status}`);
  return r.json();
}

async function refresh() {
  try {
    const state = await pullState();
    render(state);
    setConn(true);
  } catch {
    setConn(false);
  }
}

function startSse() {
  const es = new EventSource("/api/events");
  es.addEventListener("ready", () => setConn(true));
  es.addEventListener("reload", () => {
    void refresh();
  });
  es.onerror = () => setConn(false);
}

startSse();
void refresh();
setInterval(() => {
  void refresh();
}, 2500);
