/**
 * Adversarial "Dirty Dozen" Security Rules Verification Spec
 * Maps each attack vector from security_spec.md to the rule invariant that rejects it.
 *
 * Run against Firebase Emulator Suite when `@firebase/rules-unit-testing` is configured:
 *   firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  enforcedByRule: string;
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Task List',
    collectionPath: 'tasks',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'allow list: if isSignedIn() && (resource.data.assignedTo == request.auth.uid || isAdmin())',
    payload: {},
  },
  {
    id: 2,
    name: 'Public Admin Self-Registration After Bootstrap',
    collectionPath: 'users/attackerUid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: '!exists(/databases/$(database)/documents/meta/workspace) && existsAfter(/databases/$(database)/documents/meta/workspace)',
    payload: {
      uid: 'attackerUid',
      employeeId: 'ADM-999',
      name: 'Rogue Admin',
      email: 'rogue@company.com',
      role: 'admin',
      department: 'Security',
      designation: 'Admin',
      joiningDate: '2026-11-27',
      status: 'Active',
    },
  },
  {
    id: 3,
    name: 'Employee Role Escalation Update',
    collectionPath: 'users/empUid1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().role == existing().role && incoming().diff(existing()).affectedKeys().hasOnly(["name", "updatedAt"])',
    payload: {role: 'admin'},
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Task',
    collectionPath: 'tasks/task1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidTask(incoming()) -> keys().hasOnly([...])',
    payload: {
      taskCode: 'TSK-001',
      title: 'Test',
      description: 'Desc',
      isVerifiedOverride: true,
    },
  },
  {
    id: 5,
    name: 'Unverified Email Spoofing Admin Email',
    collectionPath: 'users',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: "isBootstrappedAdmin() requires request.auth.token.email_verified == true",
    payload: {email: 'karthick.contact.in@gmail.com', email_verified: false},
  },
  {
    id: 6,
    name: 'PII Blanket Read of Another Employee',
    collectionPath: 'users/empUid2',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'allow get: if isSignedIn() && isValidId(userId) && (isOwner(userId) || isAdmin())',
    payload: {},
  },
  {
    id: 7,
    name: 'Unconstrained Task Scrape by Employee',
    collectionPath: 'tasks',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'allow list: if isSignedIn() && (resource.data.assignedTo == request.auth.uid || isAdmin())',
    payload: {},
  },
  {
    id: 8,
    name: 'Employee Reassigning Task or Changing Due Date',
    collectionPath: 'tasks/task1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: "incoming().diff(existing()).affectedKeys().hasOnly(['status', 'progress', 'updatedAt'])",
    payload: {assignedTo: 'empUid2', dueDate: '2027-01-01'},
  },
  {
    id: 9,
    name: 'Employee Mutating Completed Task (Terminal State Lock)',
    collectionPath: 'tasks/completedTask1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: "existing().status != 'Completed'",
    payload: {status: 'In Progress', progress: 50},
  },
  {
    id: 10,
    name: 'Out-of-Bounds Progress Type/Range Poisoning',
    collectionPath: 'tasks/task1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: '(data.progress is int || data.progress is float) && data.progress >= 0 && data.progress <= 100',
    payload: {status: 'In Progress', progress: 999},
  },
  {
    id: 11,
    name: 'Document ID Poisoning',
    collectionPath: 'tasks/invalid$id!999',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: "isValidId(taskId) -> id.matches('^[a-zA-Z0-9_\\\\-]+$')",
    payload: {title: 'Poisoned ID'},
  },
  {
    id: 12,
    name: 'Forged Timestamp & Cross-User Notification Spoof',
    collectionPath: 'notifications/notif1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().actorId == request.auth.uid && incoming().createdAt == request.time',
    payload: {
      recipientId: 'empUid2',
      actorId: 'adminUid',
      read: true,
      createdAt: '2020-01-01T00:00:00Z',
    },
  },
];
