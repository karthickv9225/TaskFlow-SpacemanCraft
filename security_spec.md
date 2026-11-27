# TaskFlow Firestore Security Specification

## 1. Data Invariants
1. **Singleton Admin Bootstrap**: `/meta/workspace` may be created once when it does not yet exist, atomically alongside the first `/users/{uid}` document with `role == 'admin'`. Once created, `/meta/workspace` is immutable (`update`/`delete` forbidden), permanently blocking public admin self-registration.
2. **PII Isolation (`users`)**: User documents contain PII (`email`). `get` is restricted to `isOwner(userId)` or `isAdmin()`, and `list` is restricted to `resource.data.uid == request.auth.uid || isAdmin()`.
3. **Zero Privilege Escalation**: Employees cannot modify `role`, `status`, `email`, `employeeId`, `uid`, or `createdAt` on `/users/{userId}`—only `name` and `updatedAt`. Inactive users (`status != 'Active'`) lose all read/write permissions immediately.
4. **Task Assignment & Terminal State Locking**: Only active Admins can create, reassign, edit metadata, or delete tasks. Assigned active Employees can read their assigned tasks (`resource.data.assignedTo == request.auth.uid`) and update ONLY `status`, `progress`, and `updatedAt`, provided the task has not already reached the terminal `'Completed'` state (Admins retain override capability).
5. **Master Gate on Sub-Resources**: Task comments (`/tasks/{taskId}/comments/{commentId}`) and activity records (`/taskActivities/{activityId}`) validate parent task existence and membership (`get(/databases/$(database)/documents/tasks/$(taskId))`) before allowing writes.
6. **Strict Schema & Server Timestamps**: Every write enforces `keys().hasAll(...)` + `keys().hasOnly(...)`, strict types, string `.size()` bounds, numeric range `[0, 100]` for progress, `isValidId()` path validation, and `createdAt == request.time` / `updatedAt == request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Task List**: Unauthenticated client runs `list` on `/tasks` -> `PERMISSION_DENIED`.
2. **Public Admin Self-Registration**: Authenticated user attempts to create `/users/{uid}` with `role: "admin"` after `/meta/workspace` already exists -> `PERMISSION_DENIED`.
3. **Role Escalation Update**: Authenticated employee updates `/users/{uid}` with `{ role: "admin" }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: User includes an unexpected ghost key (e.g., `isSuperAdmin: true`) in `/tasks/{taskId}` or `/users/{uid}` -> `PERMISSION_DENIED`.
5. **Email Spoofing Without Verification**: Unverified auth token with `email == "karthick.contact.in@gmail.com"` and `email_verified == false` attempts admin read/write -> `PERMISSION_DENIED`.
6. **PII Blanket Read**: Employee calls `get` on another user's `/users/{otherUid}` -> `PERMISSION_DENIED`.
7. **Task Scrape (`list` without constraint)**: Employee runs unfiltered `list` on `/tasks` without `where("assignedTo", "==", uid)` -> `PERMISSION_DENIED`.
8. **Unauthorized Task Reassignment**: Employee updates `assignedTo` or `priority` or `dueDate` on a task assigned to them -> `PERMISSION_DENIED`.
9. **Terminal State Bypass**: Employee attempts to change `status` or `progress` on a task whose existing `status == "Completed"` -> `PERMISSION_DENIED`.
10. **Progress Out-of-Bounds / Type Poisoning**: Employee updates `progress: 150` or `progress: "100"` or a 10KB `title` -> `PERMISSION_DENIED`.
11. **ID Poisoning**: Client writes to `/tasks/invalid$id!with/slash` or a 200-char document ID -> `PERMISSION_DENIED`.
12. **Client-Forged Timestamp / Cross-User Notification**: User creates a notification or activity with `createdAt` in the past or `actorId != request.auth.uid` -> `PERMISSION_DENIED`.
