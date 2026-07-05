// Tab switching
function showSection(id) {
  document.querySelectorAll('section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'instructions') loadInstructions();
  if (id === 'chats') loadChats();
  if (id === 'cron') loadCronTasks();
  if (id === 'settings') loadSettings();
}

// --- Settings ---
async function loadSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  if (data) {
    if (data.contextCount !== undefined) {
      document.getElementById('context-count').value = data.contextCount;
    }
    if (data.isPaused !== undefined) {
      document.getElementById('ai-paused').checked = data.isPaused;
    }
  }
}

async function saveSettings() {
  const val = document.getElementById('context-count').value;
  const paused = document.getElementById('ai-paused').checked;
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contextCount: val, isPaused: paused })
  });
  alert('Settings saved!');
}

// --- Instructions ---
let editingInstId = null;
let instructionsList = [];

async function loadInstructions() {
  const res = await fetch('/api/instructions');
  const data = await res.json();
  instructionsList = data;
  const tbody = document.querySelector('#instructions-table tbody');
  tbody.innerHTML = '';
  data.forEach(inst => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="radio" name="activeInst" ${inst.isActive ? 'checked' : ''} onchange="setActiveInstruction(${inst.id})"></td>
      <td>${inst.name}</td>
      <td><pre style="margin:0; max-height: 100px; overflow:auto; white-space: pre-wrap;">${inst.content}</pre></td>
      <td>
        <button onclick="editInstruction(${inst.id})">Edit</button>
        <button class="danger" onclick="deleteInstruction(${inst.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editInstruction(id) {
  const inst = instructionsList.find(i => i.id === id);
  if (!inst) return;
  editingInstId = id;
  document.getElementById('inst-form-title').innerText = "Edit Instruction";
  document.getElementById('inst-id').value = id;
  document.getElementById('inst-name').value = inst.name;
  document.getElementById('inst-content').value = inst.content;
  document.getElementById('inst-submit-btn').innerText = "Update";
  document.getElementById('inst-cancel-btn').style.display = "inline-block";
}

function cancelInstructionEdit() {
  editingInstId = null;
  document.getElementById('inst-form-title').innerText = "Add New Instruction";
  document.getElementById('inst-id').value = '';
  document.getElementById('inst-name').value = '';
  document.getElementById('inst-content').value = '';
  document.getElementById('inst-submit-btn').innerText = "Add";
  document.getElementById('inst-cancel-btn').style.display = "none";
}

async function saveInstruction() {
  const name = document.getElementById('inst-name').value;
  const content = document.getElementById('inst-content').value;
  if (!name || !content) return alert("Fill all fields");

  if (editingInstId) {
    await fetch(`/api/instructions/${editingInstId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    cancelInstructionEdit();
  } else {
    await fetch('/api/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    document.getElementById('inst-name').value = '';
    document.getElementById('inst-content').value = '';
  }
  loadInstructions();
}

async function setActiveInstruction(id) {
  // First fetch the specific instruction to pass its name and content 
  const res = await fetch('/api/instructions');
  const data = await res.json();
  const inst = data.find(i => i.id === id);
  
  await fetch(`/api/instructions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: inst.name, content: inst.content, isActive: true })
  });
  loadInstructions();
}

async function deleteInstruction(id) {
  if (!confirm("Delete this instruction?")) return;
  await fetch(`/api/instructions/${id}`, { method: 'DELETE' });
  loadInstructions();
}

// --- Chats ---
async function loadChats() {
  const res = await fetch('/api/chats');
  const data = await res.json();
  const container = document.getElementById('chats-container');
  container.innerHTML = '';
  
  data.forEach(chat => {
    const chatDiv = document.createElement('div');
    chatDiv.className = 'chat-log';
    
    const header = document.createElement('div');
    header.className = 'chat-header';
    header.innerText = `Chat ID: ${chat.id} | Date: ${chat.date} | Phone: ${chat.senderPhone}`;
    
    const msgContainer = document.createElement('div');
    msgContainer.className = 'chat-messages';
    
    chat.messages.forEach(msg => {
      const p = document.createElement('div');
      p.className = 'msg';
      const time = new Date(msg.timestamp).toLocaleTimeString();
      p.innerHTML = `[${time}] <strong>${msg.sender}</strong>: ${msg.body}`;
      msgContainer.appendChild(p);
    });
    
    chatDiv.appendChild(header);
    chatDiv.appendChild(msgContainer);
    container.appendChild(chatDiv);
  });
}

// --- Cron Tasks ---
function toggleScheduleInputs() {
  const type = document.getElementById('cron-type').value;
  document.getElementById('div-one-time').style.display = type === 'one-time' ? 'block' : 'none';
  document.getElementById('div-daily').style.display = type === 'daily' ? 'block' : 'none';
  document.getElementById('div-interval').style.display = type === 'interval' ? 'block' : 'none';
}

async function loadCronTasks() {
  const res = await fetch('/api/cron');
  const data = await res.json();
  const tbody = document.querySelector('#cron-table tbody');
  tbody.innerHTML = '';
  data.forEach(task => {
    const tr = document.createElement('tr');
    let scheduleStr = task.pattern;
    if (task.isOneTime) {
      scheduleStr = `One-time: ${new Date(task.executeAt).toLocaleString()}`;
    }
    tr.innerHTML = `
      <td>${task.name}</td>
      <td>${scheduleStr}</td>
      <td>${task.timezone}</td>
      <td><pre style="margin:0; max-height:60px; overflow:auto; white-space: pre-wrap;">${task.prompt}</pre></td>
      <td><button class="danger" onclick="deleteCronTask(${task.id})">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function addCronTask() {
  const name = document.getElementById('cron-name').value;
  const type = document.getElementById('cron-type').value;
  const timezone = document.getElementById('cron-tz').value;
  const prompt = document.getElementById('cron-prompt').value;
  if (!name || !prompt) return alert("Fill required fields");

  let isOneTime = false;
  let executeAt = null;
  let pattern = null;

  if (type === 'one-time') {
    isOneTime = true;
    const dt = document.getElementById('cron-datetime').value;
    if (!dt) return alert("Please select date and time");
    executeAt = new Date(dt).toISOString();
  } else if (type === 'daily') {
    const time = document.getElementById('cron-time').value;
    if (!time) return alert("Please select time");
    const [hour, minute] = time.split(':');
    pattern = `${minute} ${hour} * * *`;
  } else if (type === 'interval') {
    const val = document.getElementById('cron-interval-val').value;
    const unit = document.getElementById('cron-interval-unit').value;
    if (!val) return alert("Please specify interval value");
    if (unit === 'minutes') {
      pattern = `*/${val} * * * *`;
    } else {
      pattern = `0 */${val} * * *`;
    }
  }
  
  await fetch('/api/cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pattern, timezone, prompt, isOneTime, executeAt })
  });
  
  document.getElementById('cron-name').value = '';
  document.getElementById('cron-prompt').value = '';
  // reset interval fields
  document.getElementById('cron-interval-val').value = '';
  loadCronTasks();
}

async function deleteCronTask(id) {
  if (!confirm("Delete this cron task?")) return;
  await fetch(`/api/cron/${id}`, { method: 'DELETE' });
  loadCronTasks();
}

// Init
showSection('instructions');
