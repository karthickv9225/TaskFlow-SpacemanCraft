# Company Task Management System (TaskFlow)

A full-stack Company Task Management System with role-based **Admin** and **Employee** dashboards, built with **HTML5 / CSS3 / Vanilla JavaScript** and powered by **Firebase Authentication** and **Cloud Firestore** with real-time `onSnapshot` synchronization and hardened Firestore Security Rules.

## Architecture & Project Structure

```text
├── server.ts                  # Vite dev / production static server + /api/health (port 3000)
├── firebase-applet-config.json# Provisioned Firebase project configuration (taskflow-bae15)
├── firebase-blueprint.json    # Firestore data entities and path blueprint
├── firestore.rules            # Hardened Firestore security rules (RBAC, schema, timestamps)
├── security_spec.md           # Security invariants and Dirty Dozen test spec
├── index.html                 # Entry router checking Firebase Auth session
├── login.html                 # Sign-in & one-time Initial Admin Setup screen
├── admin.html                 # Admin Dashboard, Tasks, Employees, Notifications, Profile, Settings
├── employee.html              # Employee Dashboard, My Tasks, Notifications, Profile, Settings
├── css/
│   └── style.css              # TaskFlow responsive CSS3 design system
└── js/
    ├── firebase.js            # Firebase App, Auth, Firestore initialization & error handling
    ├── storage.js             # Non-sensitive UI display preferences (table density, date format)
    ├── api.js                 # Cloud Firestore & Firebase Auth CRUD + real-time listeners
    ├── common.js              # Shared UI utilities (XSS escaping, badges, toasts, modals)
    ├── auth.js                # Firebase Auth login, route guards & initial Admin bootstrap
    ├── tasks.js               # Real-time Task Details, comments, history, notifications, profile
    ├── admin.js               # Real-time Admin Dashboard, Employee CRUD, and Task CRUD
    └── employee.js            # Real-time Employee Dashboard and assigned task updates
```

## Setup & Usage

1. **Enable Email/Password in Firebase Console**:
   In Firebase Console for project `taskflow-bae15`, navigate to **Authentication -> Sign-in method** and ensure **Email/Password** is enabled.
2. **Run Locally**:
   ```bash
   npm install
   npm run dev
   ```
3. **Initial Administrator & Employee Accounts**:
   - On first launch against an empty database, `login.html` displays a one-time **Initial Admin Setup** form. Once the first Admin account is created, `/meta/workspace` locks public Admin registration permanently.
   - Employee accounts are created exclusively by a logged-in Administrator in **Employee Management**.
