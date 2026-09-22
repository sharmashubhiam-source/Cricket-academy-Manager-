const $ = x => document.getElementById(x);
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

let ME = null;
let currentMonth = new Date().toISOString().slice(0, 7);

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: {'Content-Type': 'application/json'},
    ...opt
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

async function login() {
  const err = $('err');
  err.textContent = 'Logging in...';
  try {
    const d = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('u').value.trim(),
        password: $('p').value
      })
    });
    ME = d;
    err.textContent = '';
    renderShell();
    await loadAll();
  } catch (e) {
    err.textContent = e.message || 'Login failed';
  }
}

async function logout() {
  try { await api('/api/logout', {method:'POST'}); } catch {}
  location.reload();
}

async function start() {
  try {
    ME = await api('/api/me');
    renderShell();
    await loadAll();
  } catch {}
}

function renderShell() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent =
    'Logged in: ' + ME.username + ' (' + (ME.role === 'admin' ? 'Admin' : 'Staff') + ')';

  const items = ME.role === 'admin'
    ? [['dash','Dashboard'],['students','Students'],['fees','Fees & Income'],['reminders','Fee Reminders'],['staff','Staff'],['staffatt','Staff Attendance']]
    : [['dash','Dashboard'],['students','Students'],['staffatt','My Attendance']];

  $('nav').innerHTML = items.map((x,i) =>
    `<button type="button" data-p="${x[0]}" class="${i===0?'on':''}">${x[1]}</button>`
  ).join('');

  buildPages();
}

function showPage(page) {
  document.querySelectorAll('#nav button').forEach(x => x.classList.remove('on'));
  const navButton = document.querySelector(`#nav button[data-p="${page}"]`);
  if (navButton) navButton.classList.add('on');
  document.querySelectorAll('.page').forEach(x => x.classList.remove('on'));
  const section = $(page);
  if (section) section.classList.add('on');
}

function buildPages() {
  if (ME.role === 'admin') {
    $('dash').innerHTML = `
      <div class="toolbar"><div>
        <label>Financial Month</label>
        <input id="dashMonth" type="month" value="${currentMonth}">
      </div></div>
      <div class="grid">
        <div class="card">Total Students<div id="total" class="stat">0</div></div>
        <div class="card">Active Students<div id="active" class="stat">0</div></div>
        <div class="card">Month Due<div id="monthDue" class="stat">₹0</div></div>
        <div class="card">Month Collected<div id="collected" class="stat">₹0</div></div>
        <div class="card">Month Pending<div id="pending" class="stat">₹0</div></div>
      </div>
      <div class="card"><b>Admin only</b>
        <p class="muted">Income, collection, pending fees and financial reports are visible only to Admin.</p>
        <span class="badge">Active Staff: <b id="staffcount">0</b></span>
      </div>`;

    $('students').innerHTML = `
      <div class="card"><h3>Add Student</h3>
        <input id="sid" placeholder="Student ID"><input id="sname" placeholder="Student name">
        <input id="parent" placeholder="Parent name"><input id="mobile" placeholder="Mobile">
        <input id="batch" placeholder="Batch"><input id="fee" type="number" placeholder="Monthly fee">
        <button type="button" data-action="addStudent">Add Student</button>
      </div>
      <div class="card"><h3>Students</h3><div style="overflow:auto">
        <table><thead><tr><th>ID</th><th>Name</th><th>Parent</th><th>Mobile</th><th>Batch</th><th>Monthly Fee</th><th></th></tr></thead>
        <tbody id="studentRows"></tbody></table>
      </div></div>`;

    $('fees').innerHTML = `
      <div class="card"><h3>💰 Record Monthly Fee</h3>
        <div class="notice">Only Admin can view or enter fee/income data.</div>
        <select id="fs"></select><input id="month" type="month" value="${currentMonth}">
        <input id="due" type="number" placeholder="Due amount"><input id="paid" type="number" placeholder="Paid amount">
        <input id="dueDate" type="date"><input id="paymentDate" type="date">
        <input id="feeRemarks" placeholder="Remarks">
        <button type="button" data-action="addFee">Save Fee</button>
      </div>
      <div class="card"><h3>Month-wise Fee Records</h3><div style="overflow:auto">
        <table><thead><tr><th>Month</th><th>Student</th><th>Due</th><th>Paid</th><th>Pending</th><th>Due Date</th></tr></thead>
        <tbody id="feeRows"></tbody></table>
      </div></div>`;

    $('reminders').innerHTML = `
      <div class="card"><h3>📲 Fee Reminder</h3>
        <input id="rdate" type="date"><button type="button" data-action="reminders">Show Pending</button>
        <div style="overflow:auto"><table><thead><tr><th>Month</th><th>Student</th><th>Parent</th><th>Mobile</th><th>Pending</th><th></th></tr></thead>
        <tbody id="rem"></tbody></table></div>
      </div>`;

    $('staff').innerHTML = `
      <div class="card"><h3>Add Staff Login</h3>
        <p class="muted">Admin creates the staff account here. Staff will not get access to academy income or fee totals.</p>
        <input id="stname" placeholder="Staff name"><input id="stmobile" placeholder="Mobile">
        <input id="strole" placeholder="Role (Coach/Umpire/Office)"><input id="stjoin" type="date">
        <input id="stuser" placeholder="Login username"><input id="stpass" type="password" placeholder="Login password (min 8 chars)">
        <button type="button" data-action="addStaff">Create Staff</button>
      </div>
      <div class="card"><h3>Staff List</h3><div style="overflow:auto">
        <table><thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Joining</th><th>Status</th><th>Login</th><th></th></tr></thead>
        <tbody id="staffRows"></tbody></table>
      </div></div>`;

    $('staffatt').innerHTML = `
      <div class="card"><h3>👥 Staff Attendance</h3>
        <input id="attdate" type="date"><select id="attstaff"></select>
        <select id="attstatus"><option>Present</option><option>Absent</option><option>Leave</option><option>Half Day</option></select>
        <input id="checkin" type="time"><input id="checkout" type="time"><input id="attremarks" placeholder="Remarks">
        <button type="button" data-action="markStaffAttendance">Save / Update Attendance</button>
      </div>
      <div class="card"><h3>Attendance Report</h3>
        <input id="reportdate" type="date"><button type="button" data-action="loadAttendance">Show Date</button>
        <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Staff</th><th>Role</th><th>Status</th><th>In</th><th>Out</th><th>Remarks</th></tr></thead>
        <tbody id="attRows"></tbody></table></div>
      </div>`;
  } else {
    $('dash').innerHTML = `
      <div class="card"><h2>Staff Dashboard</h2>
        <div class="notice">🔒 Financial information is restricted to Admin.</div>
        <div class="grid">
          <div class="card">Total Students<div id="total" class="stat">0</div></div>
          <div class="card">Active Students<div id="active" class="stat">0</div></div>
        </div>
        <p class="muted">You can check whether a student's payment is Paid / Pending / Not Recorded. Academy income and total pending amount are hidden.</p>
      </div>`;

    $('students').innerHTML = `
      <div class="card"><h3>Student Payment Status</h3>
        <label>Month</label><input id="staffMonth" type="month" value="${currentMonth}">
        <div style="overflow:auto"><table><thead><tr><th>ID</th><th>Student</th><th>Batch</th><th>Payment Status</th><th>Pending</th></tr></thead>
        <tbody id="studentRows"></tbody></table></div>
      </div>`;

    $('staffatt').innerHTML = `
      <div class="card"><h3>My Attendance</h3>
        <input id="attdate" type="date"><select id="attstatus"><option>Present</option><option>Absent</option><option>Leave</option><option>Half Day</option></select>
        <input id="checkin" type="time"><input id="checkout" type="time"><input id="attremarks" placeholder="Remarks">
        <button type="button" data-action="markMyAttendance">Save Attendance</button>
      </div>
      <div class="card"><h3>My Attendance History</h3><div style="overflow:auto">
        <table><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Remarks</th></tr></thead>
        <tbody id="attRows"></tbody></table>
      </div></div>`;
  }
}

async function loadAll() {
  await Promise.all([
    dash(),
    students(),
    ME.role === 'admin' ? fees() : Promise.resolve(),
    ME.role === 'admin' ? staff() : Promise.resolve(),
    loadAttendance()
  ]);
}

async function dash() {
  const d = await api('/api/dashboard?month=' + encodeURIComponent(currentMonth));
  $('total').textContent = d.total;
  $('active').textContent = d.active;
  if (ME.role === 'admin') {
    $('monthDue').textContent = money(d.due);
    $('collected').textContent = money(d.collected);
    $('pending').textContent = money(d.pending);
    $('staffcount').textContent = d.staff;
  }
}

async function students() {
  const s = await api('/api/students?month=' + encodeURIComponent(currentMonth));
  if (ME.role === 'admin') {
    $('studentRows').innerHTML = s.map(x =>
      `<tr><td>${esc(x.id)}</td><td>${esc(x.name)}</td><td>${esc(x.parent||'')}</td><td>${esc(x.mobile||'')}</td><td>${esc(x.batch||'')}</td><td>${money(x.monthly_fee)}</td><td><button type="button" class="danger" data-action="delStudent" data-id="${encodeURIComponent(x.id)}">Delete</button></td></tr>`
    ).join('') || '<tr><td colspan=7>No students</td></tr>';

    $('fs').innerHTML = s.map(x =>
      `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.id)})</option>`
    ).join('');
  } else {
    $('studentRows').innerHTML = s.map(x =>
      `<tr><td>${esc(x.id)}</td><td>${esc(x.name)}</td><td>${esc(x.batch||'')}</td><td><span class="badge ${x.paymentStatus==='Paid'?'ok':x.paymentStatus==='Pending'?'pending':'warning'}">${x.paymentStatus}</span></td><td>${x.pending?money(x.pending):'—'}</td></tr>`
    ).join('') || '<tr><td colspan=5>No students</td></tr>';
  }
}

async function addStudent() {
  await api('/api/students', {method:'POST', body:JSON.stringify({
    id:$('sid').value, name:$('sname').value, parent:$('parent').value,
    mobile:$('mobile').value, batch:$('batch').value, monthly_fee:$('fee').value
  })});
  await loadAll();
}

async function delStudent(id) {
  if (confirm('Delete student and all fee records?')) {
    await api('/api/students/' + decodeURIComponent(id), {method:'DELETE'});
    await loadAll();
  }
}

async function fees() {
  const f = await api('/api/fees');
  $('feeRows').innerHTML = f.map(x =>
    `<tr><td>${esc(x.month||'')}</td><td>${esc(x.name)}</td><td>${money(x.due_amount)}</td><td>${money(x.paid_amount)}</td><td>${money(Math.max(0,x.due_amount-x.paid_amount))}</td><td>${esc(x.due_date||'')}</td></tr>`
  ).join('') || '<tr><td colspan=6>No fee records</td></tr>';
}

async function addFee() {
  await api('/api/fees', {method:'POST', body:JSON.stringify({
    student_id:$('fs').value, month:$('month').value, due_amount:$('due').value,
    paid_amount:$('paid').value, due_date:$('dueDate').value,
    payment_date:$('paymentDate').value, remarks:$('feeRemarks').value
  })});
  currentMonth = $('month').value;
  await loadAll();
  alert('Fee saved');
}

async function reminders() {
  const r = await api('/api/reminders?date=' + encodeURIComponent($('rdate').value));
  $('rem').innerHTML = r.map(x => {
    let ph = String(x.mobile||'').replace(/\D/g,'');
    if (ph.length === 10) ph = '91' + ph;
    const m = `Namaste ${x.parent||'Parent'}, ${x.name} ki ${x.month||''} academy fee ₹${Number(x.pending_amount).toLocaleString('en-IN')} pending hai. Kripya fee jama kar dein.\nDhanyavaad.`;
    return `<tr><td>${esc(x.month||'')}</td><td>${esc(x.name)}</td><td>${esc(x.parent||'')}</td><td>${esc(x.mobile||'')}</td><td>${money(x.pending_amount)}</td><td><a class="wa" target="_blank" href="https://wa.me/${ph}?text=${encodeURIComponent(m)}">Open WhatsApp</a></td></tr>`;
  }).join('') || '<tr><td colspan=6>No pending fees</td></tr>';
}

async function staff() {
  const s = await api('/api/staff');
  $('staffRows').innerHTML = s.map(x =>
    `<tr><td>${esc(x.name)}</td><td>${esc(x.mobile||'')}</td><td>${esc(x.role||'')}</td><td>${esc(x.joining_date||'')}</td><td>${esc(x.status)}</td><td>${x.username?esc(x.username):'—'}</td><td><button type="button" class="danger" data-action="delStaff" data-id="${x.id}">Delete</button></td></tr>`
  ).join('') || '<tr><td colspan=7>No staff</td></tr>';

  $('attstaff').innerHTML = s.filter(x => x.status === 'Active').map(x =>
    `<option value="${x.id}">${esc(x.name)} (${esc(x.role||'Staff')})</option>`
  ).join('');
}

async function addStaff() {
  await api('/api/staff', {method:'POST', body:JSON.stringify({
    name:$('stname').value, mobile:$('stmobile').value, role:$('strole').value,
    joining_date:$('stjoin').value, username:$('stuser').value, password:$('stpass').value
  })});
  await staff(); await dash(); alert('Staff account created');
}

async function delStaff(id) {
  if (confirm('Delete staff, login and attendance records?')) {
    await api('/api/staff/' + id, {method:'DELETE'});
    await staff(); await dash(); await loadAttendance();
  }
}

async function markStaffAttendance() {
  await api('/api/staff-attendance', {method:'POST', body:JSON.stringify({
    staff_id:$('attstaff').value, date:$('attdate').value, status:$('attstatus').value,
    check_in:$('checkin').value, check_out:$('checkout').value, remarks:$('attremarks').value
  })});
  await loadAttendance(); alert('Attendance saved');
}

async function markMyAttendance() {
  await api('/api/staff-attendance', {method:'POST', body:JSON.stringify({
    staff_id:ME.staffId, date:$('attdate').value, status:$('attstatus').value,
    check_in:$('checkin').value, check_out:$('checkout').value, remarks:$('attremarks').value
  })});
  await loadAttendance(); alert('Attendance saved');
}

async function loadAttendance() {
  const q = $('reportdate')?.value || '';
  const r = await api('/api/staff-attendance' + (q ? '?date=' + encodeURIComponent(q) : ''));
  if (ME.role === 'admin') {
    $('attRows').innerHTML = r.map(x =>
      `<tr><td>${esc(x.date)}</td><td>${esc(x.name)}</td><td>${esc(x.role||'')}</td><td>${esc(x.status)}</td><td>${esc(x.check_in||'')}</td><td>${esc(x.check_out||'')}</td><td>${esc(x.remarks||'')}</td></tr>`
    ).join('') || '<tr><td colspan=7>No attendance records</td></tr>';
  } else {
    $('attRows').innerHTML = r.map(x =>
      `<tr><td>${esc(x.date)}</td><td>${esc(x.status)}</td><td>${esc(x.check_in||'')}</td><td>${esc(x.check_out||'')}</td><td>${esc(x.remarks||'')}</td></tr>`
    ).join('') || '<tr><td colspan=5>No attendance records</td></tr>';
  }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])
  );
}

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('#nav button[data-p]');
  if (nav) { showPage(nav.dataset.p); return; }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  try {
    switch (actionEl.dataset.action) {
      case 'addStudent': await addStudent(); break;
      case 'delStudent': await delStudent(actionEl.dataset.id); break;
      case 'addFee': await addFee(); break;
      case 'reminders': await reminders(); break;
      case 'addStaff': await addStaff(); break;
      case 'delStaff': await delStaff(actionEl.dataset.id); break;
      case 'markStaffAttendance': await markStaffAttendance(); break;
      case 'markMyAttendance': await markMyAttendance(); break;
      case 'loadAttendance': await loadAttendance(); break;
    }
  } catch (e2) {
    alert(e2.message || 'Request failed');
  }
});

$('loginBtn').addEventListener('click', login);
$('logoutBtn').addEventListener('click', logout);

$('p').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

document.addEventListener('change', e => {
  if (e.target.id === 'dashMonth' || e.target.id === 'staffMonth') {
    currentMonth = e.target.value;
    dash();
    students();
  }
});

start();
