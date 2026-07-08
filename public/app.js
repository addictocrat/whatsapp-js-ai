// Tab switching
function showSection(id) {
  document.querySelectorAll('section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'instructions') loadInstructions();
  if (id === 'cron') loadCronTasks();
  if (id === 'phones') loadPhones();
  if (id === 'youtube') loadYoutubeChannels();
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
  
  // Also populate the phone instructions dropdown
  const phoneInstSelect = document.getElementById('phone-instruction');
  if (phoneInstSelect) {
    phoneInstSelect.innerHTML = '<option value="">Default Instruction Setup</option>';
    data.forEach(inst => {
      const opt = document.createElement('option');
      opt.value = inst.id;
      opt.innerText = inst.name;
      phoneInstSelect.appendChild(opt);
    });
  }

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

// --- Chat History Modal ---
async function showChatHistory(phoneNumber) {
  document.getElementById('history-modal-title').innerText = `Chat History for ${phoneNumber}`;
  const container = document.getElementById('history-modal-chats');
  container.innerHTML = '<p>Loading history...</p>';
  document.getElementById('history-modal').style.display = 'block';

  try {
    const res = await fetch(`/api/chats?phone=${encodeURIComponent(phoneNumber)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<p style="padding: 10px;">No chat history found for this phone number.</p>';
      return;
    }

    data.forEach(chat => {
      const chatDiv = document.createElement('div');
      chatDiv.className = 'chat-log';
      
      const header = document.createElement('div');
      header.className = 'chat-header';
      header.innerText = `Date: ${chat.date}`;
      
      const msgContainer = document.createElement('div');
      msgContainer.className = 'chat-messages';
      
      chat.messages.forEach(msg => {
        const p = document.createElement('div');
        p.className = 'msg';
        const time = new Date(msg.timestamp).toLocaleTimeString();
        p.innerHTML = `[${time}] <strong>${msg.sender.toUpperCase()}</strong>: ${msg.body}`;
        msgContainer.appendChild(p);
      });
      
      chatDiv.appendChild(header);
      chatDiv.appendChild(msgContainer);
      container.appendChild(chatDiv);
    });
  } catch (err) {
    container.innerHTML = '<p style="padding: 10px; color: red;">Error loading chat history.</p>';
    console.error(err);
  }
}

function closeHistoryModal() {
  document.getElementById('history-modal').style.display = 'none';
}

// Close modal when clicking outside of it
window.addEventListener('click', (event) => {
  const modal = document.getElementById('history-modal');
  if (event.target === modal) {
    closeHistoryModal();
  }
});

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
      <td>${task.targetPhones || '<em>All Allowed</em>'}</td>
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
  const targetPhones = document.getElementById('cron-target-phones').value || null;
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
    body: JSON.stringify({ name, pattern, timezone, prompt, isOneTime, executeAt, targetPhones })
  });
  
  document.getElementById('cron-name').value = '';
  document.getElementById('cron-target-phones').value = '';
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

// --- Phones ---
let editingPhoneId = null;
let phonesList = [];

async function loadPhones() {
  const res = await fetch('/api/phones');
  const data = await res.json();
  phonesList = data;
  const tbody = document.querySelector('#phones-table tbody');
  tbody.innerHTML = '';
  data.forEach(phone => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${phone.number}</td>
      <td>${phone.isEnabled ? '✅' : '❌'}</td>
      <td>${phone.responseDelay}s</td>
      <td>${phone.maxDailyMessages}</td>
      <td>${phone.contextCount}</td>
      <td>${phone.modelName || '<em>Default</em>'}</td>
      <td>${phone.instruction ? phone.instruction.name : '<em>Default Setup</em>'}</td>
      <td>${phone.allowGroupChats ? '✅ Yes' : '❌ No'}</td>
      <td>
        <button onclick="showChatHistory('${phone.number}')">HISTORY</button>
        <button onclick="editPhone(${phone.id})">Edit</button>
        <button class="danger" onclick="deletePhone(${phone.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editPhone(id) {
  const phone = phonesList.find(p => p.id === id);
  if (!phone) return;
  editingPhoneId = id;
  document.getElementById('phone-form-title').innerText = "Edit Phone";
  document.getElementById('phone-id').value = id;
  document.getElementById('phone-number').value = phone.number;
  document.getElementById('phone-model').value = phone.modelName || '';
  document.getElementById('phone-instruction').value = phone.instructionId || '';
  document.getElementById('phone-group-chats').checked = phone.allowGroupChats;
  document.getElementById('phone-is-enabled').checked = phone.isEnabled !== false;
  document.getElementById('phone-delay').value = phone.responseDelay || 0;
  document.getElementById('phone-limit').value = phone.maxDailyMessages !== undefined ? phone.maxDailyMessages : 40;
  document.getElementById('phone-context-count').value = phone.contextCount !== undefined ? phone.contextCount : 8;
  document.getElementById('phone-submit-btn').innerText = "Update Phone";
  document.getElementById('phone-cancel-btn').style.display = "inline-block";
}

function cancelPhoneEdit() {
  editingPhoneId = null;
  document.getElementById('phone-form-title').innerText = "Add New Phone";
  document.getElementById('phone-id').value = '';
  document.getElementById('phone-number').value = '';
  document.getElementById('phone-model').value = '';
  document.getElementById('phone-instruction').value = '';
  document.getElementById('phone-group-chats').checked = false;
  document.getElementById('phone-is-enabled').checked = true;
  document.getElementById('phone-delay').value = 0;
  document.getElementById('phone-limit').value = 40;
  document.getElementById('phone-context-count').value = 8;
  document.getElementById('phone-submit-btn').innerText = "Add Phone";
  document.getElementById('phone-cancel-btn').style.display = "none";
}

async function savePhone() {
  const number = document.getElementById('phone-number').value;
  const modelName = document.getElementById('phone-model').value || null;
  const instructionId = document.getElementById('phone-instruction').value || null;
  const allowGroupChats = document.getElementById('phone-group-chats').checked;
  const isEnabled = document.getElementById('phone-is-enabled').checked;
  const responseDelay = parseInt(document.getElementById('phone-delay').value) || 0;
  const maxDailyMessages = parseInt(document.getElementById('phone-limit').value) || 40;
  const contextCountVal = document.getElementById('phone-context-count').value;
  const contextCount = contextCountVal !== "" ? (parseInt(contextCountVal) || 0) : 8;
  if (!number) return alert("Phone number is required");

  if (editingPhoneId) {
    await fetch(`/api/phones/${editingPhoneId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, modelName, instructionId, allowGroupChats, isEnabled, responseDelay, maxDailyMessages, contextCount })
    });
    cancelPhoneEdit();
  } else {
    const res = await fetch('/api/phones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, modelName, instructionId, allowGroupChats, isEnabled, responseDelay, maxDailyMessages, contextCount })
    });
    if (!res.ok) {
      const err = await res.json();
      return alert(err.error || 'Error saving phone');
    }
    cancelPhoneEdit();
  }
  loadPhones();
}

async function deletePhone(id) {
  if (!confirm("Delete this phone number?")) return;
  await fetch(`/api/phones/${id}`, { method: 'DELETE' });
  loadPhones();
}

// --- YouTube Tracker ---
let editingYtId = null;
let ytChannelsList = [];

async function loadYoutubeChannels() {
  const res = await fetch('/api/youtube');
  const data = await res.json();
  ytChannelsList = data;
  const tbody = document.querySelector('#youtube-table tbody');
  tbody.innerHTML = '';
  data.forEach(channel => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${channel.name}</td>
      <td>${channel.channelId}</td>
      <td>${channel.checkIntervalHours}</td>
      <td>${channel.targetPhones || '<em>All Allowed</em>'}</td>
      <td><pre style="margin:0; max-height:60px; overflow:auto; white-space: pre-wrap;">${channel.resumePrompt}</pre></td>
      <td>
        <button onclick="editYoutubeChannel(${channel.id})">Edit</button>
        <button onclick="triggerYoutubeCheck(${channel.id}, this)">Trigger</button>
        <button onclick="triggerLastVideo(${channel.id}, this)">Trigger Last Video</button>
        <button class="danger" onclick="deleteYoutubeChannel(${channel.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editYoutubeChannel(id) {
  const channel = ytChannelsList.find(c => c.id === id);
  if (!channel) return;
  editingYtId = id;
  document.getElementById('yt-form-title').innerText = "Edit Channel";
  document.getElementById('yt-id').value = id;
  document.getElementById('yt-channel-id').value = channel.channelId;
  document.getElementById('yt-name').value = channel.name;
  document.getElementById('yt-interval').value = channel.checkIntervalHours;
  document.getElementById('yt-target-phones').value = channel.targetPhones || '';
  document.getElementById('yt-prompt').value = channel.resumePrompt;
  document.getElementById('yt-submit-btn').innerText = "Update Channel";
  document.getElementById('yt-cancel-btn').style.display = "inline-block";
}

function cancelYoutubeEdit() {
  editingYtId = null;
  document.getElementById('yt-form-title').innerText = "Add New Channel";
  document.getElementById('yt-id').value = '';
  document.getElementById('yt-channel-id').value = '';
  document.getElementById('yt-name').value = '';
  document.getElementById('yt-interval').value = '';
  document.getElementById('yt-target-phones').value = '';
  document.getElementById('yt-prompt').value = '';
  document.getElementById('yt-submit-btn').innerText = "Add Channel";
  document.getElementById('yt-cancel-btn').style.display = "none";
}

async function saveYoutubeChannel() {
  const channelId = document.getElementById('yt-channel-id').value;
  const name = document.getElementById('yt-name').value;
  const checkIntervalHours = document.getElementById('yt-interval').value;
  const targetPhones = document.getElementById('yt-target-phones').value || null;
  const resumePrompt = document.getElementById('yt-prompt').value;
  
  if (!channelId || !name || !checkIntervalHours || !resumePrompt) {
    return alert("Fill all required fields");
  }

  if (editingYtId) {
    await fetch(`/api/youtube/${editingYtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, name, checkIntervalHours, targetPhones, resumePrompt })
    });
    cancelYoutubeEdit();
  } else {
    await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, name, checkIntervalHours, targetPhones, resumePrompt })
    });
    cancelYoutubeEdit();
  }
  loadYoutubeChannels();
}

async function deleteYoutubeChannel(id) {
  if (!confirm("Delete this YouTube Channel?")) return;
  await fetch(`/api/youtube/${id}`, { method: 'DELETE' });
  loadYoutubeChannels();
}

async function triggerYoutubeCheck(id, btn) {
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Checking...";
  try {
    const res = await fetch(`/api/youtube/${id}/trigger`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to trigger check");
    }
    if (data.newVideo) {
      alert(`New video found!\nVideo ID: ${data.videoId}\nSummary sent to: ${data.targetNumbers.join(', ')}`);
    } else {
      alert(`No new video found. (${data.reason || 'up to date'})`);
    }
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

async function triggerLastVideo(id, btn) {
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Summarizing...";
  try {
    const res = await fetch(`/api/youtube/${id}/trigger-last`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to trigger last video check");
    }
    if (data.newVideo) {
      alert(`Success!\nVideo ID: ${data.videoId}\nSummary sent to: ${data.targetNumbers.join(', ')}`);
    } else {
      alert(`Failed to send summary. (${data.reason || 'No video found'})`);
    }
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

// Init
showSection('instructions');
