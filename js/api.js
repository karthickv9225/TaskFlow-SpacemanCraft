/**
 * Firebase Authentication & Cloud Firestore Data Layer for TaskFlow.
 * Enforces blueprint constraints, structured Firestore error handling,
 * and real-time onSnapshot listeners across Admin & Employee dashboards.
 */
import {
  EmailAuthProvider,
  OperationType,
  addDoc,
  auth,
  collection,
  createEmployeeAuthUser,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  doc,
  firebaseConfig,
  getDoc,
  getDocs,
  handleFirestoreError,
  onSnapshot,
  query,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  where,
  writeBatch
} from './firebase.js';

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toIso(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function clampString(val, maxLen) {
  return String(val || '').trim().slice(0, maxLen);
}

function mapUserDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    uid: data.uid || snap.id,
    employeeId: data.employeeId || '',
    name: data.name || '',
    email: data.email || '',
    role: data.role || 'employee',
    department: data.department || '',
    designation: data.designation || '',
    joiningDate: data.joiningDate || '',
    status: data.status || 'Active',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt)
  };
}

function mapTaskDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    taskCode: data.taskCode || snap.id,
    title: data.title || '',
    description: data.description || '',
    assignedTo: data.assignedTo || '',
    assignedToName: data.assignedToName || 'Unassigned',
    assignedEmployeeCode: data.assignedEmployeeCode || '',
    createdBy: data.createdBy || '',
    priority: data.priority || 'Medium',
    status: data.status || 'To Do',
    startDate: data.startDate || '',
    dueDate: data.dueDate || '',
    progress: Number(data.progress || 0),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt)
  };
}

function mapNotificationDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    recipientId: data.recipientId || '',
    taskId: data.taskId || '',
    title: data.title || '',
    message: data.message || '',
    type: data.type || 'task_updated',
    read: Boolean(data.read),
    actorId: data.actorId || '',
    createdAt: toIso(data.createdAt)
  };
}

function mapCommentDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    taskId: data.taskId || '',
    authorId: data.authorId || '',
    authorName: data.authorName || '',
    authorRole: data.authorRole || 'employee',
    message: data.message || '',
    createdAt: toIso(data.createdAt)
  };
}

function mapActivityDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    taskId: data.taskId || '',
    assignedTo: data.assignedTo || '',
    taskOwnerId: data.taskOwnerId || '',
    actorId: data.actorId || '',
    actorName: data.actorName || '',
    action: data.action || '',
    createdAt: toIso(data.createdAt)
  };
}

function sortDescByCreatedAt(items) {
  return [...items].sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });
}

function sortAscByCreatedAt(items) {
  return [...items].sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tA - tB;
  });
}

function formatFirebaseAuthError(err) {
  const code = err && err.code ? err.code : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many failed sign-in attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled in Firebase Authentication.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is disabled in Firebase Console. Enable Email/Password under Authentication -> Sign-in method.';
    case 'auth/network-request-failed':
      return 'Network error communicating with Firebase. Check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'Please re-enter your current password to complete this security-sensitive update.';
    default:
      return (err && err.message) || 'Authentication request failed.';
  }
}

export async function getAuthStatus() {
  const configured = Boolean(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);
  if (!configured) {
    return {
      firebaseConnected: false,
      firebaseConfigured: false,
      adminInitialized: false,
      error: 'Firebase configuration is missing.'
    };
  }
  try {
    const snap = await getDoc(doc(db, 'meta', 'workspace'));
    return {
      firebaseConnected: true,
      firebaseConfigured: true,
      adminInitialized: snap.exists()
    };
  } catch (err) {
    return {
      firebaseConnected: false,
      firebaseConfigured: true,
      adminInitialized: false,
      error: err && err.message ? err.message : 'Unable to reach Cloud Firestore.'
    };
  }
}

export async function setupAdmin(payload) {
  const name = clampString(payload && payload.name, 100);
  const email = clampString(payload && payload.email, 254).toLowerCase();
  const password = String((payload && payload.password) || '');

  if (!name || !email || password.length < 6) {
    throw new Error('Administrator name, valid email, and password (min 6 characters) are required.');
  }

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }

  const user = credential.user;
  try {
    await updateProfile(user, { displayName: name });
  } catch (_err) {
    // Non-fatal display name sync
  }

  const today = new Date().toISOString().slice(0, 10);
  const batch = writeBatch(db);
  batch.set(doc(db, 'meta', 'workspace'), {
    adminInitialized: true,
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, 'users', user.uid), {
    uid: user.uid,
    employeeId: 'ADM-001',
    name,
    email,
    role: 'admin',
    department: 'Management',
    designation: 'Administrator',
    joiningDate: today,
    status: 'Active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  try {
    await batch.commit();
  } catch (err) {
    // Roll back auth creation if workspace was already initialized by someone else
    try {
      await signOut(auth);
    } catch (_e) {
      // ignore
    }
    handleFirestoreError(err, OperationType.WRITE, 'meta/workspace');
  }

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  return { user: mapUserDoc(userSnap) };
}

export async function login(email, password) {
  const cleanEmail = clampString(email, 254).toLowerCase();
  const cleanPassword = String(password || '');

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }

  const uid = credential.user.uid;
  let userSnap;
  try {
    userSnap = await getDoc(doc(db, 'users', uid));
  } catch (err) {
    await signOut(auth);
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  if (!userSnap.exists()) {
    await signOut(auth);
    throw new Error('Your account profile was not found. Ask an administrator to add your account.');
  }

  const user = mapUserDoc(userSnap);
  if (user.status === 'Inactive') {
    await signOut(auth);
    throw new Error('Your account has been deactivated. Contact an administrator.');
  }

  return { user };
}

export async function logout() {
  await signOut(auth);
}

export async function getMe() {
  await auth.authStateReady();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { user: null };
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    if (!userSnap.exists()) {
      await signOut(auth);
      return { user: null };
    }
    const user = mapUserDoc(userSnap);
    if (user.status === 'Inactive') {
      await signOut(auth);
      return { user: null };
    }
    return { user };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`);
  }
}

export async function updateCurrentProfile(payload) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to update your profile.');
  }

  const name = clampString(payload && payload.name, 100);
  if (!name) {
    throw new Error('Full name is required.');
  }

  const newPassword = payload && payload.newPassword ? String(payload.newPassword) : '';
  const currentPassword = payload && payload.currentPassword ? String(payload.currentPassword) : '';

  if (newPassword && newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  if (newPassword) {
    try {
      if (currentPassword && currentUser.email) {
        const cred = EmailAuthProvider.credential(currentUser.email, currentPassword);
        await reauthenticateWithCredential(currentUser, cred);
      }
      await updatePassword(currentUser, newPassword);
    } catch (err) {
      const error = new Error(formatFirebaseAuthError(err));
      error.code = err && err.code ? err.code : '';
      throw error;
    }
  }

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      name,
      updatedAt: serverTimestamp()
    });
    await updateProfile(currentUser, { displayName: name });
    const updatedSnap = await getDoc(doc(db, 'users', currentUser.uid));
    return { user: mapUserDoc(updatedSnap) };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
  }
}

export function computeEmployeeStats(employees, tasks) {
  const today = new Date().toISOString().slice(0, 10);
  return employees.map((emp) => {
    const empTasks = tasks.filter((t) => t.assignedTo === emp.id);
    const totalTasks = empTasks.length;
    const completedTasks = empTasks.filter((t) => t.status === 'Completed').length;
    const overdueTasks = empTasks.filter(
      (t) => t.status !== 'Completed' && t.dueDate && String(t.dueDate).slice(0, 10) < today
    ).length;
    const avgCompletion =
      totalTasks > 0
        ? Math.round(empTasks.reduce((sum, t) => sum + Number(t.progress || 0), 0) / totalTasks)
        : 0;
    return {
      ...emp,
      stats: { totalTasks, completedTasks, overdueTasks, avgCompletion }
    };
  });
}

export function computeDashboardCounts(employees, tasks, notifications) {
  const unreadNotifications = (notifications || []).filter((n) => !n.read).length;
  const totalEmployees = (employees || []).length;
  const totalTasks = (tasks || []).length;
  const pendingTasks = (tasks || []).filter((t) => t.status === 'To Do' || t.status === 'Pending').length;
  const inProgressTasks = (tasks || []).filter((t) => t.status === 'In Progress' || t.status === 'Review').length;
  const blockedTasks = (tasks || []).filter((t) => t.status === 'Blocked').length;
  const completedTasks = (tasks || []).filter((t) => t.status === 'Completed').length;

  return {
    totalEmployees,
    totalTasks,
    myTotalTasks: totalTasks,
    pendingTasks,
    inProgressTasks,
    blockedTasks,
    completedTasks,
    unreadNotifications
  };
}

export function subscribeEmployees(onData, onError) {
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const all = snapshot.docs.map(mapUserDoc).filter((u) => u.role === 'employee');
      onData(sortDescByCreatedAt(all));
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'users');
    }
  );
}

export function subscribeTasks(session, onData, onError) {
  const ref =
    session.role === 'admin'
      ? collection(db, 'tasks')
      : query(collection(db, 'tasks'), where('assignedTo', '==', session.uid));

  return onSnapshot(
    ref,
    (snapshot) => {
      onData(sortDescByCreatedAt(snapshot.docs.map(mapTaskDoc)));
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'tasks');
    }
  );
}

export function subscribeNotifications(session, onData, onError) {
  const ref = query(collection(db, 'notifications'), where('recipientId', '==', session.uid));
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(sortDescByCreatedAt(snapshot.docs.map(mapNotificationDoc)));
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'notifications');
    }
  );
}

export function subscribeTaskDetails(taskId, onData, onError) {
  let taskState = undefined;
  let commentsState = [];
  let activitiesState = [];
  let taskLoaded = false;

  const emit = () => {
    if (!taskLoaded) return;
    onData({
      task: taskState,
      comments: sortAscByCreatedAt(commentsState),
      activities: sortDescByCreatedAt(activitiesState)
    });
  };

  const unsubTask = onSnapshot(
    doc(db, 'tasks', taskId),
    (snap) => {
      taskLoaded = true;
      taskState = snap.exists() ? mapTaskDoc(snap) : null;
      emit();
    },
    (err) => {
      if (onError) onError(err);
    }
  );

  const unsubComments = onSnapshot(
    collection(db, 'tasks', taskId, 'comments'),
    (snap) => {
      commentsState = snap.docs.map(mapCommentDoc);
      emit();
    },
    (err) => {
      if (onError) onError(err);
    }
  );

  const unsubActivities = onSnapshot(
    query(collection(db, 'taskActivities'), where('taskId', '==', taskId)),
    (snap) => {
      activitiesState = snap.docs.map(mapActivityDoc);
      emit();
    },
    (err) => {
      if (onError) onError(err);
    }
  );

  return () => {
    unsubTask();
    unsubComments();
    unsubActivities();
  };
}

export async function listEmployees() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const list = snap.docs.map(mapUserDoc).filter((u) => u.role === 'employee');
    return { employees: sortDescByCreatedAt(list) };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function getNextEmployeeId() {
  const { employees } = await listEmployees();
  let maxNum = 0;
  for (const emp of employees) {
    const m = /^EMP-(\d+)$/i.exec(emp.employeeId || '');
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = String(maxNum + 1).padStart(3, '0');
  return { nextEmployeeId: `EMP-${next}` };
}

export async function createEmployee(payload) {
  const employeeId = clampString(payload.employeeId, 32).toUpperCase();
  const name = clampString(payload.name, 100);
  const email = clampString(payload.email, 254).toLowerCase();
  const password = String(payload.password || '');
  const department = clampString(payload.department, 80);
  const designation = clampString(payload.designation, 80);
  const joiningDate = clampString(payload.joiningDate, 10);
  const status = payload.status === 'Inactive' ? 'Inactive' : 'Active';

  if (!ID_PATTERN.test(employeeId)) {
    throw new Error('Employee ID may only contain letters, numbers, hyphens, and underscores.');
  }
  if (!DATE_PATTERN.test(joiningDate)) {
    throw new Error('Joining date must use YYYY-MM-DD format.');
  }
  if (!name || !email || !department || !designation || password.length < 6) {
    throw new Error('Please fill in all required employee fields (password min 6 chars).');
  }

  const { employees } = await listEmployees();
  if (employees.some((e) => (e.employeeId || '').toUpperCase() === employeeId)) {
    throw new Error(`Employee ID ${employeeId} is already in use.`);
  }
  if (employees.some((e) => (e.email || '').toLowerCase() === email)) {
    throw new Error(`An employee with email ${email} already exists.`);
  }

  let newUid;
  try {
    newUid = await createEmployeeAuthUser(email, password);
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }

  try {
    await setDoc(doc(db, 'users', newUid), {
      uid: newUid,
      employeeId,
      name,
      email,
      role: 'employee',
      department,
      designation,
      joiningDate,
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const createdSnap = await getDoc(doc(db, 'users', newUid));
    return { employee: mapUserDoc(createdSnap) };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${newUid}`);
  }
}

export async function updateEmployee(uid, updates) {
  const name = clampString(updates.name, 100);
  const email = clampString(updates.email, 254).toLowerCase();
  const department = clampString(updates.department, 80);
  const designation = clampString(updates.designation, 80);
  const joiningDate = clampString(updates.joiningDate, 10);
  const status = updates.status === 'Inactive' ? 'Inactive' : 'Active';

  try {
    const existingSnap = await getDoc(doc(db, 'users', uid));
    if (!existingSnap.exists()) {
      throw new Error('Employee record not found.');
    }
    const current = mapUserDoc(existingSnap);

    const nextFields = {
      name: name || current.name,
      email: email || current.email,
      department: department || current.department,
      designation: designation || current.designation,
      joiningDate: DATE_PATTERN.test(joiningDate) ? joiningDate : current.joiningDate,
      status: updates.status ? status : current.status,
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), nextFields);

    if (nextFields.name !== current.name) {
      const assignedSnap = await getDocs(query(collection(db, 'tasks'), where('assignedTo', '==', uid)));
      assignedSnap.docs.forEach((taskDoc) => {
        batch.update(taskDoc.ref, {
          assignedToName: nextFields.name,
          updatedAt: serverTimestamp()
        });
      });
    }

    await batch.commit();
    const updatedSnap = await getDoc(doc(db, 'users', uid));
    return { employee: mapUserDoc(updatedSnap) };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function sendEmployeePasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, String(email || '').trim().toLowerCase());
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function deleteEmployee(uid) {
  try {
    const assignedSnap = await getDocs(query(collection(db, 'tasks'), where('assignedTo', '==', uid)));
    const batch = writeBatch(db);
    assignedSnap.docs.forEach((taskDoc) => {
      batch.update(taskDoc.ref, {
        assignedTo: '',
        assignedToName: 'Unassigned',
        assignedEmployeeCode: '',
        updatedAt: serverTimestamp()
      });
    });
    batch.delete(doc(db, 'users', uid));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }
}

export async function getEmployeeDetails(uid) {
  try {
    const [empSnap, taskSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid)),
      getDocs(query(collection(db, 'tasks'), where('assignedTo', '==', uid)))
    ]);
    if (!empSnap.exists()) {
      throw new Error('Employee not found.');
    }
    return {
      employee: mapUserDoc(empSnap),
      tasks: sortDescByCreatedAt(taskSnap.docs.map(mapTaskDoc))
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
}

export async function getNextTaskCode() {
  try {
    const snap = await getDocs(collection(db, 'tasks'));
    let maxNum = 0;
    snap.docs.forEach((d) => {
      const code = (d.data() && d.data().taskCode) || '';
      const m = /^TSK-(\d+)$/i.exec(code);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return { nextTaskCode: `TSK-${String(maxNum + 1).padStart(3, '0')}` };
  } catch (_err) {
    return { nextTaskCode: 'TSK-001' };
  }
}

export async function createTask(payload, session) {
  const taskCode = clampString(payload.taskCode, 32).toUpperCase();
  const title = clampString(payload.title, 160);
  const description = clampString(payload.description, 4000);
  const assignedTo = clampString(payload.assignedTo, 128);
  const priority = ['Low', 'Medium', 'High'].includes(payload.priority) ? payload.priority : 'Medium';
  const status = ['To Do', 'In Progress', 'Review', 'Blocked', 'Completed'].includes(payload.status)
    ? payload.status
    : 'To Do';
  const startDate = clampString(payload.startDate, 10);
  const dueDate = clampString(payload.dueDate, 10);
  const progress = status === 'Completed' ? 100 : Math.max(0, Math.min(100, Number(payload.progress) || 0));

  if (!ID_PATTERN.test(taskCode)) {
    throw new Error('Task ID may only contain letters, numbers, hyphens, and underscores.');
  }
  if (!title || !description || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(dueDate)) {
    throw new Error('Please complete all required task fields.');
  }
  if (dueDate < startDate) {
    throw new Error('Due date cannot be earlier than start date.');
  }

  let assignedToName = 'Unassigned';
  let assignedEmployeeCode = '';
  if (assignedTo) {
    try {
      const empSnap = await getDoc(doc(db, 'users', assignedTo));
      if (!empSnap.exists()) {
        throw new Error('Selected employee does not exist.');
      }
      const empData = mapUserDoc(empSnap);
      assignedToName = empData.name;
      assignedEmployeeCode = empData.employeeId;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${assignedTo}`);
    }
  }

  const taskRef = doc(collection(db, 'tasks'));
  const taskPayload = {
    taskCode,
    title,
    description,
    assignedTo,
    assignedToName,
    assignedEmployeeCode,
    createdBy: session.uid,
    priority,
    status,
    startDate,
    dueDate,
    progress,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(taskRef, taskPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `tasks/${taskRef.id}`);
  }

  const actionText = assignedTo
    ? `Created task ${taskCode} (${priority} priority) and assigned to ${assignedToName}`
    : `Created unassigned task ${taskCode} (${priority} priority)`;

  try {
    await addDoc(collection(db, 'taskActivities'), {
      taskId: taskRef.id,
      assignedTo,
      taskOwnerId: session.uid,
      actorId: session.uid,
      actorName: clampString(session.name, 100),
      action: clampString(actionText, 400),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'taskActivities');
  }

  if (assignedTo && assignedTo !== session.uid) {
    try {
      await addDoc(collection(db, 'notifications'), {
        recipientId: assignedTo,
        taskId: taskRef.id,
        title: 'New Task Assigned',
        message: clampString(`${session.name} assigned you ${taskCode}: ${title}`, 500),
        type: 'task_assigned',
        read: false,
        actorId: session.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  }

  return { id: taskRef.id };
}

export async function updateTask(taskId, payload, session) {
  let existing;
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (!snap.exists()) throw new Error('Task not found.');
    existing = mapTaskDoc(snap);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `tasks/${taskId}`);
  }

  const title = clampString(payload.title, 160);
  const description = clampString(payload.description, 4000);
  const assignedTo = clampString(payload.assignedTo, 128);
  const priority = ['Low', 'Medium', 'High'].includes(payload.priority) ? payload.priority : existing.priority;
  const status = ['To Do', 'In Progress', 'Review', 'Blocked', 'Completed'].includes(payload.status)
    ? payload.status
    : existing.status;
  const startDate = clampString(payload.startDate, 10);
  const dueDate = clampString(payload.dueDate, 10);
  const progress = status === 'Completed' ? 100 : Math.max(0, Math.min(100, Number(payload.progress) || 0));

  if (!title || !description || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(dueDate)) {
    throw new Error('Please fill in all required task fields.');
  }
  if (dueDate < startDate) {
    throw new Error('Due date cannot be earlier than start date.');
  }

  let assignedToName = 'Unassigned';
  let assignedEmployeeCode = '';
  if (assignedTo) {
    try {
      const empSnap = await getDoc(doc(db, 'users', assignedTo));
      if (!empSnap.exists()) throw new Error('Selected employee does not exist.');
      const emp = mapUserDoc(empSnap);
      assignedToName = emp.name;
      assignedEmployeeCode = emp.employeeId;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${assignedTo}`);
    }
  }

  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      title,
      description,
      assignedTo,
      assignedToName,
      assignedEmployeeCode,
      priority,
      status,
      startDate,
      dueDate,
      progress,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
  }

  const reassigned = assignedTo !== existing.assignedTo;
  const actionText = reassigned
    ? assignedTo
      ? `Reassigned ${existing.taskCode} to ${assignedToName}`
      : `Unassigned ${existing.taskCode}`
    : `Updated task details (${status}, ${progress}%)`;

  try {
    await addDoc(collection(db, 'taskActivities'), {
      taskId,
      assignedTo,
      taskOwnerId: existing.createdBy,
      actorId: session.uid,
      actorName: clampString(session.name, 100),
      action: clampString(actionText, 400),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'taskActivities');
  }

  if (assignedTo && assignedTo !== session.uid) {
    try {
      await addDoc(collection(db, 'notifications'), {
        recipientId: assignedTo,
        taskId,
        title: reassigned ? 'New Task Assigned' : 'Task Updated',
        message: clampString(
          reassigned
            ? `${session.name} assigned you ${existing.taskCode}: ${title}`
            : `${session.name} updated ${existing.taskCode}: ${title}`,
          500
        ),
        type: reassigned ? 'task_assigned' : 'task_updated',
        read: false,
        actorId: session.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  }
}

export async function updateTaskProgress(taskId, { status, progress }, session) {
  let existing;
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (!snap.exists()) throw new Error('Task not found.');
    existing = mapTaskDoc(snap);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `tasks/${taskId}`);
  }

  const pct = status === 'Completed' ? 100 : Math.max(0, Math.min(100, Number(progress) || 0));

  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      status,
      progress: pct,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
  }

  try {
    await addDoc(collection(db, 'taskActivities'), {
      taskId,
      assignedTo: existing.assignedTo,
      taskOwnerId: existing.createdBy,
      actorId: session.uid,
      actorName: clampString(session.name, 100),
      action: clampString(`Updated status to ${status} (${pct}%)`, 400),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'taskActivities');
  }

  const targetRecipient =
    session.role === 'employee'
      ? existing.createdBy
      : existing.assignedTo && existing.assignedTo !== session.uid
      ? existing.assignedTo
      : '';

  if (targetRecipient) {
    try {
      await addDoc(collection(db, 'notifications'), {
        recipientId: targetRecipient,
        taskId,
        title: 'Task Status Changed',
        message: clampString(
          `${session.name} updated ${existing.taskCode} (${existing.title}) to ${status} (${pct}%)`,
          500
        ),
        type: 'status_changed',
        read: false,
        actorId: session.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  }
}

export async function addTaskComment(taskId, rawMessage, session) {
  const message = clampString(rawMessage, 2000);
  if (!message) {
    throw new Error('Please enter a comment before submitting.');
  }

  let existing;
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (!snap.exists()) throw new Error('Task not found.');
    existing = mapTaskDoc(snap);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `tasks/${taskId}`);
  }

  try {
    await addDoc(collection(db, 'tasks', taskId, 'comments'), {
      taskId,
      authorId: session.uid,
      authorName: clampString(session.name, 100),
      authorRole: session.role === 'admin' ? 'admin' : 'employee',
      message,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'tasks', taskId), {
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `tasks/${taskId}/comments`);
  }

  try {
    await addDoc(collection(db, 'taskActivities'), {
      taskId,
      assignedTo: existing.assignedTo,
      taskOwnerId: existing.createdBy,
      actorId: session.uid,
      actorName: clampString(session.name, 100),
      action: clampString(`Posted a comment: "${message.slice(0, 120)}"`, 400),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'taskActivities');
  }

  const targetRecipient =
    session.role === 'employee'
      ? existing.createdBy
      : existing.assignedTo && existing.assignedTo !== session.uid
      ? existing.assignedTo
      : '';

  if (targetRecipient) {
    try {
      await addDoc(collection(db, 'notifications'), {
        recipientId: targetRecipient,
        taskId,
        title: 'New Task Comment',
        message: clampString(`${session.name} commented on ${existing.taskCode}: "${message.slice(0, 120)}"`, 500),
        type: 'task_comment',
        read: false,
        actorId: session.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  }
}

export async function deleteTask(taskId) {
  try {
    const [commentsSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db, 'tasks', taskId, 'comments')),
      getDocs(query(collection(db, 'taskActivities'), where('taskId', '==', taskId)))
    ]);

    const batch = writeBatch(db);
    commentsSnap.docs.forEach((d) => batch.delete(d.ref));
    activitiesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'tasks', taskId));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
  }
}

export async function markNotificationRead(id) {
  try {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
  }
}

export async function markAllNotificationsRead(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'notifications'), where('recipientId', '==', uid)));
    const batch = writeBatch(db);
    let hasUpdates = false;
    snap.docs.forEach((d) => {
      if (!d.data().read) {
        batch.update(d.ref, { read: true });
        hasUpdates = true;
      }
    });
    if (hasUpdates) await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'notifications');
  }
}

export async function clearReadNotifications(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'notifications'), where('recipientId', '==', uid)));
    const batch = writeBatch(db);
    let hasDeletes = false;
    snap.docs.forEach((d) => {
      if (d.data().read) {
        batch.delete(d.ref);
        hasDeletes = true;
      }
    });
    if (hasDeletes) await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'notifications');
  }
}

export async function exportWorkspace() {
  try {
    const currentUid = auth.currentUser ? auth.currentUser.uid : '';
    const [usersSnap, tasksSnap, notifsSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'tasks')),
      getDocs(query(collection(db, 'notifications'), where('recipientId', '==', currentUid))),
      getDocs(collection(db, 'taskActivities'))
    ]);
    return {
      exportedAt: new Date().toISOString(),
      projectId: firebaseConfig.projectId,
      users: usersSnap.docs.map(mapUserDoc),
      tasks: tasksSnap.docs.map(mapTaskDoc),
      notifications: notifsSnap.docs.map(mapNotificationDoc),
      taskActivities: activitiesSnap.docs.map(mapActivityDoc)
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'workspace-export');
  }
}

export const API = {
  getAuthStatus,
  setupAdmin,
  login,
  logout,
  getMe,
  updateCurrentProfile,
  computeEmployeeStats,
  computeDashboardCounts,
  subscribeEmployees,
  subscribeTasks,
  subscribeNotifications,
  subscribeTaskDetails,
  listEmployees,
  getNextEmployeeId,
  createEmployee,
  updateEmployee,
  sendEmployeePasswordReset,
  deleteEmployee,
  getEmployeeDetails,
  getNextTaskCode,
  createTask,
  updateTask,
  updateTaskProgress,
  addTaskComment,
  deleteTask,
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  exportWorkspace
};

window.CTM = window.CTM || {};
window.CTM.API = API;
