/**
 * Shared UI utilities: escaping, formatting, badges, employee cards,
 * toasts, modals, and navigation helpers.
 */
import { Storage } from './storage.js';

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, function (ch) {
    return ESCAPE_MAP[ch];
  });
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function getInitials(name) {
  const parts = String(name || 'U').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getSingleInitial(name) {
  const clean = String(name || 'U').trim();
  return clean ? clean[0].toUpperCase() : 'U';
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const settings = Storage.getSettings();
  if (settings.dateFormat === 'iso') {
    return String(dateStr).slice(0, 10);
  }
  const parsed = new Date(String(dateStr).length === 10 ? dateStr + 'T00:00:00' : dateStr);
  if (isNaN(parsed.getTime())) return escapeHtml(dateStr);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const parsed = new Date(isoStr);
  if (isNaN(parsed.getTime())) return escapeHtml(isoStr);
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function isTaskOverdue(task) {
  const due = task && (task.dueDate || task.deadline);
  if (!task || !due || task.status === 'Completed') return false;
  const today = new Date().toISOString().slice(0, 10);
  return String(due).slice(0, 10) < today;
}

export function renderStatusBadge(status) {
  const map = {
    'To Do': 'status-to-do',
    'Pending': 'status-pending',
    'In Progress': 'status-in-progress',
    'Review': 'status-review',
    'On Hold': 'status-on-hold',
    'Blocked': 'status-blocked',
    'Completed': 'status-completed'
  };
  const cls = map[status] || 'status-to-do';
  return (
    '<span class="badge ' + cls + '">' +
      '<span class="status-dot" aria-hidden="true"></span>' +
      '<span>' + escapeHtml(status || 'To Do') + '</span>' +
    '</span>'
  );
}

export function renderPriorityBadge(priority) {
  const map = {
    'Low': 'priority-low',
    'Medium': 'priority-medium',
    'High': 'priority-high',
    'Urgent': 'priority-urgent'
  };
  const cls = map[priority] || 'priority-medium';
  return '<span class="badge priority-badge ' + cls + '">' + escapeHtml(priority || 'Medium') + '</span>';
}

export function renderAccountBadge(status) {
  const cls = status === 'Inactive' ? 'account-inactive' : 'account-active';
  return '<span class="badge ' + cls + '">' + escapeHtml(status || 'Active') + '</span>';
}

export function renderProgressBar(percentage, status) {
  const pct = Math.max(0, Math.min(100, Number(percentage) || 0));
  let fillCls = 'progress-fill';
  if (status === 'Completed' || pct === 100) {
    fillCls += ' is-complete';
  } else if (status === 'Blocked') {
    fillCls += ' is-blocked';
  }
  return (
    '<div class="progress-stack">' +
      '<div class="progress-track" aria-hidden="true">' +
        '<div class="' + fillCls + '" style="width: ' + pct + '%"></div>' +
      '</div>' +
      '<span class="progress-pct">' + pct + '%</span>' +
    '</div>'
  );
}

export function renderEmployeeWorkloadCard(emp, allTasks) {
  let totalCount = 0;
  let doneCount = 0;
  let overdueCount = 0;
  let avgPct = 0;

  if (emp.stats) {
    totalCount = Number(emp.stats.totalTasks || 0);
    doneCount = Number(emp.stats.completedTasks || 0);
    overdueCount = Number(emp.stats.overdueTasks || 0);
    avgPct = Number(emp.stats.avgCompletion || 0);
  } else {
    const list = Array.isArray(allTasks) ? allTasks : [];
    const empTasks = list.filter(function (t) { return t.assignedTo === emp.id; });
    totalCount = empTasks.length;
    doneCount = empTasks.filter(function (t) { return t.status === 'Completed'; }).length;
    overdueCount = empTasks.filter(isTaskOverdue).length;
    if (empTasks.length > 0) {
      let sum = 0;
      for (let i = 0; i < empTasks.length; i++) {
        sum += Number(empTasks[i].progress || 0);
      }
      avgPct = Math.round(sum / empTasks.length);
    }
  }

  const toggleLabel = emp.status === 'Active' ? 'Deactivate' : 'Activate';
  const statusTag = emp.status === 'Inactive'
    ? '<span class="badge account-inactive">Inactive</span>'
    : '';

  return (
    '<article class="employee-card">' +
      '<div class="employee-card-head">' +
        '<div class="employee-card-identity">' +
          '<span class="user-avatar-circle" aria-hidden="true">' + escapeHtml(getSingleInitial(emp.name)) + '</span>' +
          '<div style="min-width:0;">' +
            '<div class="employee-card-name">' + escapeHtml(emp.name) + '</div>' +
            '<div class="employee-card-email">' + escapeHtml(emp.email) + '</div>' +
          '</div>' +
        '</div>' +
        statusTag +
      '</div>' +

      '<div class="employee-mini-stats">' +
        '<div class="mini-stat-box">' +
          '<div class="mini-stat-value">' + totalCount + '</div>' +
          '<div class="mini-stat-label">Tasks</div>' +
        '</div>' +
        '<div class="mini-stat-box">' +
          '<div class="mini-stat-value">' + doneCount + '</div>' +
          '<div class="mini-stat-label">Done</div>' +
        '</div>' +
        '<div class="mini-stat-box">' +
          '<div class="mini-stat-value">' + overdueCount + '</div>' +
          '<div class="mini-stat-label">Overdue</div>' +
        '</div>' +
      '</div>' +

      '<div class="employee-completion-block">' +
        '<div class="employee-completion-track" aria-hidden="true">' +
          '<div class="employee-completion-fill" style="width:' + avgPct + '%"></div>' +
        '</div>' +
        '<div class="employee-completion-caption">' + avgPct + '% average completion</div>' +
      '</div>' +

      '<div class="employee-card-actions">' +
        '<div class="icon-action-group">' +
          '<button type="button" class="btn-icon-square emp-edit-btn" data-emp-id="' + escapeHtml(emp.id) + '" title="Edit employee" aria-label="Edit ' + escapeHtml(emp.name) + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>' +
          '</button>' +
          '<button type="button" class="btn-icon-square is-danger emp-delete-btn" data-emp-id="' + escapeHtml(emp.id) + '" title="Delete employee" aria-label="Delete ' + escapeHtml(emp.name) + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
          '</button>' +
        '</div>' +
        '<div class="icon-action-group">' +
          '<button type="button" class="btn btn-ghost btn-sm emp-view-btn" data-emp-id="' + escapeHtml(emp.id) + '">Details</button>' +
          '<button type="button" class="btn btn-ghost btn-sm emp-toggle-btn" data-emp-id="' + escapeHtml(emp.id) + '">' + toggleLabel + '</button>' +
        '</div>' +
      '</div>' +
    '</article>'
  );
}

function getToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(message, type) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  const variant = type === 'error' ? 'toast-error' : type === 'info' ? 'toast-info' : 'toast-success';
  toast.className = 'toast ' + variant;
  toast.setAttribute('role', 'status');
  toast.innerHTML =
    '<span>' + escapeHtml(message) + '</span>' +
    '<button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>';

  const closeBtn = toast.querySelector('.toast-close');
  function remove() {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }
  closeBtn.addEventListener('click', remove);
  container.appendChild(toast);
  setTimeout(remove, 4200);
}

let activeModalOverlay = null;
let escListener = null;

export function closeModal() {
  if (activeModalOverlay && activeModalOverlay.parentNode) {
    activeModalOverlay.parentNode.removeChild(activeModalOverlay);
  }
  activeModalOverlay = null;
  if (escListener) {
    document.removeEventListener('keydown', escListener);
    escListener = null;
  }
}

export function openModal(options) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const sizeClass = options.size === 'sm' ? ' modal-sm' : '';
  overlay.innerHTML =
    '<div class="modal-dialog' + sizeClass + '">' +
      '<div class="modal-header">' +
        '<h2 class="modal-title">' + escapeHtml(options.title || '') + '</h2>' +
        '<button type="button" class="modal-close-btn" aria-label="Close modal">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
      '</div>' +
      '<div class="modal-body">' + (options.bodyHtml || '') + '</div>' +
      (options.footerHtml ? '<div class="modal-footer">' + options.footerHtml + '</div>' : '') +
    '</div>';

  document.body.appendChild(overlay);
  activeModalOverlay = overlay;

  const closeBtn = overlay.querySelector('.modal-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      closeModal();
    }
  });

  escListener = function (e) {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escListener);

  if (typeof options.onMount === 'function') {
    options.onMount(overlay);
  }
  return overlay;
}

export function confirmDialog(options) {
  const btnClass = options.confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary';
  openModal({
    title: options.title || 'Confirm Action',
    size: 'sm',
    bodyHtml: '<p style="color: var(--text-secondary); font-size: 0.9375rem;">' + escapeHtml(options.message || 'Are you sure you want to proceed?') + '</p>',
    footerHtml:
      '<button type="button" class="btn btn-secondary" id="confirm-cancel-btn">Cancel</button>' +
      '<button type="button" class="btn ' + btnClass + '" id="confirm-accept-btn">' + escapeHtml(options.confirmLabel || 'Confirm') + '</button>',
    onMount: function (overlay) {
      overlay.querySelector('#confirm-cancel-btn').addEventListener('click', closeModal);
      overlay.querySelector('#confirm-accept-btn').addEventListener('click', function () {
        closeModal();
        if (typeof options.onConfirm === 'function') {
          options.onConfirm();
        }
      });
    }
  });
}

export function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const menuBtn = document.getElementById('mobile-menu-btn');
  if (!sidebar || !backdrop || !menuBtn) return;

  function closeDrawer() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  }

  menuBtn.addEventListener('click', function () {
    const isOpen = sidebar.classList.toggle('is-open');
    backdrop.classList.toggle('is-open', isOpen);
  });

  backdrop.addEventListener('click', closeDrawer);

  return closeDrawer;
}

export function applySettingsToBody() {
  const settings = Storage.getSettings();
  if (settings.compactTables) {
    document.body.classList.add('density-compact');
  } else {
    document.body.classList.remove('density-compact');
  }
}

export function emptyStateHtml(title, description, actionHtml) {
  return (
    '<div class="empty-state">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<p>' + escapeHtml(description) + '</p>' +
      (actionHtml ? '<div style="margin-top: 10px;">' + actionHtml + '</div>' : '') +
    '</div>'
  );
}

export const UI = {
  escapeHtml,
  isValidEmail,
  getInitials,
  getSingleInitial,
  formatDate,
  formatDateTime,
  isTaskOverdue,
  renderStatusBadge,
  renderPriorityBadge,
  renderAccountBadge,
  renderProgressBar,
  renderEmployeeWorkloadCard,
  showToast,
  openModal,
  closeModal,
  confirmDialog,
  setupSidebarToggle,
  applySettingsToBody,
  emptyStateHtml
};

window.CTM = window.CTM || {};
window.CTM.UI = UI;
