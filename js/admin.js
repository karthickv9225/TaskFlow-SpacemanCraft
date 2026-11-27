/**
 * Admin Workspace Controller (TaskFlow UI — Cloud Firestore + Firebase Auth):
 * Real-time Dashboard KPIs + Employee Progress Cards, Employee Management Cards,
 * Task Management Table, Notifications, Task Details, Profile, and Settings.
 */
import { UI } from './common.js';
import { API } from './api.js';
import { Auth } from './auth.js';
import { Tasks } from './tasks.js';

let session = null;
let currentView = 'dashboard';
let currentTaskId = null;
let closeMobileDrawer = null;

let cachedEmployees = [];
let cachedTasks = [];
let cachedNotifications = [];
let dataReady = { employees: false, tasks: false, notifications: false };

let activeViewCleanup = null;
const streamUnsubscribers = [];

let taskFilters = { search: '', status: 'all', priority: 'all', assignee: 'all', deadline: '' };
let employeeFilters = { search: '', status: 'all', department: 'all' };

function syncHeaderAndNav() {
  const counts = API.computeDashboardCounts(cachedEmployees, cachedTasks, cachedNotifications);

  const notifBadge = document.getElementById('nav-notif-count');
  if (notifBadge) notifBadge.textContent = String(counts.unreadNotifications);

  const tasksBadge = document.getElementById('nav-tasks-count');
  if (tasksBadge) tasksBadge.textContent = String(counts.totalTasks);

  const bellBadge = document.getElementById('topbar-bell-badge');
  if (bellBadge) bellBadge.textContent = String(counts.unreadNotifications);

  if (session) {
    const nameEls = document.querySelectorAll('[data-user-name]');
    for (let i = 0; i < nameEls.length; i++) {
      nameEls[i].textContent = session.name;
    }
    const emailEls = document.querySelectorAll('[data-user-email]');
    for (let j = 0; j < emailEls.length; j++) {
      emailEls[j].textContent = session.email;
    }
    const avatarEl = document.getElementById('topbar-avatar');
    if (avatarEl) {
      avatarEl.textContent = UI.getInitials(session.name);
    }
  }

  const navBtns = document.querySelectorAll('.nav-item[data-view]');
  const activeNavKey = currentView === 'task-details' ? 'tasks' : currentView;
  for (let k = 0; k < navBtns.length; k++) {
    const view = navBtns[k].getAttribute('data-view');
    navBtns[k].classList.toggle('active', view === activeNavKey);
  }

  const titles = {
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    employees: 'Employee Management',
    notifications: 'Notifications',
    'task-details': 'Task Details',
    profile: 'Profile',
    settings: 'Settings'
  };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) {
    titleEl.textContent = titles[currentView] || 'Dashboard';
  }
}

function navigateTo(view, taskId) {
  currentView = view || 'dashboard';
  currentTaskId = taskId || null;

  const nextHash = '#' + currentView + (currentTaskId ? '&id=' + encodeURIComponent(currentTaskId) : '');
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }

  if (typeof closeMobileDrawer === 'function') {
    closeMobileDrawer();
  }
  renderCurrentView();
}

function parseHash() {
  const raw = (window.location.hash || '#dashboard').replace(/^#/, '');
  const parts = raw.split('&id=');
  let view = parts[0] || 'dashboard';
  const validViews = ['dashboard', 'tasks', 'employees', 'notifications', 'task-details', 'profile', 'settings'];
  if (validViews.indexOf(view) === -1) {
    view = 'dashboard';
  }
  currentView = view;
  currentTaskId = parts[1] ? decodeURIComponent(parts[1]) : null;
}

function findCachedEmployee(id) {
  for (let i = 0; i < cachedEmployees.length; i++) {
    if (cachedEmployees[i].id === id) return cachedEmployees[i];
  }
  return null;
}

function findCachedTask(id) {
  for (let i = 0; i < cachedTasks.length; i++) {
    if (cachedTasks[i].id === id) return cachedTasks[i];
  }
  return null;
}

function bindEmployeeCardEvents(scopeEl) {
  const viewBtns = scopeEl.querySelectorAll('.emp-view-btn');
  for (let v = 0; v < viewBtns.length; v++) {
    viewBtns[v].addEventListener('click', function (e) {
      const emp = findCachedEmployee(e.currentTarget.getAttribute('data-emp-id'));
      if (emp) openViewEmployeeModal(emp);
    });
  }

  const editBtns = scopeEl.querySelectorAll('.emp-edit-btn');
  for (let ed = 0; ed < editBtns.length; ed++) {
    editBtns[ed].addEventListener('click', function (e) {
      const emp = findCachedEmployee(e.currentTarget.getAttribute('data-emp-id'));
      if (emp) openEmployeeModal(emp);
    });
  }

  const toggleBtns = scopeEl.querySelectorAll('.emp-toggle-btn');
  for (let tg = 0; tg < toggleBtns.length; tg++) {
    toggleBtns[tg].addEventListener('click', function (e) {
      const emp = findCachedEmployee(e.currentTarget.getAttribute('data-emp-id'));
      if (!emp) return;
      const nextStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
      UI.confirmDialog({
        title: nextStatus === 'Inactive' ? 'Deactivate Employee' : 'Activate Employee',
        message:
          nextStatus === 'Inactive'
            ? 'Deactivate ' + emp.name + '? They will no longer be able to sign in or access tasks until reactivated.'
            : 'Reactivate ' + emp.name + ' so they can sign in again?',
        confirmLabel: nextStatus === 'Inactive' ? 'Deactivate' : 'Activate',
        confirmVariant: nextStatus === 'Inactive' ? 'danger' : 'primary',
        onConfirm: async function () {
          try {
            await API.updateEmployee(emp.id, { status: nextStatus });
            UI.showToast(emp.name + ' is now ' + nextStatus + '.', 'info');
          } catch (err) {
            UI.showToast(err.message || 'Could not update employee status.', 'error');
          }
        }
      });
    });
  }

  const delBtns = scopeEl.querySelectorAll('.emp-delete-btn');
  for (let dl = 0; dl < delBtns.length; dl++) {
    delBtns[dl].addEventListener('click', function (e) {
      const emp = findCachedEmployee(e.currentTarget.getAttribute('data-emp-id'));
      if (!emp) return;
      UI.confirmDialog({
        title: 'Delete Employee',
        message:
          'Delete ' +
          emp.name +
          ' (' +
          emp.employeeId +
          ')? Any tasks currently assigned to them will become unassigned.',
        confirmLabel: 'Delete Employee',
        confirmVariant: 'danger',
        onConfirm: async function () {
          try {
            await API.deleteEmployee(emp.id);
            UI.showToast('Employee deleted.', 'info');
          } catch (err) {
            UI.showToast(err.message || 'Could not delete employee.', 'error');
          }
        }
      });
    });
  }
}

/* ---------------- Dashboard Overview ---------------- */
function renderDashboardView(container) {
  if (!dataReady.employees || !dataReady.tasks) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml('Loading dashboard...', 'Connecting to live Cloud Firestore workspace.') +
      '</div></div>';
    return;
  }

  const counts = API.computeDashboardCounts(cachedEmployees, cachedTasks, cachedNotifications);
  const employeeProgress = API.computeEmployeeStats(cachedEmployees, cachedTasks);

  const employeeProgressHtml =
    employeeProgress.length === 0
      ? UI.emptyStateHtml(
          'No employees added yet',
          'Add employees to start tracking their progress here.'
        )
      : '<div class="employee-cards-grid">' +
        employeeProgress
          .map(function (emp) {
            return UI.renderEmployeeWorkloadCard(emp);
          })
          .join('') +
        '</div>';

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Dashboard</h1>' +
        '<p class="page-subtitle">Company-wide task overview</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-primary" id="dash-new-task-top">+ New Task</button>' +
      '</div>' +
    '</div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-indigo" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.totalEmployees || 0) + '</div><div class="kpi-label">Total Employees</div></div>' +
      '</div>' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-orange" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.totalTasks || 0) + '</div><div class="kpi-label">Total Tasks</div></div>' +
      '</div>' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-amber" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.pendingTasks || 0) + '</div><div class="kpi-label">Pending</div></div>' +
      '</div>' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-violet" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.inProgressTasks || 0) + '</div><div class="kpi-label">In Progress</div></div>' +
      '</div>' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-rose" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.blockedTasks || 0) + '</div><div class="kpi-label">Blocked</div></div>' +
      '</div>' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-green" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.completedTasks || 0) + '</div><div class="kpi-label">Completed</div></div>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-header">' +
        '<h2 class="panel-title">Employee progress</h2>' +
      '</div>' +
      '<div class="panel-body">' + employeeProgressHtml + '</div>' +
    '</div>';

  container.querySelector('#dash-new-task-top').addEventListener('click', function () {
    openTaskModal(null);
  });

  bindEmployeeCardEvents(container);
}

/* ---------------- Employee Management ---------------- */
async function openEmployeeModal(existingEmp) {
  const isEdit = Boolean(existingEmp);
  let defaultId = isEdit ? existingEmp.employeeId : 'EMP-001';
  if (!isEdit) {
    try {
      const nextRes = await API.getNextEmployeeId();
      if (nextRes && nextRes.nextEmployeeId) defaultId = nextRes.nextEmployeeId;
    } catch (_err) {
      // Fallback to EMP-001
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const passwordOrResetSlot = isEdit
    ? '<div class="form-group">' +
        '<label class="form-label">Password Recovery</label>' +
        '<button type="button" id="emp-send-reset-btn" class="btn btn-secondary" style="width:100%;">Send Password Reset Email</button>' +
      '</div>'
    : '<div class="form-group">' +
        '<label class="form-label" for="emp-password">Login Password<span class="required-mark">*</span></label>' +
        '<input type="password" id="emp-password" class="form-control" placeholder="Minimum 6 characters" required>' +
      '</div>';

  const bodyHtml =
    '<form id="employee-modal-form">' +
      '<div id="emp-form-error" class="form-error-box hidden"></div>' +
      '<div class="form-grid">' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-id">Employee ID<span class="required-mark">*</span></label>' +
          '<input type="text" id="emp-id" class="form-control mono" value="' + UI.escapeHtml(defaultId) + '" ' + (isEdit ? 'readonly' : 'required') + '>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-status">Account Status<span class="required-mark">*</span></label>' +
          '<select id="emp-status" class="form-control">' +
            '<option value="Active"' + (!isEdit || existingEmp.status === 'Active' ? ' selected' : '') + '>Active</option>' +
            '<option value="Inactive"' + (isEdit && existingEmp.status === 'Inactive' ? ' selected' : '') + '>Inactive</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-name">Full Name<span class="required-mark">*</span></label>' +
          '<input type="text" id="emp-name" class="form-control" placeholder="e.g. Jordan Rivera" value="' + UI.escapeHtml(isEdit ? existingEmp.name : '') + '" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-email">Work Email<span class="required-mark">*</span></label>' +
          '<input type="email" id="emp-email" class="form-control" placeholder="jordan@company.com" value="' + UI.escapeHtml(isEdit ? existingEmp.email : '') + '" ' + (isEdit ? 'readonly' : 'required') + '>' +
        '</div>' +
        passwordOrResetSlot +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-joining">Joining Date<span class="required-mark">*</span></label>' +
          '<input type="date" id="emp-joining" class="form-control" value="' + UI.escapeHtml(isEdit ? existingEmp.joiningDate : today) + '" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-dept">Department<span class="required-mark">*</span></label>' +
          '<input type="text" id="emp-dept" class="form-control" placeholder="e.g. Engineering" value="' + UI.escapeHtml(isEdit ? existingEmp.department : '') + '" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="emp-designation">Designation<span class="required-mark">*</span></label>' +
          '<input type="text" id="emp-designation" class="form-control" placeholder="e.g. Frontend Developer" value="' + UI.escapeHtml(isEdit ? existingEmp.designation : '') + '" required>' +
        '</div>' +
      '</div>' +
    '</form>';

  const footerHtml =
    '<button type="button" class="btn btn-secondary" id="emp-modal-cancel">Cancel</button>' +
    '<button type="submit" form="employee-modal-form" class="btn btn-primary">' + (isEdit ? 'Save Employee' : 'Add Employee') + '</button>';

  UI.openModal({
    title: isEdit ? 'Edit Employee: ' + existingEmp.employeeId : 'Add New Employee',
    bodyHtml,
    footerHtml,
    onMount: function (overlay) {
      overlay.querySelector('#emp-modal-cancel').addEventListener('click', UI.closeModal);
      const form = overlay.querySelector('#employee-modal-form');
      const errBox = overlay.querySelector('#emp-form-error');
      const submitBtn = overlay.querySelector('button[type="submit"]');

      const resetBtn = overlay.querySelector('#emp-send-reset-btn');
      if (resetBtn && isEdit) {
        resetBtn.addEventListener('click', async function () {
          resetBtn.disabled = true;
          try {
            await API.sendEmployeePasswordReset(existingEmp.email);
            UI.showToast('Password reset email sent to ' + existingEmp.email + '.', 'success');
          } catch (err) {
            UI.showToast(err.message || 'Could not send password reset email.', 'error');
          } finally {
            resetBtn.disabled = false;
          }
        });
      }

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errBox.classList.add('hidden');

        const employeeId = overlay.querySelector('#emp-id').value.trim();
        const name = overlay.querySelector('#emp-name').value.trim();
        const email = overlay.querySelector('#emp-email').value.trim().toLowerCase();
        const passEl = overlay.querySelector('#emp-password');
        const password = passEl ? passEl.value : '';
        const department = overlay.querySelector('#emp-dept').value.trim();
        const designation = overlay.querySelector('#emp-designation').value.trim();
        const joiningDate = overlay.querySelector('#emp-joining').value;
        const status = overlay.querySelector('#emp-status').value;

        function fail(msg) {
          errBox.textContent = msg;
          errBox.classList.remove('hidden');
        }

        if (!employeeId || !name || !email || !department || !designation || !joiningDate) {
          return fail('Please fill in all required fields.');
        }
        if (!UI.isValidEmail(email)) {
          return fail('Please enter a valid email address.');
        }
        if (!isEdit && (!password || password.length < 6)) {
          return fail('Password must be at least 6 characters long.');
        }

        if (submitBtn) submitBtn.disabled = true;
        try {
          if (isEdit) {
            await API.updateEmployee(existingEmp.id, {
              name,
              email,
              department,
              designation,
              joiningDate,
              status
            });
            UI.closeModal();
            UI.showToast('Employee updated successfully.', 'success');
          } else {
            await API.createEmployee({
              employeeId,
              name,
              email,
              password,
              department,
              designation,
              joiningDate,
              status
            });
            UI.closeModal();
            UI.showToast('Employee ' + name + ' added.', 'success');
          }
        } catch (err) {
          fail(err.message || 'Could not save employee record.');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  });
}

async function openViewEmployeeModal(emp) {
  let assignedTasks = cachedTasks.filter((t) => t.assignedTo === emp.id);
  try {
    const details = await API.getEmployeeDetails(emp.id);
    if (details && details.employee) emp = details.employee;
    if (details && Array.isArray(details.tasks)) assignedTasks = details.tasks;
  } catch (_err) {
    // Fallback to live cache
  }

  const taskRows =
    assignedTasks.length === 0
      ? '<p style="color:var(--text-muted); font-size:0.875rem;">No tasks currently assigned to this employee.</p>'
      : '<ul class="activity-list" style="border:1px solid var(--border-subtle); border-radius:var(--radius-md);">' +
        assignedTasks
          .map(function (t) {
            return (
              '<li class="activity-item">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
                  '<span style="font-weight:600; font-size:0.875rem;">' + UI.escapeHtml(t.title) + '</span>' +
                  UI.renderStatusBadge(t.status) +
                '</div>' +
                '<div class="activity-meta">' +
                  '<span class="mono">' + UI.escapeHtml(t.taskCode || t.id) + '</span>' +
                  '<span aria-hidden="true">&middot;</span>' +
                  '<span>Due Date: ' + UI.escapeHtml(UI.formatDate(t.dueDate)) + '</span>' +
                  '<span aria-hidden="true">&middot;</span>' +
                  '<span class="mono">' + Number(t.progress || 0) + '%</span>' +
                '</div>' +
              '</li>'
            );
          })
          .join('') +
        '</ul>';

  UI.openModal({
    title: emp.name + ' (' + emp.employeeId + ')',
    bodyHtml:
      '<div class="meta-list" style="margin-bottom: 20px;">' +
        '<div class="meta-row"><span class="meta-key">Employee ID</span><span class="meta-val mono">' + UI.escapeHtml(emp.employeeId) + '</span></div>' +
        '<div class="meta-row"><span class="meta-key">Email</span><span class="meta-val mono">' + UI.escapeHtml(emp.email) + '</span></div>' +
        '<div class="meta-row"><span class="meta-key">Department</span><span class="meta-val">' + UI.escapeHtml(emp.department) + '</span></div>' +
        '<div class="meta-row"><span class="meta-key">Designation</span><span class="meta-val">' + UI.escapeHtml(emp.designation) + '</span></div>' +
        '<div class="meta-row"><span class="meta-key">Joining Date</span><span class="meta-val mono">' + UI.escapeHtml(UI.formatDate(emp.joiningDate)) + '</span></div>' +
        '<div class="meta-row"><span class="meta-key">Account Status</span><span class="meta-val">' + UI.renderAccountBadge(emp.status) + '</span></div>' +
      '</div>' +
      '<h3 style="font-size:0.9375rem; font-weight:600; margin-bottom:10px;">Assigned Tasks (' + assignedTasks.length + ')</h3>' +
      taskRows,
    footerHtml:
      '<button type="button" class="btn btn-secondary" id="view-emp-close">Close</button>' +
      '<button type="button" class="btn btn-primary" id="view-emp-edit">Edit Employee</button>',
    onMount: function (overlay) {
      overlay.querySelector('#view-emp-close').addEventListener('click', UI.closeModal);
      overlay.querySelector('#view-emp-edit').addEventListener('click', function () {
        UI.closeModal();
        openEmployeeModal(emp);
      });
    }
  });
}

function renderEmployeesFiltered(container) {
  const allEmployees = API.computeEmployeeStats(cachedEmployees, cachedTasks);
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'emp-search-input';
  const prevCaret = wasSearchFocused ? document.activeElement.selectionStart : null;

  const departments = [];
  for (let i = 0; i < allEmployees.length; i++) {
    if (departments.indexOf(allEmployees[i].department) === -1) {
      departments.push(allEmployees[i].department);
    }
  }

  const filtered = allEmployees.filter(function (emp) {
    const q = employeeFilters.search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (emp.employeeId || '').toLowerCase().indexOf(q) !== -1 ||
      (emp.name || '').toLowerCase().indexOf(q) !== -1 ||
      (emp.email || '').toLowerCase().indexOf(q) !== -1 ||
      (emp.department || '').toLowerCase().indexOf(q) !== -1 ||
      (emp.designation || '').toLowerCase().indexOf(q) !== -1;
    const matchesStatus = employeeFilters.status === 'all' || emp.status === employeeFilters.status;
    const matchesDept = employeeFilters.department === 'all' || emp.department === employeeFilters.department;
    return matchesSearch && matchesStatus && matchesDept;
  });

  const deptOptions =
    '<option value="all">All Departments</option>' +
    departments
      .map(function (d) {
        return (
          '<option value="' +
          UI.escapeHtml(d) +
          '"' +
          (employeeFilters.department === d ? ' selected' : '') +
          '>' +
          UI.escapeHtml(d) +
          '</option>'
        );
      })
      .join('');

  let bodyContent = '';
  if (allEmployees.length === 0) {
    bodyContent =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml(
        'No employees added yet.',
        'Add employee records with login credentials so they can access their dashboard and assigned tasks.',
        '<button type="button" class="btn btn-primary" id="emp-empty-add-btn">+ Add Employee</button>'
      ) +
      '</div></div>';
  } else if (filtered.length === 0) {
    bodyContent =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml(
        'No matching employees found.',
        'Try adjusting your search query or status filters.',
        '<button type="button" class="btn btn-secondary" id="emp-clear-filters-btn">Clear Filters</button>'
      ) +
      '</div></div>';
  } else {
    bodyContent =
      '<div class="employee-cards-grid">' +
      filtered
        .map(function (emp) {
          return UI.renderEmployeeWorkloadCard(emp);
        })
        .join('') +
      '</div>';
  }

  const toolbarHtml =
    allEmployees.length > 0
      ? '<div class="panel" style="margin-bottom: 18px;">' +
          '<div class="toolbar" style="border-bottom: none;">' +
            '<div class="toolbar-search">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
              '<input type="search" id="emp-search-input" placeholder="Search by name, ID, email, or role..." value="' +
                UI.escapeHtml(employeeFilters.search) +
              '">' +
            '</div>' +
            '<div class="toolbar-filters">' +
              '<select id="emp-filter-status" class="filter-select" aria-label="Filter by account status">' +
                '<option value="all"' + (employeeFilters.status === 'all' ? ' selected' : '') + '>All Statuses</option>' +
                '<option value="Active"' + (employeeFilters.status === 'Active' ? ' selected' : '') + '>Active</option>' +
                '<option value="Inactive"' + (employeeFilters.status === 'Inactive' ? ' selected' : '') + '>Inactive</option>' +
              '</select>' +
              '<select id="emp-filter-dept" class="filter-select" aria-label="Filter by department">' +
                deptOptions +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>'
      : '';

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Employee Management</h1>' +
        '<p class="page-subtitle">Team members and their workload</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-primary" id="emp-add-btn">+ Add Employee</button>' +
      '</div>' +
    '</div>' +
    toolbarHtml +
    bodyContent;

  container.querySelector('#emp-add-btn').addEventListener('click', function () {
    openEmployeeModal(null);
  });

  const emptyAdd = container.querySelector('#emp-empty-add-btn');
  if (emptyAdd) {
    emptyAdd.addEventListener('click', function () {
      openEmployeeModal(null);
    });
  }

  const clearFiltersBtn = container.querySelector('#emp-clear-filters-btn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', function () {
      employeeFilters = { search: '', status: 'all', department: 'all' };
      renderEmployeesFiltered(container);
    });
  }

  const searchInput = container.querySelector('#emp-search-input');
  if (searchInput) {
    if (wasSearchFocused) {
      searchInput.focus();
      if (prevCaret !== null) searchInput.setSelectionRange(prevCaret, prevCaret);
    }
    searchInput.addEventListener('input', function () {
      employeeFilters.search = searchInput.value;
      const caretPos = searchInput.selectionStart;
      renderEmployeesFiltered(container);
      const reInput = container.querySelector('#emp-search-input');
      if (reInput) {
        reInput.focus();
        reInput.setSelectionRange(caretPos, caretPos);
      }
    });
  }

  const statusFilter = container.querySelector('#emp-filter-status');
  if (statusFilter) {
    statusFilter.addEventListener('change', function (e) {
      employeeFilters.status = e.target.value;
      renderEmployeesFiltered(container);
    });
  }

  const deptFilter = container.querySelector('#emp-filter-dept');
  if (deptFilter) {
    deptFilter.addEventListener('change', function (e) {
      employeeFilters.department = e.target.value;
      renderEmployeesFiltered(container);
    });
  }

  bindEmployeeCardEvents(container);
}

function renderEmployeesView(container) {
  if (!dataReady.employees) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml('Loading employees...', 'Fetching employee directory from Cloud Firestore.') +
      '</div></div>';
    return;
  }
  renderEmployeesFiltered(container);
}

/* ---------------- Task Management ---------------- */
async function openTaskModal(existingTask) {
  const isEdit = Boolean(existingTask);
  const employees = cachedEmployees;

  let defaultCode = isEdit ? existingTask.taskCode : 'TSK-001';
  if (!isEdit) {
    try {
      const codeRes = await API.getNextTaskCode();
      if (codeRes && codeRes.nextTaskCode) defaultCode = codeRes.nextTaskCode;
    } catch (_err) {
      // Fallback to TSK-001
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeEmployees = employees.filter(function (e) {
    return e.status === 'Active';
  });
  let assigneeOptions = '<option value="">-- Unassigned --</option>';
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const isSelected = isEdit && existingTask.assignedTo === emp.id;
    if (emp.status === 'Active' || isSelected) {
      const inactiveNote = emp.status === 'Inactive' ? ' [Inactive]' : '';
      assigneeOptions +=
        '<option value="' +
        UI.escapeHtml(emp.id) +
        '"' +
        (isSelected ? ' selected' : '') +
        '>' +
        UI.escapeHtml(emp.name + ' (' + emp.employeeId + ' - ' + emp.department + ')' + inactiveNote) +
        '</option>';
    }
  }

  const noEmpNotice =
    activeEmployees.length === 0
      ? '<div class="form-info-box">No active employees added yet. You can still create this task now and assign it after adding employees.</div>'
      : '';

  const priorityOptions = Tasks.TASK_PRIORITIES.map(function (p) {
    const sel = isEdit ? existingTask.priority === p : p === 'Medium';
    return '<option value="' + UI.escapeHtml(p) + '"' + (sel ? ' selected' : '') + '>' + UI.escapeHtml(p) + '</option>';
  }).join('');

  const statusOptions = Tasks.TASK_STATUSES.map(function (s) {
    const sel = isEdit ? existingTask.status === s : s === 'To Do';
    return '<option value="' + UI.escapeHtml(s) + '"' + (sel ? ' selected' : '') + '>' + UI.escapeHtml(s) + '</option>';
  }).join('');

  const bodyHtml =
    '<form id="task-modal-form">' +
      noEmpNotice +
      '<div id="task-form-error" class="form-error-box hidden"></div>' +
      '<div class="form-grid">' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-id">Task ID<span class="required-mark">*</span></label>' +
          '<input type="text" id="task-id" class="form-control mono" value="' + UI.escapeHtml(defaultCode) + '" ' + (isEdit ? 'readonly' : 'required') + '>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-assignee">Assigned Employee</label>' +
          '<select id="task-assignee" class="form-control">' + assigneeOptions + '</select>' +
        '</div>' +
        '<div class="form-group full-width">' +
          '<label class="form-label" for="task-title">Task Title<span class="required-mark">*</span></label>' +
          '<input type="text" id="task-title" class="form-control" placeholder="e.g. Prepare Q4 financial reconciliation report" value="' + UI.escapeHtml(isEdit ? existingTask.title : '') + '" required>' +
        '</div>' +
        '<div class="form-group full-width">' +
          '<label class="form-label" for="task-desc">Description<span class="required-mark">*</span></label>' +
          '<textarea id="task-desc" class="form-control" placeholder="Provide clear instructions, deliverables, and context..." required>' + UI.escapeHtml(isEdit ? existingTask.description : '') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-priority">Priority<span class="required-mark">*</span></label>' +
          '<select id="task-priority" class="form-control">' + priorityOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-status">Status<span class="required-mark">*</span></label>' +
          '<select id="task-status" class="form-control">' + statusOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-start">Start Date<span class="required-mark">*</span></label>' +
          '<input type="date" id="task-start" class="form-control" value="' + UI.escapeHtml(isEdit ? existingTask.startDate : today) + '" required>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="task-deadline">Due Date<span class="required-mark">*</span></label>' +
          '<input type="date" id="task-deadline" class="form-control" value="' + UI.escapeHtml(isEdit ? existingTask.dueDate : today) + '" required>' +
        '</div>' +
        '<div class="form-group full-width">' +
          '<label class="form-label" for="task-progress-num">Progress Percentage</label>' +
          '<div class="range-pair">' +
            '<input type="range" id="task-progress-range" min="0" max="100" value="' + (isEdit ? Number(existingTask.progress || 0) : 0) + '" aria-label="Task progress slider">' +
            '<input type="number" id="task-progress-num" class="form-control mono" min="0" max="100" value="' + (isEdit ? Number(existingTask.progress || 0) : 0) + '">' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</form>';

  const footerHtml =
    '<button type="button" class="btn btn-secondary" id="task-modal-cancel">Cancel</button>' +
    '<button type="submit" form="task-modal-form" class="btn btn-primary">' + (isEdit ? 'Save Task' : 'Create Task') + '</button>';

  UI.openModal({
    title: isEdit ? 'Edit Task: ' + existingTask.taskCode : 'Create New Task',
    bodyHtml,
    footerHtml,
    onMount: function (overlay) {
      overlay.querySelector('#task-modal-cancel').addEventListener('click', UI.closeModal);

      const statusSel = overlay.querySelector('#task-status');
      const rangeEl = overlay.querySelector('#task-progress-range');
      const numEl = overlay.querySelector('#task-progress-num');
      const submitBtn = overlay.querySelector('button[type="submit"]');

      rangeEl.addEventListener('input', function () {
        numEl.value = rangeEl.value;
      });
      numEl.addEventListener('input', function () {
        const v = Math.max(0, Math.min(100, parseInt(numEl.value || '0', 10)));
        rangeEl.value = isNaN(v) ? '0' : String(v);
      });
      statusSel.addEventListener('change', function () {
        if (statusSel.value === 'Completed') {
          rangeEl.value = '100';
          numEl.value = '100';
        }
      });

      const form = overlay.querySelector('#task-modal-form');
      const errBox = overlay.querySelector('#task-form-error');

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errBox.classList.add('hidden');

        const taskCode = overlay.querySelector('#task-id').value.trim();
        const assignedTo = overlay.querySelector('#task-assignee').value;
        const title = overlay.querySelector('#task-title').value.trim();
        const description = overlay.querySelector('#task-desc').value.trim();
        const priority = overlay.querySelector('#task-priority').value;
        const status = statusSel.value;
        const startDate = overlay.querySelector('#task-start').value;
        const dueDate = overlay.querySelector('#task-deadline').value;
        let progress = parseInt(numEl.value, 10);

        function fail(msg) {
          errBox.textContent = msg;
          errBox.classList.remove('hidden');
        }

        if (!taskCode || !title || !description || !startDate || !dueDate) {
          return fail('Please fill in all required fields.');
        }
        if (dueDate < startDate) {
          return fail('Due date cannot be earlier than the start date.');
        }
        if (isNaN(progress) || progress < 0 || progress > 100) {
          return fail('Progress percentage must be between 0 and 100.');
        }
        if (status === 'Completed') {
          progress = 100;
        }

        if (submitBtn) submitBtn.disabled = true;
        try {
          if (isEdit) {
            await API.updateTask(
              existingTask.id,
              {
                title,
                description,
                assignedTo,
                priority,
                status,
                startDate,
                dueDate,
                progress
              },
              session
            );
            UI.closeModal();
            UI.showToast('Task updated successfully.', 'success');
          } else {
            await API.createTask(
              {
                taskCode,
                title,
                description,
                assignedTo,
                priority,
                status,
                startDate,
                dueDate,
                progress
              },
              session
            );
            UI.closeModal();
            UI.showToast('Task ' + taskCode + ' created.', 'success');
          }
        } catch (err) {
          fail(err.message || 'Could not save task.');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  });
}

function confirmDeleteTask(task) {
  UI.confirmDialog({
    title: 'Delete Task',
    message:
      'Delete task "' +
      task.title +
      '" (' +
      (task.taskCode || task.id) +
      ')? This will also remove its comments and activity history.',
    confirmLabel: 'Delete Task',
    confirmVariant: 'danger',
    onConfirm: async function () {
      try {
        await API.deleteTask(task.id);
        UI.showToast('Task deleted.', 'info');
        if (currentView === 'task-details') {
          navigateTo('tasks');
        }
      } catch (err) {
        UI.showToast(err.message || 'Could not delete task.', 'error');
      }
    }
  });
}

function renderTasksFiltered(container) {
  const allTasks = cachedTasks;
  const employees = cachedEmployees;
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'task-search-input';
  const prevCaret = wasSearchFocused ? document.activeElement.selectionStart : null;

  const filtered = allTasks.filter(function (t) {
    const q = taskFilters.search.trim().toLowerCase();
    const assigneeName = (t.assignedToName || 'Unassigned').toLowerCase();

    const matchesSearch =
      !q ||
      (t.taskCode || '').toLowerCase().indexOf(q) !== -1 ||
      (t.title || '').toLowerCase().indexOf(q) !== -1 ||
      (t.description || '').toLowerCase().indexOf(q) !== -1 ||
      assigneeName.indexOf(q) !== -1;
    const matchesStatus = taskFilters.status === 'all' || t.status === taskFilters.status;
    const matchesPriority = taskFilters.priority === 'all' || t.priority === taskFilters.priority;
    const matchesAssignee =
      taskFilters.assignee === 'all' ||
      (taskFilters.assignee === 'unassigned' ? !t.assignedTo : t.assignedTo === taskFilters.assignee);
    const matchesDeadline = !taskFilters.deadline || String(t.dueDate || '').slice(0, 10) === taskFilters.deadline;

    return matchesSearch && matchesStatus && matchesPriority && matchesAssignee && matchesDeadline;
  });

  const statusOpts =
    '<option value="all">All statuses</option>' +
    Tasks.TASK_STATUSES.map(function (s) {
      return '<option value="' + UI.escapeHtml(s) + '"' + (taskFilters.status === s ? ' selected' : '') + '>' + UI.escapeHtml(s) + '</option>';
    }).join('');

  const priorityOpts =
    '<option value="all">All priorities</option>' +
    Tasks.TASK_PRIORITIES.map(function (p) {
      return '<option value="' + UI.escapeHtml(p) + '"' + (taskFilters.priority === p ? ' selected' : '') + '>' + UI.escapeHtml(p) + '</option>';
    }).join('');

  const assigneeOpts =
    '<option value="all">All employees</option>' +
    '<option value="unassigned"' + (taskFilters.assignee === 'unassigned' ? ' selected' : '') + '>Unassigned</option>' +
    employees
      .map(function (e) {
        return '<option value="' + UI.escapeHtml(e.id) + '"' + (taskFilters.assignee === e.id ? ' selected' : '') + '>' + UI.escapeHtml(e.name) + '</option>';
      })
      .join('');

  let bodyContent = '';
  if (allTasks.length === 0) {
    bodyContent = UI.emptyStateHtml(
      'No tasks available.',
      'Create tasks to assign deadlines, set priorities, and monitor employee completion.',
      '<button type="button" class="btn btn-primary" id="tasks-empty-create-btn">+ New Task</button>'
    );
  } else if (filtered.length === 0) {
    bodyContent = UI.emptyStateHtml(
      'No tasks match your filters.',
      'Try clearing your search input or changing the status/priority/deadline filters.',
      '<button type="button" class="btn btn-secondary" id="tasks-clear-filters-btn">Clear Filters</button>'
    );
  } else {
    bodyContent =
      '<div class="table-wrapper"><table class="data-table"><thead><tr>' +
        '<th>ID</th><th>Title</th><th>Assigned Employee</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Progress</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      filtered
        .map(function (t) {
          const assigneeName = t.assignedToName || 'Unassigned';
          const avatarHtml = t.assignedTo
            ? '<span class="user-avatar-circle avatar-sm" aria-hidden="true">' + UI.escapeHtml(UI.getSingleInitial(assigneeName)) + '</span>'
            : '';
          return (
            '<tr>' +
              '<td class="mono" style="color:var(--text-muted);">' + UI.escapeHtml(t.taskCode || t.id) + '</td>' +
              '<td>' +
                '<button type="button" class="table-link-btn task-view-btn" data-task-id="' + UI.escapeHtml(t.id) + '">' + UI.escapeHtml(t.title) + '</button>' +
              '</td>' +
              '<td><div class="assignee-cell">' + avatarHtml + '<span>' + UI.escapeHtml(assigneeName) + '</span></div></td>' +
              '<td>' + UI.renderPriorityBadge(t.priority) + '</td>' +
              '<td style="color:var(--text-secondary);">' + UI.escapeHtml(UI.formatDate(t.dueDate)) + '</td>' +
              '<td>' + UI.renderStatusBadge(t.status) + '</td>' +
              '<td>' + UI.renderProgressBar(t.progress, t.status) + '</td>' +
              '<td>' +
                '<div class="table-actions">' +
                  '<button type="button" class="btn btn-secondary btn-sm task-view-btn" data-task-id="' + UI.escapeHtml(t.id) + '">Details</button>' +
                  '<button type="button" class="btn-icon-square task-edit-btn" data-task-id="' + UI.escapeHtml(t.id) + '" title="Edit task" aria-label="Edit ' + UI.escapeHtml(t.taskCode || t.id) + '">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>' +
                  '</button>' +
                  '<button type="button" class="btn-icon-square is-danger task-delete-btn" data-task-id="' + UI.escapeHtml(t.id) + '" title="Delete task" aria-label="Delete ' + UI.escapeHtml(t.taskCode || t.id) + '">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                  '</button>' +
                '</div>' +
              '</td>' +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
  }

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Tasks</h1>' +
        '<p class="page-subtitle">Create, assign and monitor company tasks</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-primary" id="tasks-create-btn">+ New Task</button>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="toolbar">' +
        '<div class="toolbar-search">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<input type="search" id="task-search-input" placeholder="Search by title or ID..." value="' + UI.escapeHtml(taskFilters.search) + '">' +
        '</div>' +
        '<div class="toolbar-filters">' +
          '<select id="task-filter-status" class="filter-select" aria-label="Filter by status">' + statusOpts + '</select>' +
          '<select id="task-filter-assignee" class="filter-select" aria-label="Filter by employee">' + assigneeOpts + '</select>' +
          '<select id="task-filter-priority" class="filter-select" aria-label="Filter by priority">' + priorityOpts + '</select>' +
          '<input type="date" id="task-filter-deadline" class="filter-date" aria-label="Filter by due date" value="' + UI.escapeHtml(taskFilters.deadline) + '">' +
        '</div>' +
      '</div>' +
      '<div class="panel-body no-pad">' + bodyContent + '</div>' +
    '</div>';

  container.querySelector('#tasks-create-btn').addEventListener('click', function () {
    openTaskModal(null);
  });

  const emptyCreate = container.querySelector('#tasks-empty-create-btn');
  if (emptyCreate) {
    emptyCreate.addEventListener('click', function () {
      openTaskModal(null);
    });
  }

  const clearFiltersBtn = container.querySelector('#tasks-clear-filters-btn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', function () {
      taskFilters = { search: '', status: 'all', priority: 'all', assignee: 'all', deadline: '' };
      renderTasksFiltered(container);
    });
  }

  const searchInput = container.querySelector('#task-search-input');
  if (wasSearchFocused && searchInput) {
    searchInput.focus();
    if (prevCaret !== null) searchInput.setSelectionRange(prevCaret, prevCaret);
  }
  searchInput.addEventListener('input', function () {
    taskFilters.search = searchInput.value;
    const pos = searchInput.selectionStart;
    renderTasksFiltered(container);
    const reInput = container.querySelector('#task-search-input');
    if (reInput) {
      reInput.focus();
      reInput.setSelectionRange(pos, pos);
    }
  });

  container.querySelector('#task-filter-status').addEventListener('change', function (e) {
    taskFilters.status = e.target.value;
    renderTasksFiltered(container);
  });
  container.querySelector('#task-filter-priority').addEventListener('change', function (e) {
    taskFilters.priority = e.target.value;
    renderTasksFiltered(container);
  });
  container.querySelector('#task-filter-assignee').addEventListener('change', function (e) {
    taskFilters.assignee = e.target.value;
    renderTasksFiltered(container);
  });
  container.querySelector('#task-filter-deadline').addEventListener('change', function (e) {
    taskFilters.deadline = e.target.value;
    renderTasksFiltered(container);
  });

  const viewBtns = container.querySelectorAll('.task-view-btn');
  for (let v = 0; v < viewBtns.length; v++) {
    viewBtns[v].addEventListener('click', function (e) {
      navigateTo('task-details', e.currentTarget.getAttribute('data-task-id'));
    });
  }

  const editBtns = container.querySelectorAll('.task-edit-btn');
  for (let ed = 0; ed < editBtns.length; ed++) {
    editBtns[ed].addEventListener('click', function (e) {
      const task = findCachedTask(e.currentTarget.getAttribute('data-task-id'));
      if (task) openTaskModal(task);
    });
  }

  const delBtns = container.querySelectorAll('.task-delete-btn');
  for (let dl = 0; dl < delBtns.length; dl++) {
    delBtns[dl].addEventListener('click', function (e) {
      const task = findCachedTask(e.currentTarget.getAttribute('data-task-id'));
      if (task) confirmDeleteTask(task);
    });
  }
}

function renderTasksView(container) {
  if (!dataReady.tasks || !dataReady.employees) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml('Loading tasks...', 'Fetching company tasks from Cloud Firestore.') +
      '</div></div>';
    return;
  }
  renderTasksFiltered(container);
}

function refreshLiveView() {
  syncHeaderAndNav();
  const main = document.getElementById('main-view');
  if (!main || !session) return;

  if (currentView === 'dashboard') {
    renderDashboardView(main);
  } else if (currentView === 'tasks') {
    renderTasksView(main);
  } else if (currentView === 'employees') {
    renderEmployeesView(main);
  } else if (currentView === 'notifications') {
    Tasks.renderNotificationsView(main, session, {
      notifications: cachedNotifications,
      onOpenTask: function (tId) {
        navigateTo('task-details', tId);
      }
    });
  }
}

function renderCurrentView() {
  const main = document.getElementById('main-view');
  if (!main || !session) return;

  if (typeof activeViewCleanup === 'function') {
    activeViewCleanup();
    activeViewCleanup = null;
  }

  syncHeaderAndNav();

  if (currentView === 'dashboard') {
    renderDashboardView(main);
  } else if (currentView === 'tasks') {
    renderTasksView(main);
  } else if (currentView === 'employees') {
    renderEmployeesView(main);
  } else if (currentView === 'notifications') {
    Tasks.renderNotificationsView(main, session, {
      notifications: cachedNotifications,
      onOpenTask: function (tId) {
        navigateTo('task-details', tId);
      }
    });
  } else if (currentView === 'task-details') {
    activeViewCleanup = Tasks.renderTaskDetailsView(main, currentTaskId, session, {
      onBack: function () {
        navigateTo('tasks');
      },
      onEditTask: function (task) {
        openTaskModal(task);
      },
      onDeleteTask: function (task) {
        confirmDeleteTask(task);
      }
    });
  } else if (currentView === 'profile') {
    Tasks.renderProfileView(main, session, {
      onProfileUpdated: function (updatedSession) {
        session = updatedSession;
        renderCurrentView();
      }
    });
  } else if (currentView === 'settings') {
    Tasks.renderSettingsView(main, session);
  }
}

function cleanupStreams() {
  if (typeof activeViewCleanup === 'function') {
    activeViewCleanup();
    activeViewCleanup = null;
  }
  while (streamUnsubscribers.length) {
    const unsub = streamUnsubscribers.pop();
    if (typeof unsub === 'function') unsub();
  }
}

async function initAdminApp() {
  session = await Auth.requireAuth('admin');
  if (!session) return;

  UI.applySettingsToBody();
  closeMobileDrawer = UI.setupSidebarToggle();
  parseHash();

  const navItems = document.querySelectorAll('.nav-item[data-view]');
  for (let i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function (e) {
      const targetView = e.currentTarget.getAttribute('data-view');
      navigateTo(targetView);
    });
  }

  const bellBtn = document.getElementById('topbar-bell-btn');
  if (bellBtn) {
    bellBtn.addEventListener('click', function () {
      navigateTo('notifications');
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      cleanupStreams();
      Auth.logout();
    });
  }

  window.addEventListener('hashchange', function () {
    parseHash();
    renderCurrentView();
  });
  window.addEventListener('beforeunload', cleanupStreams);

  streamUnsubscribers.push(
    API.subscribeEmployees(function (employees) {
      cachedEmployees = employees;
      dataReady.employees = true;
      refreshLiveView();
    })
  );
  streamUnsubscribers.push(
    API.subscribeTasks(session, function (tasks) {
      cachedTasks = tasks;
      dataReady.tasks = true;
      refreshLiveView();
    })
  );
  streamUnsubscribers.push(
    API.subscribeNotifications(session, function (notifications) {
      cachedNotifications = notifications;
      dataReady.notifications = true;
      refreshLiveView();
    })
  );

  renderCurrentView();
}

document.addEventListener('DOMContentLoaded', function () {
  if (document.body.getAttribute('data-page') === 'admin') {
    initAdminApp();
  }
});
