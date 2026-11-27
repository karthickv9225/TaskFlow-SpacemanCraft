/**
 * Employee Workspace Controller (TaskFlow UI — Cloud Firestore + Firebase Auth):
 * Real-time Employee Dashboard KPIs, My Tasks (view, filter, update status/progress, comment),
 * Notifications, Task Details, Profile, and Settings.
 */
import { Storage } from './storage.js';
import { UI } from './common.js';
import { API } from './api.js';
import { Auth } from './auth.js';
import { Tasks } from './tasks.js';

let session = null;
let currentView = 'dashboard';
let currentTaskId = null;
let closeMobileDrawer = null;

let cachedTasks = [];
let cachedNotifications = [];
let dataReady = { tasks: false, notifications: false };

let activeViewCleanup = null;
const streamUnsubscribers = [];

let myTaskFilters = { search: '', status: 'all', priority: 'all', deadline: '' };

function syncHeaderAndNav() {
  const counts = API.computeDashboardCounts([], cachedTasks, cachedNotifications);

  const notifBadge = document.getElementById('nav-notif-count');
  if (notifBadge) notifBadge.textContent = String(counts.unreadNotifications);

  const myTasksBadge = document.getElementById('nav-tasks-count');
  if (myTasksBadge) myTasksBadge.textContent = String(counts.myTotalTasks);

  const bellBadge = document.getElementById('topbar-bell-badge');
  if (bellBadge) bellBadge.textContent = String(counts.unreadNotifications);

  if (session) {
    const nameEls = document.querySelectorAll('[data-user-name]');
    for (let i = 0; i < nameEls.length; i++) {
      nameEls[i].textContent = session.name;
    }
    const metaEls = document.querySelectorAll('[data-user-meta]');
    for (let j = 0; j < metaEls.length; j++) {
      metaEls[j].textContent = session.designation || 'Employee';
    }
    const avatarEl = document.getElementById('topbar-avatar');
    if (avatarEl) {
      avatarEl.textContent = UI.getInitials(session.name);
    }
  }

  const navBtns = document.querySelectorAll('.nav-item[data-view]');
  const activeNavKey = currentView === 'task-details' ? 'my-tasks' : currentView;
  for (let k = 0; k < navBtns.length; k++) {
    const view = navBtns[k].getAttribute('data-view');
    navBtns[k].classList.toggle('active', view === activeNavKey);
  }

  const titles = {
    dashboard: 'Dashboard',
    'my-tasks': 'My Tasks',
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
  const validViews = ['dashboard', 'my-tasks', 'notifications', 'task-details', 'profile', 'settings'];
  if (validViews.indexOf(view) === -1) {
    view = 'dashboard';
  }
  currentView = view;
  currentTaskId = parts[1] ? decodeURIComponent(parts[1]) : null;
}

function findCachedTask(id) {
  for (let i = 0; i < cachedTasks.length; i++) {
    if (cachedTasks[i].id === id) return cachedTasks[i];
  }
  return null;
}

/* ---------------- Quick Update Modal ---------------- */
function openQuickUpdateModal(task) {
  const isCompletedLocked = task.status === 'Completed';
  const statusOpts = Tasks.TASK_STATUSES.map(function (st) {
    return '<option value="' + UI.escapeHtml(st) + '"' + (task.status === st ? ' selected' : '') + '>' + UI.escapeHtml(st) + '</option>';
  }).join('');

  const bodyHtml =
    '<form id="emp-quick-update-form">' +
      '<div style="margin-bottom:16px;">' +
        '<div class="mono" style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">' + UI.escapeHtml(task.taskCode || task.id) + '</div>' +
        '<div style="font-weight:600; font-size:1rem;">' + UI.escapeHtml(task.title) + '</div>' +
      '</div>' +
      (isCompletedLocked
        ? '<div class="form-info-box">This task is already Completed. You can still post comments below, or contact an administrator to reopen it.</div>'
        : '') +
      '<div id="emp-update-error" class="form-error-box hidden"></div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="quick-status">Status</label>' +
        '<select id="quick-status" class="form-control"' + (isCompletedLocked ? ' disabled' : '') + '>' + statusOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="quick-progress-num">Completion Percentage</label>' +
        '<div class="range-pair">' +
          '<input type="range" id="quick-progress-range" min="0" max="100" value="' + Number(task.progress || 0) + '" aria-label="Completion percentage slider"' + (isCompletedLocked ? ' disabled' : '') + '>' +
          '<input type="number" id="quick-progress-num" class="form-control mono" min="0" max="100" value="' + Number(task.progress || 0) + '"' + (isCompletedLocked ? ' disabled' : '') + '>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="quick-comment">Progress Comment (Optional)</label>' +
        '<textarea id="quick-comment" class="form-control" placeholder="Add an optional update or note for your administrator..."></textarea>' +
      '</div>' +
    '</form>';

  const footerHtml =
    '<button type="button" class="btn btn-secondary" id="quick-cancel-btn">Cancel</button>' +
    '<button type="submit" form="emp-quick-update-form" class="btn btn-primary">Save Update</button>';

  UI.openModal({
    title: 'Update Task Progress',
    bodyHtml,
    footerHtml,
    onMount: function (overlay) {
      overlay.querySelector('#quick-cancel-btn').addEventListener('click', UI.closeModal);
      const statusEl = overlay.querySelector('#quick-status');
      const rangeEl = overlay.querySelector('#quick-progress-range');
      const numEl = overlay.querySelector('#quick-progress-num');
      const errBox = overlay.querySelector('#emp-update-error');
      const submitBtn = overlay.querySelector('button[type="submit"]');

      rangeEl.addEventListener('input', function () {
        numEl.value = rangeEl.value;
      });
      numEl.addEventListener('input', function () {
        const v = Math.max(0, Math.min(100, parseInt(numEl.value || '0', 10)));
        rangeEl.value = isNaN(v) ? '0' : String(v);
      });
      statusEl.addEventListener('change', function () {
        if (statusEl.value === 'Completed') {
          rangeEl.value = '100';
          numEl.value = '100';
        }
      });

      overlay.querySelector('#emp-quick-update-form').addEventListener('submit', function (e) {
        e.preventDefault();
        errBox.classList.add('hidden');

        const nextStatus = statusEl.value;
        const nextProgress = numEl.value;
        const commentText = overlay.querySelector('#quick-comment').value.trim();

        const executeSave = async function () {
          if (submitBtn) submitBtn.disabled = true;
          if (!isCompletedLocked) {
            const res = await Tasks.updateTaskStatusAndProgress(task.id, nextStatus, nextProgress, session);
            if (!res.ok) {
              if (submitBtn) submitBtn.disabled = false;
              errBox.textContent = res.error;
              errBox.classList.remove('hidden');
              return;
            }
          }
          if (commentText) {
            const cRes = await Tasks.addTaskComment(task.id, commentText, session);
            if (!cRes.ok) {
              if (submitBtn) submitBtn.disabled = false;
              errBox.textContent = cRes.error;
              errBox.classList.remove('hidden');
              return;
            }
          }
          if (submitBtn) submitBtn.disabled = false;
          UI.closeModal();
          UI.showToast('Task updated successfully.', 'success');
        };

        if (!isCompletedLocked && Storage.getSettings().confirmStatusChange) {
          UI.confirmDialog({
            title: 'Confirm Task Update',
            message:
              'Save status "' +
              nextStatus +
              '" (' +
              nextProgress +
              '%) for ' +
              (task.taskCode || task.id) +
              '?',
            confirmLabel: 'Confirm',
            onConfirm: executeSave
          });
        } else {
          executeSave();
        }
      });
    }
  });
}

/* ---------------- Employee Dashboard Overview ---------------- */
function renderDashboardView(container) {
  if (!dataReady.tasks) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml('Loading dashboard...', 'Fetching your assigned tasks from Cloud Firestore.') +
      '</div></div>';
    return;
  }

  const counts = API.computeDashboardCounts([], cachedTasks, cachedNotifications);
  const myTasks = cachedTasks;

  const tasksHtml =
    myTasks.length === 0
      ? UI.emptyStateHtml(
          'No tasks available',
          'Tasks assigned to you by an administrator will appear here.'
        )
      : '<div class="table-wrapper"><table class="data-table"><thead><tr>' +
          '<th>ID</th><th>Title</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Progress</th><th>Action</th>' +
        '</tr></thead><tbody>' +
        myTasks
          .map(function (t) {
            return (
              '<tr>' +
                '<td class="mono" style="color:var(--text-muted);">' + UI.escapeHtml(t.taskCode || t.id) + '</td>' +
                '<td><button type="button" class="table-link-btn emp-open-task" data-task-id="' + UI.escapeHtml(t.id) + '">' + UI.escapeHtml(t.title) + '</button></td>' +
                '<td>' + UI.renderPriorityBadge(t.priority) + '</td>' +
                '<td style="color:var(--text-secondary);">' + UI.escapeHtml(UI.formatDate(t.dueDate)) + '</td>' +
                '<td>' + UI.renderStatusBadge(t.status) + '</td>' +
                '<td>' + UI.renderProgressBar(t.progress, t.status) + '</td>' +
                '<td><button type="button" class="btn btn-secondary btn-sm emp-quick-update" data-task-id="' + UI.escapeHtml(t.id) + '">Update</button></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Dashboard</h1>' +
        '<p class="page-subtitle">Personal task overview for ' + UI.escapeHtml(session.name) + '</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-primary" id="emp-dash-my-tasks-btn">My Tasks</button>' +
      '</div>' +
    '</div>' +

    '<div class="kpi-grid kpi-grid-4">' +
      '<div class="kpi-card">' +
        '<div class="kpi-icon-box kpi-tint-orange" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.myTotalTasks || 0) + '</div><div class="kpi-label">My Total Tasks</div></div>' +
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
        '<div class="kpi-icon-box kpi-tint-green" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>' +
        '</div>' +
        '<div class="kpi-content"><div class="kpi-value">' + Number(counts.completedTasks || 0) + '</div><div class="kpi-label">Completed</div></div>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-header">' +
        '<h2 class="panel-title">Assigned Tasks</h2>' +
      '</div>' +
      '<div class="panel-body no-pad">' + tasksHtml + '</div>' +
    '</div>';

  container.querySelector('#emp-dash-my-tasks-btn').addEventListener('click', function () {
    navigateTo('my-tasks');
  });

  const taskLinks = container.querySelectorAll('.emp-open-task');
  for (let i = 0; i < taskLinks.length; i++) {
    taskLinks[i].addEventListener('click', function (e) {
      navigateTo('task-details', e.currentTarget.getAttribute('data-task-id'));
    });
  }

  const quickBtns = container.querySelectorAll('.emp-quick-update');
  for (let q = 0; q < quickBtns.length; q++) {
    quickBtns[q].addEventListener('click', function (e) {
      const t = findCachedTask(e.currentTarget.getAttribute('data-task-id'));
      if (t) openQuickUpdateModal(t);
    });
  }
}

/* ---------------- My Tasks View ---------------- */
function renderMyTasksFiltered(container) {
  const myTasks = cachedTasks;
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'my-task-search';
  const prevCaret = wasSearchFocused ? document.activeElement.selectionStart : null;

  const filtered = myTasks.filter(function (t) {
    const q = myTaskFilters.search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (t.taskCode || '').toLowerCase().indexOf(q) !== -1 ||
      (t.title || '').toLowerCase().indexOf(q) !== -1 ||
      (t.description || '').toLowerCase().indexOf(q) !== -1;
    const matchesStatus = myTaskFilters.status === 'all' || t.status === myTaskFilters.status;
    const matchesPriority = myTaskFilters.priority === 'all' || t.priority === myTaskFilters.priority;
    const matchesDeadline = !myTaskFilters.deadline || String(t.dueDate || '').slice(0, 10) === myTaskFilters.deadline;
    return matchesSearch && matchesStatus && matchesPriority && matchesDeadline;
  });

  const statusOpts =
    '<option value="all">All statuses</option>' +
    Tasks.TASK_STATUSES.map(function (s) {
      return '<option value="' + UI.escapeHtml(s) + '"' + (myTaskFilters.status === s ? ' selected' : '') + '>' + UI.escapeHtml(s) + '</option>';
    }).join('');

  const priorityOpts =
    '<option value="all">All priorities</option>' +
    Tasks.TASK_PRIORITIES.map(function (p) {
      return '<option value="' + UI.escapeHtml(p) + '"' + (myTaskFilters.priority === p ? ' selected' : '') + '>' + UI.escapeHtml(p) + '</option>';
    }).join('');

  let bodyContent = '';
  if (myTasks.length === 0) {
    bodyContent = UI.emptyStateHtml(
      'No tasks available.',
      'You do not have any tasks assigned yet. Check back once your administrator assigns work.'
    );
  } else if (filtered.length === 0) {
    bodyContent = UI.emptyStateHtml(
      'No tasks match your filters.',
      'Try clearing your search or status filter.',
      '<button type="button" class="btn btn-secondary" id="my-tasks-clear-filters">Clear Filters</button>'
    );
  } else {
    bodyContent =
      '<div class="table-wrapper"><table class="data-table"><thead><tr>' +
        '<th>ID</th><th>Title</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Progress</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      filtered
        .map(function (t) {
          const completeBtn =
            t.status !== 'Completed'
              ? '<button type="button" class="btn btn-primary btn-sm emp-mark-complete-btn" data-task-id="' + UI.escapeHtml(t.id) + '">Complete</button>'
              : '';
          return (
            '<tr>' +
              '<td class="mono" style="color:var(--text-muted);">' + UI.escapeHtml(t.taskCode || t.id) + '</td>' +
              '<td>' +
                '<button type="button" class="table-link-btn emp-task-detail-btn" data-task-id="' + UI.escapeHtml(t.id) + '">' + UI.escapeHtml(t.title) + '</button>' +
              '</td>' +
              '<td>' + UI.renderPriorityBadge(t.priority) + '</td>' +
              '<td style="color:var(--text-secondary);">' + UI.escapeHtml(UI.formatDate(t.dueDate)) + '</td>' +
              '<td>' + UI.renderStatusBadge(t.status) + '</td>' +
              '<td>' + UI.renderProgressBar(t.progress, t.status) + '</td>' +
              '<td>' +
                '<div class="table-actions">' +
                  '<button type="button" class="btn btn-secondary btn-sm emp-task-detail-btn" data-task-id="' + UI.escapeHtml(t.id) + '">Details</button>' +
                  '<button type="button" class="btn btn-secondary btn-sm emp-task-update-btn" data-task-id="' + UI.escapeHtml(t.id) + '">Update</button>' +
                  completeBtn +
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
        '<h1 class="page-title">My Tasks</h1>' +
        '<p class="page-subtitle">View assigned deliverables, update completion percentage, and post progress comments.</p>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="toolbar">' +
        '<div class="toolbar-search">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<input type="search" id="my-task-search" placeholder="Search by title or ID..." value="' + UI.escapeHtml(myTaskFilters.search) + '">' +
        '</div>' +
        '<div class="toolbar-filters">' +
          '<select id="my-task-filter-status" class="filter-select" aria-label="Filter by status">' + statusOpts + '</select>' +
          '<select id="my-task-filter-priority" class="filter-select" aria-label="Filter by priority">' + priorityOpts + '</select>' +
          '<input type="date" id="my-task-filter-deadline" class="filter-date" aria-label="Filter by due date" value="' + UI.escapeHtml(myTaskFilters.deadline) + '">' +
        '</div>' +
      '</div>' +
      '<div class="panel-body no-pad">' + bodyContent + '</div>' +
    '</div>';

  const clearBtn = container.querySelector('#my-tasks-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      myTaskFilters = { search: '', status: 'all', priority: 'all', deadline: '' };
      renderMyTasksFiltered(container);
    });
  }

  const searchInput = container.querySelector('#my-task-search');
  if (wasSearchFocused && searchInput) {
    searchInput.focus();
    if (prevCaret !== null) searchInput.setSelectionRange(prevCaret, prevCaret);
  }
  searchInput.addEventListener('input', function () {
    myTaskFilters.search = searchInput.value;
    const pos = searchInput.selectionStart;
    renderMyTasksFiltered(container);
    const reInput = container.querySelector('#my-task-search');
    if (reInput) {
      reInput.focus();
      reInput.setSelectionRange(pos, pos);
    }
  });

  container.querySelector('#my-task-filter-status').addEventListener('change', function (e) {
    myTaskFilters.status = e.target.value;
    renderMyTasksFiltered(container);
  });
  container.querySelector('#my-task-filter-priority').addEventListener('change', function (e) {
    myTaskFilters.priority = e.target.value;
    renderMyTasksFiltered(container);
  });
  container.querySelector('#my-task-filter-deadline').addEventListener('change', function (e) {
    myTaskFilters.deadline = e.target.value;
    renderMyTasksFiltered(container);
  });

  const detailBtns = container.querySelectorAll('.emp-task-detail-btn');
  for (let d = 0; d < detailBtns.length; d++) {
    detailBtns[d].addEventListener('click', function (e) {
      navigateTo('task-details', e.currentTarget.getAttribute('data-task-id'));
    });
  }

  const updateBtns = container.querySelectorAll('.emp-task-update-btn');
  for (let u = 0; u < updateBtns.length; u++) {
    updateBtns[u].addEventListener('click', function (e) {
      const t = findCachedTask(e.currentTarget.getAttribute('data-task-id'));
      if (t) openQuickUpdateModal(t);
    });
  }

  const completeBtns = container.querySelectorAll('.emp-mark-complete-btn');
  for (let c = 0; c < completeBtns.length; c++) {
    completeBtns[c].addEventListener('click', async function (e) {
      const btn = e.currentTarget;
      const taskId = btn.getAttribute('data-task-id');
      btn.disabled = true;
      const res = await Tasks.updateTaskStatusAndProgress(taskId, 'Completed', 100, session);
      btn.disabled = false;
      if (!res.ok) {
        UI.showToast(res.error, 'error');
        return;
      }
      UI.showToast('Task marked as Completed.', 'success');
    });
  }
}

function renderMyTasksView(container) {
  if (!dataReady.tasks) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml('Loading tasks...', 'Fetching your assigned tasks from Cloud Firestore.') +
      '</div></div>';
    return;
  }
  renderMyTasksFiltered(container);
}

function refreshLiveView() {
  syncHeaderAndNav();
  const main = document.getElementById('main-view');
  if (!main || !session) return;

  if (currentView === 'dashboard') {
    renderDashboardView(main);
  } else if (currentView === 'my-tasks') {
    renderMyTasksView(main);
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
  } else if (currentView === 'my-tasks') {
    renderMyTasksView(main);
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
        navigateTo('my-tasks');
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

async function initEmployeeApp() {
  session = await Auth.requireAuth('employee');
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
  if (document.body.getAttribute('data-page') === 'employee') {
    initEmployeeApp();
  }
});
