/**
 * Shared Task Details, Status/Progress Updates, Comments, History,
 * Notifications, Profile, and Settings views (Cloud Firestore + Firebase Auth backed).
 */
import { Storage } from './storage.js';
import { UI } from './common.js';
import { API } from './api.js';
import { Auth } from './auth.js';

export const TASK_STATUSES = ['To Do', 'In Progress', 'Review', 'Blocked', 'Completed'];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High'];

export async function updateTaskStatusAndProgress(taskId, newStatus, newProgress, session) {
  if (TASK_STATUSES.indexOf(newStatus) === -1) {
    return { ok: false, error: 'Invalid task status selected.' };
  }

  let pct = parseInt(newProgress, 10);
  if (isNaN(pct) || pct < 0 || pct > 100) {
    return { ok: false, error: 'Progress percentage must be between 0 and 100.' };
  }

  if (newStatus === 'Completed') {
    pct = 100;
  }

  try {
    await API.updateTaskProgress(taskId, { status: newStatus, progress: pct }, session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to update task progress.' };
  }
}

export async function addTaskComment(taskId, rawMessage, session) {
  const message = String(rawMessage || '').trim();
  if (!message) {
    return { ok: false, error: 'Please enter a comment before submitting.' };
  }

  try {
    await API.addTaskComment(taskId, message, session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to post comment.' };
  }
}

function buildCommentsHtml(comments) {
  if (!comments || comments.length === 0) {
    return '<p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 16px;">No comments added yet.</p>';
  }
  return (
    '<div class="comment-list">' +
    comments
      .map(function (c) {
        const roleLabel = c.authorRole === 'admin' ? 'Administrator' : 'Employee';
        return (
          '<div class="comment-item">' +
            '<div class="comment-header">' +
              '<div>' +
                '<span class="comment-author">' + UI.escapeHtml(c.authorName) + '</span>' +
                '<span class="comment-role">' + roleLabel + '</span>' +
              '</div>' +
              '<span class="comment-time">' + UI.escapeHtml(UI.formatDateTime(c.createdAt)) + '</span>' +
            '</div>' +
            '<div class="comment-text">' + UI.escapeHtml(c.message) + '</div>' +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

function buildHistoryHtml(history) {
  if (!history || history.length === 0) {
    return '<div class="panel-body"><p style="color: var(--text-muted); font-size: 0.875rem;">No activity history recorded yet.</p></div>';
  }
  return (
    '<ul class="activity-list">' +
    history
      .map(function (h) {
        return (
          '<li class="activity-item">' +
            '<div class="activity-text">' + UI.escapeHtml(h.action) + '</div>' +
            '<div class="activity-meta">' +
              '<span>' + UI.escapeHtml(h.actorName) + '</span>' +
              '<span aria-hidden="true">&middot;</span>' +
              '<span class="mono">' + UI.escapeHtml(UI.formatDateTime(h.createdAt)) + '</span>' +
            '</div>' +
          '</li>'
        );
      })
      .join('') +
    '</ul>'
  );
}

function buildTaskMetaHtml(task) {
  const assigneeDisplay = task.assignedTo
    ? task.assignedToName + (task.assignedEmployeeCode ? ' (' + task.assignedEmployeeCode + ')' : '')
    : 'Unassigned';

  return (
    '<div style="margin-bottom: 16px;">' +
      '<div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Overall Progress</div>' +
      UI.renderProgressBar(task.progress, task.status) +
    '</div>' +
    '<div class="meta-list">' +
      '<div class="meta-row"><span class="meta-key">Task ID</span><span class="meta-val mono">' + UI.escapeHtml(task.taskCode || task.id) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Assigned To</span><span class="meta-val">' + UI.escapeHtml(assigneeDisplay) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Priority</span><span class="meta-val">' + UI.renderPriorityBadge(task.priority) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Start Date</span><span class="meta-val mono">' + UI.escapeHtml(UI.formatDate(task.startDate)) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Due Date</span><span class="meta-val mono">' + UI.escapeHtml(UI.formatDate(task.dueDate)) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Created Date</span><span class="meta-val mono">' + UI.escapeHtml(UI.formatDateTime(task.createdAt)) + '</span></div>' +
      '<div class="meta-row"><span class="meta-key">Last Updated</span><span class="meta-val mono">' + UI.escapeHtml(UI.formatDateTime(task.updatedAt)) + '</span></div>' +
    '</div>'
  );
}

/* ---------------- Shared Real-Time Task Details View ---------------- */
export function renderTaskDetailsView(container, taskId, session, callbacks) {
  if (!taskId) {
    container.innerHTML =
      '<div class="panel"><div class="panel-body">' +
      UI.emptyStateHtml(
        'Task not found',
        'No task was specified.',
        '<button type="button" class="btn btn-secondary" id="details-back-btn">Go Back</button>'
      ) +
      '</div></div>';
    const bBtn = container.querySelector('#details-back-btn');
    if (bBtn && callbacks && callbacks.onBack) bBtn.addEventListener('click', callbacks.onBack);
    return function () {};
  }

  container.innerHTML =
    '<div class="panel"><div class="panel-body">' +
    UI.emptyStateHtml('Loading task details...', 'Connecting to live Cloud Firestore task stream.') +
    '</div></div>';

  let mountedTaskId = null;
  let latestTask = null;

  const unsubscribe = API.subscribeTaskDetails(
    taskId,
    function (data) {
      const task = data.task;
      const history = data.activities || [];
      const comments = data.comments || [];

      if (!task) {
        mountedTaskId = null;
        latestTask = null;
        container.innerHTML =
          '<div class="panel"><div class="panel-body">' +
          UI.emptyStateHtml(
            'Task not found',
            'The requested task may have been deleted or reassigned.',
            '<button type="button" class="btn btn-secondary" id="details-back-btn">Go Back</button>'
          ) +
          '</div></div>';
        const backErrBtn = container.querySelector('#details-back-btn');
        if (backErrBtn && callbacks && callbacks.onBack) {
          backErrBtn.addEventListener('click', callbacks.onBack);
        }
        return;
      }

      latestTask = task;
      const isEmployeeCompletedLocked = session.role === 'employee' && task.status === 'Completed';

      // Incremental live DOM update if already mounted (preserves in-progress comment/progress edits)
      if (mountedTaskId === task.id) {
        const badgeRow = container.querySelector('#detail-badges-row');
        if (badgeRow) {
          badgeRow.innerHTML =
            '<span class="mono" style="font-size:0.8125rem; color:var(--text-secondary); font-weight:600;">' +
              UI.escapeHtml(task.taskCode || task.id) +
            '</span>' +
            UI.renderStatusBadge(task.status) +
            UI.renderPriorityBadge(task.priority);
        }
        const titleEl = container.querySelector('#detail-task-title');
        if (titleEl) titleEl.textContent = task.title;

        const descEl = container.querySelector('#detail-task-description');
        if (descEl) descEl.textContent = task.description || 'No description provided.';

        const commentsHeading = container.querySelector('#detail-comments-heading');
        if (commentsHeading) commentsHeading.textContent = 'Task Comments (' + comments.length + ')';

        const commentsWrap = container.querySelector('#detail-comments-container');
        if (commentsWrap) commentsWrap.innerHTML = buildCommentsHtml(comments);

        const metaWrap = container.querySelector('#detail-meta-container');
        if (metaWrap) metaWrap.innerHTML = buildTaskMetaHtml(task);

        const historyWrap = container.querySelector('#detail-history-container');
        if (historyWrap) historyWrap.innerHTML = buildHistoryHtml(history);

        const statusSelect = container.querySelector('#detail-status-select');
        const rangeInput = container.querySelector('#detail-progress-range');
        const numberInput = container.querySelector('#detail-progress-number');
        const progressSubmit = container.querySelector('#detail-progress-submit');
        const lockNote = container.querySelector('#detail-completed-lock-note');
        const markCompleteBtn = container.querySelector('#detail-mark-complete-btn');

        if (statusSelect && document.activeElement !== statusSelect) {
          statusSelect.value = task.status;
          statusSelect.disabled = isEmployeeCompletedLocked;
        }
        if (rangeInput && numberInput && document.activeElement !== rangeInput && document.activeElement !== numberInput) {
          rangeInput.value = String(Number(task.progress || 0));
          numberInput.value = String(Number(task.progress || 0));
          rangeInput.disabled = isEmployeeCompletedLocked;
          numberInput.disabled = isEmployeeCompletedLocked;
        }
        if (progressSubmit) progressSubmit.disabled = isEmployeeCompletedLocked;
        if (lockNote) lockNote.classList.toggle('hidden', !isEmployeeCompletedLocked);
        if (markCompleteBtn) markCompleteBtn.classList.toggle('hidden', task.status === 'Completed');
        return;
      }

      mountedTaskId = task.id;

      const adminActionsHtml =
        session.role === 'admin'
          ? '<button type="button" class="btn btn-secondary" id="detail-edit-task-btn">Edit Task</button>' +
            '<button type="button" class="btn btn-danger-outline" id="detail-delete-task-btn">Delete Task</button>'
          : '<button type="button" class="btn btn-primary' +
            (task.status === 'Completed' ? ' hidden' : '') +
            '" id="detail-mark-complete-btn">Mark Completed</button>';

      const statusOptionsHtml = TASK_STATUSES.map(function (st) {
        return (
          '<option value="' +
          UI.escapeHtml(st) +
          '"' +
          (task.status === st ? ' selected' : '') +
          '>' +
          UI.escapeHtml(st) +
          '</option>'
        );
      }).join('');

      container.innerHTML =
        '<div class="page-header">' +
          '<div>' +
            '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-secondary btn-sm" id="details-back-btn">&larr; Back</button>' +
              '<div id="detail-badges-row" style="display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
                '<span class="mono" style="font-size:0.8125rem; color:var(--text-secondary); font-weight:600;">' +
                  UI.escapeHtml(task.taskCode || task.id) +
                '</span>' +
                UI.renderStatusBadge(task.status) +
                UI.renderPriorityBadge(task.priority) +
              '</div>' +
            '</div>' +
            '<h1 id="detail-task-title" class="page-title">' + UI.escapeHtml(task.title) + '</h1>' +
          '</div>' +
          '<div class="page-actions">' + adminActionsHtml + '</div>' +
        '</div>' +

        '<div class="details-grid">' +
          '<div>' +
            '<div class="panel">' +
              '<div class="panel-header"><h2 class="panel-title">Description</h2></div>' +
              '<div class="panel-body">' +
                '<p id="detail-task-description" class="task-description-prose">' +
                  UI.escapeHtml(task.description || 'No description provided.') +
                '</p>' +
              '</div>' +
            '</div>' +

            '<div class="panel">' +
              '<div class="panel-header"><h2 class="panel-title">Update Progress &amp; Status</h2></div>' +
              '<div class="panel-body">' +
                '<div id="detail-completed-lock-note" class="form-info-box' +
                  (isEmployeeCompletedLocked ? '' : ' hidden') +
                '">This task is marked Completed. Contact an administrator if it needs to be reopened.</div>' +
                '<form id="task-progress-form">' +
                  '<div class="form-grid">' +
                    '<div class="form-group">' +
                      '<label class="form-label" for="detail-status-select">Status</label>' +
                      '<select id="detail-status-select" class="form-control"' +
                        (isEmployeeCompletedLocked ? ' disabled' : '') +
                      '>' + statusOptionsHtml + '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                      '<label class="form-label" for="detail-progress-number">Completion Percentage</label>' +
                      '<div class="range-pair">' +
                        '<input type="range" id="detail-progress-range" min="0" max="100" value="' +
                          Number(task.progress || 0) +
                        '" aria-label="Completion percentage slider"' +
                          (isEmployeeCompletedLocked ? ' disabled' : '') +
                        '>' +
                        '<input type="number" id="detail-progress-number" class="form-control mono" min="0" max="100" value="' +
                          Number(task.progress || 0) +
                        '"' + (isEmployeeCompletedLocked ? ' disabled' : '') + '>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div style="margin-top: 16px; display:flex; justify-content:flex-end;">' +
                    '<button type="submit" id="detail-progress-submit" class="btn btn-primary"' +
                      (isEmployeeCompletedLocked ? ' disabled' : '') +
                    '>Save Progress Update</button>' +
                  '</div>' +
                '</form>' +
              '</div>' +
            '</div>' +

            '<div class="panel">' +
              '<div class="panel-header"><h2 id="detail-comments-heading" class="panel-title">Task Comments (' + comments.length + ')</h2></div>' +
              '<div class="panel-body">' +
                '<div id="detail-comments-container">' + buildCommentsHtml(comments) + '</div>' +
                '<form id="task-comment-form">' +
                  '<div class="form-group">' +
                    '<label class="form-label" for="detail-comment-input">Add Progress Comment</label>' +
                    '<textarea id="detail-comment-input" class="form-control" placeholder="Write a status note, blocker detail, or update..." required></textarea>' +
                  '</div>' +
                  '<div style="display:flex; justify-content:flex-end;">' +
                    '<button type="submit" class="btn btn-secondary">Post Comment</button>' +
                  '</div>' +
                '</form>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div>' +
            '<div class="panel">' +
              '<div class="panel-header"><h2 class="panel-title">Task Metadata</h2></div>' +
              '<div id="detail-meta-container" class="panel-body">' + buildTaskMetaHtml(task) + '</div>' +
            '</div>' +

            '<div class="panel">' +
              '<div class="panel-header"><h2 class="panel-title">Task Activity History</h2></div>' +
              '<div id="detail-history-container" class="panel-body no-pad">' + buildHistoryHtml(history) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      const backBtn = container.querySelector('#details-back-btn');
      if (backBtn && callbacks && callbacks.onBack) {
        backBtn.addEventListener('click', callbacks.onBack);
      }

      const statusSelect = container.querySelector('#detail-status-select');
      const rangeInput = container.querySelector('#detail-progress-range');
      const numberInput = container.querySelector('#detail-progress-number');

      if (rangeInput && numberInput) {
        rangeInput.addEventListener('input', function () {
          numberInput.value = rangeInput.value;
        });
        numberInput.addEventListener('input', function () {
          const v = Math.max(0, Math.min(100, parseInt(numberInput.value || '0', 10)));
          rangeInput.value = isNaN(v) ? '0' : String(v);
        });
      }

      if (statusSelect && rangeInput && numberInput) {
        statusSelect.addEventListener('change', function () {
          if (statusSelect.value === 'Completed') {
            rangeInput.value = '100';
            numberInput.value = '100';
          }
        });
      }

      const progressForm = container.querySelector('#task-progress-form');
      if (progressForm) {
        progressForm.addEventListener('submit', function (e) {
          e.preventDefault();
          const nextStatus = statusSelect.value;
          const nextPct = numberInput.value;

          const executeSave = async function () {
            const btn = progressForm.querySelector('button[type="submit"]');
            if (btn) btn.disabled = true;
            const res = await updateTaskStatusAndProgress(latestTask.id, nextStatus, nextPct, session);
            if (btn) btn.disabled = session.role === 'employee' && nextStatus === 'Completed' && res.ok;
            if (!res.ok) {
              UI.showToast(res.error, 'error');
              return;
            }
            UI.showToast('Task progress updated.', 'success');
          };

          if (Storage.getSettings().confirmStatusChange) {
            UI.confirmDialog({
              title: 'Confirm Status Update',
              message:
                'Update task ' +
                (latestTask.taskCode || latestTask.id) +
                ' to "' +
                nextStatus +
                '" (' +
                nextPct +
                '%)?',
              confirmLabel: 'Update',
              onConfirm: executeSave
            });
          } else {
            executeSave();
          }
        });
      }

      const markCompleteBtn = container.querySelector('#detail-mark-complete-btn');
      if (markCompleteBtn) {
        markCompleteBtn.addEventListener('click', async function () {
          markCompleteBtn.disabled = true;
          const res = await updateTaskStatusAndProgress(latestTask.id, 'Completed', 100, session);
          markCompleteBtn.disabled = false;
          if (!res.ok) {
            UI.showToast(res.error, 'error');
            return;
          }
          UI.showToast('Task marked as Completed.', 'success');
        });
      }

      const commentForm = container.querySelector('#task-comment-form');
      if (commentForm) {
        commentForm.addEventListener('submit', async function (e) {
          e.preventDefault();
          const input = container.querySelector('#detail-comment-input');
          const btn = commentForm.querySelector('button[type="submit"]');
          if (btn) btn.disabled = true;
          const res = await addTaskComment(latestTask.id, input.value, session);
          if (btn) btn.disabled = false;
          if (!res.ok) {
            UI.showToast(res.error, 'error');
            return;
          }
          input.value = '';
          UI.showToast('Comment posted.', 'success');
        });
      }

      if (session.role === 'admin') {
        const editBtn = container.querySelector('#detail-edit-task-btn');
        if (editBtn && callbacks && callbacks.onEditTask) {
          editBtn.addEventListener('click', function () {
            if (latestTask) callbacks.onEditTask(latestTask);
          });
        }
        const deleteBtn = container.querySelector('#detail-delete-task-btn');
        if (deleteBtn && callbacks && callbacks.onDeleteTask) {
          deleteBtn.addEventListener('click', function () {
            if (latestTask) callbacks.onDeleteTask(latestTask);
          });
        }
      }
    },
    function (err) {
      container.innerHTML =
        '<div class="panel"><div class="panel-body">' +
        UI.emptyStateHtml(
          'Access restricted',
          (err && err.message) || 'You do not have permission to view this task.',
          '<button type="button" class="btn btn-secondary" id="details-back-btn">Go Back</button>'
        ) +
        '</div></div>';
      const backErrBtn = container.querySelector('#details-back-btn');
      if (backErrBtn && callbacks && callbacks.onBack) {
        backErrBtn.addEventListener('click', callbacks.onBack);
      }
    }
  );

  return unsubscribe;
}

/* ---------------- Shared Notifications Page ---------------- */
export function renderNotificationsView(container, session, callbacks) {
  const list = (callbacks && Array.isArray(callbacks.notifications)) ? callbacks.notifications : [];
  const unreadCount = list.filter(function (n) { return !n.read; }).length;
  const readCount = list.length - unreadCount;

  const contentHtml =
    list.length === 0
      ? '<div class="panel"><div class="panel-body">' +
          UI.emptyStateHtml(
            'No notifications available.',
            'Task assignments, status changes, and comments will appear here.'
          ) +
        '</div></div>'
      : '<div class="notifications-list">' +
        list
          .map(function (n) {
            return (
              '<div class="notification-card' + (n.read ? '' : ' is-unread') + '">' +
                '<div class="notification-left">' +
                  '<div class="notification-icon-box" aria-hidden="true">' +
                    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                      '<polyline points="23 4 23 10 17 10"></polyline>' +
                      '<polyline points="1 20 1 14 7 14"></polyline>' +
                      '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>' +
                    '</svg>' +
                  '</div>' +
                  '<div class="notification-body">' +
                    '<div class="notification-message">' + UI.escapeHtml(n.message || n.title) + '</div>' +
                    '<div class="notification-date">' + UI.escapeHtml(UI.formatDateTime(n.createdAt)) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="notification-actions">' +
                  (n.taskId
                    ? '<button type="button" class="btn btn-secondary btn-sm notif-view-task" data-task-id="' +
                      UI.escapeHtml(n.taskId) +
                      '" data-notif-id="' +
                      UI.escapeHtml(n.id) +
                      '">View Task</button>'
                    : '') +
                  (!n.read
                    ? '<button type="button" class="btn btn-ghost btn-sm notif-mark-read" data-notif-id="' +
                      UI.escapeHtml(n.id) +
                      '">Mark read</button>'
                    : '') +
                '</div>' +
              '</div>'
            );
          })
          .join('') +
        '</div>';

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Notifications</h1>' +
        '<p class="page-subtitle">Real-time activity across your tasks</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-secondary" id="notif-mark-all-btn"' +
          (unreadCount === 0 ? ' disabled' : '') +
        '>Mark all as read</button>' +
        (readCount > 0 ? '<button type="button" class="btn btn-ghost" id="notif-clear-read-btn">Clear read</button>' : '') +
      '</div>' +
    '</div>' +
    contentHtml;

  const markAllBtn = container.querySelector('#notif-mark-all-btn');
  if (markAllBtn && unreadCount > 0) {
    markAllBtn.addEventListener('click', async function () {
      markAllBtn.disabled = true;
      try {
        await API.markAllNotificationsRead(session.uid);
        UI.showToast('All notifications marked as read.', 'success');
      } catch (err) {
        markAllBtn.disabled = false;
        UI.showToast(err.message || 'Failed to update notifications.', 'error');
      }
    });
  }

  const clearReadBtn = container.querySelector('#notif-clear-read-btn');
  if (clearReadBtn) {
    clearReadBtn.addEventListener('click', function () {
      UI.confirmDialog({
        title: 'Clear Read Notifications',
        message: 'Remove all read notifications from your inbox?',
        confirmLabel: 'Clear Read',
        confirmVariant: 'danger',
        onConfirm: async function () {
          try {
            await API.clearReadNotifications(session.uid);
            UI.showToast('Read notifications cleared.', 'info');
          } catch (err) {
            UI.showToast(err.message || 'Failed to clear notifications.', 'error');
          }
        }
      });
    });
  }

  const markButtons = container.querySelectorAll('.notif-mark-read');
  for (let i = 0; i < markButtons.length; i++) {
    markButtons[i].addEventListener('click', async function (e) {
      const id = e.currentTarget.getAttribute('data-notif-id');
      try {
        await API.markNotificationRead(id);
      } catch (err) {
        UI.showToast(err.message || 'Could not mark notification read.', 'error');
      }
    });
  }

  const viewTaskButtons = container.querySelectorAll('.notif-view-task');
  for (let j = 0; j < viewTaskButtons.length; j++) {
    viewTaskButtons[j].addEventListener('click', async function (e) {
      const tId = e.currentTarget.getAttribute('data-task-id');
      const nId = e.currentTarget.getAttribute('data-notif-id');
      try {
        await API.markNotificationRead(nId);
      } catch (_err) {
        // Proceed opening task even if mark read fails
      }
      if (callbacks && callbacks.onOpenTask) callbacks.onOpenTask(tId);
    });
  }
}

/* ---------------- Reauthentication Helper for Password Change ---------------- */
function openReauthModal(nameVal, newPassVal, onSuccess) {
  UI.openModal({
    title: 'Confirm Current Password',
    size: 'sm',
    bodyHtml:
      '<form id="reauth-form">' +
        '<p style="color:var(--text-secondary); font-size:0.875rem; margin-bottom:12px;">' +
          'For security, enter your current password to confirm changing your password.' +
        '</p>' +
        '<div id="reauth-error" class="form-error-box hidden"></div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="reauth-current-password">Current Password<span class="required-mark">*</span></label>' +
          '<input type="password" id="reauth-current-password" class="form-control" required />' +
        '</div>' +
      '</form>',
    footerHtml:
      '<button type="button" class="btn btn-secondary" id="reauth-cancel-btn">Cancel</button>' +
      '<button type="submit" form="reauth-form" class="btn btn-primary">Confirm &amp; Save</button>',
    onMount: function (overlay) {
      overlay.querySelector('#reauth-cancel-btn').addEventListener('click', UI.closeModal);
      const errBox = overlay.querySelector('#reauth-error');
      const submitBtn = overlay.querySelector('button[type="submit"]');
      overlay.querySelector('#reauth-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        errBox.classList.add('hidden');
        const currentPassword = overlay.querySelector('#reauth-current-password').value;
        if (!currentPassword) {
          errBox.textContent = 'Please enter your current password.';
          errBox.classList.remove('hidden');
          return;
        }
        if (submitBtn) submitBtn.disabled = true;
        const res = await Auth.updateCurrentProfile({
          name: nameVal,
          newPassword: newPassVal,
          currentPassword
        });
        if (submitBtn) submitBtn.disabled = false;
        if (!res.ok) {
          errBox.textContent = res.error;
          errBox.classList.remove('hidden');
          return;
        }
        UI.closeModal();
        onSuccess(res.session);
      });
    }
  });
}

/* ---------------- Shared Profile Page ---------------- */
export function renderProfileView(container, session, callbacks) {
  const roleText = session.role === 'admin' ? 'Administrator' : 'Employee';
  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Profile</h1>' +
        '<p class="page-subtitle">Your account details</p>' +
      '</div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-secondary" id="profile-open-settings-btn">Workspace Settings</button>' +
      '</div>' +
    '</div>' +
    '<div class="profile-layout">' +
      '<div class="panel">' +
        '<div class="panel-body">' +
          '<div class="profile-hero">' +
            '<span class="user-avatar-circle avatar-lg" aria-hidden="true">' + UI.escapeHtml(UI.getInitials(session.name)) + '</span>' +
            '<div>' +
              '<div class="profile-hero-name">' + UI.escapeHtml(session.name) + '</div>' +
              '<div class="profile-hero-role">' + UI.escapeHtml(roleText) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="profile-details-grid">' +
            '<div>' +
              '<div class="profile-field-label">Email</div>' +
              '<div class="profile-field-value">' + UI.escapeHtml(session.email) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="profile-field-label">Department</div>' +
              '<div class="profile-field-value">' + UI.escapeHtml(session.department || 'Management') + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="profile-field-label">Role</div>' +
              '<div class="profile-field-value">' + UI.escapeHtml(roleText) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="profile-field-label">Storage</div>' +
              '<div class="profile-field-value">Cloud Firestore (Firebase Auth)</div>' +
            '</div>' +
            '<div>' +
              '<div class="profile-field-label">Account ID</div>' +
              '<div class="profile-field-value mono">' + UI.escapeHtml(session.employeeId || session.id) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="profile-field-label">Designation</div>' +
              '<div class="profile-field-value">' + UI.escapeHtml(session.designation || roleText) + '</div>' +
            '</div>' +
          '</div>' +
          '<p class="profile-storage-note">Your profile, tasks, and activity history are securely synced in real time via Cloud Firestore.</p>' +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-header"><h2 class="panel-title">Update Account</h2></div>' +
        '<div class="panel-body">' +
          '<form id="profile-update-form">' +
            '<div id="profile-form-error" class="form-error-box hidden"></div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="profile-name">Full Name<span class="required-mark">*</span></label>' +
              '<input type="text" id="profile-name" class="form-control" value="' + UI.escapeHtml(session.name) + '" required>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="profile-password">New Password (Optional)</label>' +
              '<input type="password" id="profile-password" class="form-control" placeholder="Leave blank to keep current password">' +
              '<span class="form-hint">Minimum 6 characters if updating.</span>' +
            '</div>' +
            '<div style="display:flex; justify-content:flex-end;">' +
              '<button type="submit" class="btn btn-primary">Save Changes</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>' +
    '</div>';

  const openSettingsBtn = container.querySelector('#profile-open-settings-btn');
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', function () {
      window.location.hash = '#settings';
    });
  }

  const form = container.querySelector('#profile-update-form');
  const errorBox = container.querySelector('#profile-form-error');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorBox.classList.add('hidden');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      const nameVal = container.querySelector('#profile-name').value;
      const passVal = container.querySelector('#profile-password').value;

      const res = await Auth.updateCurrentProfile({
        name: nameVal,
        newPassword: passVal
      });
      if (submitBtn) submitBtn.disabled = false;

      if (!res.ok) {
        if (res.code === 'auth/requires-recent-login' && passVal) {
          openReauthModal(nameVal, passVal, function (updatedSession) {
            UI.showToast('Profile and password updated successfully.', 'success');
            if (callbacks && callbacks.onProfileUpdated) {
              callbacks.onProfileUpdated(updatedSession);
            }
          });
          return;
        }
        errorBox.textContent = res.error;
        errorBox.classList.remove('hidden');
        return;
      }
      UI.showToast('Profile updated successfully.', 'success');
      if (callbacks && callbacks.onProfileUpdated) {
        callbacks.onProfileUpdated(res.session);
      }
    });
  }
}

/* ---------------- Shared Settings Page ---------------- */
export function renderSettingsView(container, session) {
  const settings = Storage.getSettings();

  const dataManagementHtml =
    session.role === 'admin'
      ? '<div class="panel">' +
          '<div class="panel-header"><h2 class="panel-title">Workspace Data Management</h2></div>' +
          '<div class="panel-body">' +
            '<div class="setting-row">' +
              '<div class="setting-info">' +
                '<h4>Export Workspace Data</h4>' +
                '<p>Download a JSON backup of employees, tasks, notifications, and activity history from Cloud Firestore.</p>' +
              '</div>' +
              '<button type="button" class="btn btn-secondary" id="settings-export-btn">Export JSON</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      : '';

  container.innerHTML =
    '<div class="page-header">' +
      '<div>' +
        '<h1 class="page-title">Settings</h1>' +
        '<p class="page-subtitle">Configure display preferences and workspace options.</p>' +
      '</div>' +
    '</div>' +
    '<div class="settings-grid">' +
      '<div class="panel">' +
        '<div class="panel-header"><h2 class="panel-title">Interface Preferences</h2></div>' +
        '<div class="panel-body">' +
          '<div class="setting-row">' +
            '<div class="setting-info">' +
              '<h4>Compact Table Density</h4>' +
              '<p>Reduce vertical row padding to show more records per screen.</p>' +
            '</div>' +
            '<input type="checkbox" class="switch-input" id="setting-compact-tables" ' +
              (settings.compactTables ? 'checked' : '') +
              ' aria-label="Compact table density">' +
          '</div>' +
          '<div class="setting-row">' +
            '<div class="setting-info">' +
              '<h4>Confirm Status Updates</h4>' +
              '<p>Ask for confirmation before saving task status or progress changes.</p>' +
            '</div>' +
            '<input type="checkbox" class="switch-input" id="setting-confirm-status" ' +
              (settings.confirmStatusChange ? 'checked' : '') +
              ' aria-label="Confirm status updates">' +
          '</div>' +
          '<div class="setting-row">' +
            '<div class="setting-info">' +
              '<h4>Date Format</h4>' +
              '<p>Choose how dates appear across tables and task metadata.</p>' +
            '</div>' +
            '<select id="setting-date-format" class="filter-select" aria-label="Date format">' +
              '<option value="medium"' + (settings.dateFormat === 'medium' ? ' selected' : '') + '>Nov 26, 2026</option>' +
              '<option value="iso"' + (settings.dateFormat === 'iso' ? ' selected' : '') + '>2026-11-26</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</div>' +
      dataManagementHtml +
    '</div>';

  const compactEl = container.querySelector('#setting-compact-tables');
  const confirmEl = container.querySelector('#setting-confirm-status');
  const dateFormatEl = container.querySelector('#setting-date-format');

  function savePrefs() {
    Storage.saveSettings({
      compactTables: compactEl.checked,
      confirmStatusChange: confirmEl.checked,
      dateFormat: dateFormatEl.value
    });
    UI.applySettingsToBody();
    UI.showToast('Preferences saved.', 'success');
  }

  compactEl.addEventListener('change', savePrefs);
  confirmEl.addEventListener('change', savePrefs);
  dateFormatEl.addEventListener('change', savePrefs);

  if (session.role === 'admin') {
    const exportBtn = container.querySelector('#settings-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async function () {
        exportBtn.disabled = true;
        try {
          const exportData = await API.exportWorkspace();
          const payload = JSON.stringify(exportData, null, 2);
          const blob = new Blob([payload], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'taskflow-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          UI.showToast('Workspace data exported.', 'success');
        } catch (err) {
          UI.showToast(err.message || 'Failed to export workspace data.', 'error');
        } finally {
          exportBtn.disabled = false;
        }
      });
    }
  }
}

export const Tasks = {
  TASK_STATUSES,
  TASK_PRIORITIES,
  updateTaskStatusAndProgress,
  addTaskComment,
  renderTaskDetailsView,
  renderNotificationsView,
  renderProfileView,
  renderSettingsView
};

window.CTM = window.CTM || {};
window.CTM.Tasks = Tasks;
