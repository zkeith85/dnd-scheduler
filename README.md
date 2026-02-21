# D&D In-Person Session Scheduler

Shared month scheduler for tabletop sessions. Anyone with the month link can submit availability and see updates live.

## Features

- Fixed month schedules from February 2026 to December 2026
- Live sync across phones and desktop
- Add/remove dates and players
- Toggle availability per player/date
- Automatic top date ranking

## Files

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`
- `assets/witchlight-hero.jpg` (optional local background image)

## Witchlight Art Setup

To use your preferred Witchlight artwork:

1. Save your chosen image as `assets/witchlight-hero.jpg`
2. Commit and push it with the app

If that file is missing, the app falls back to a remote image.

## One-time Firebase setup

1. Create a Firebase project: <https://console.firebase.google.com/>
2. In the project, create a **Web App**.
3. Enable **Firestore Database** (start in Production or Test mode).
4. Copy your Firebase web config values into `firebase-config.js`.

`firebase-config.js` should look like this:

```js
window.FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## Firestore rules (simple shared scheduling)

Use these rules so your group can read/write shared month docs:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if true;
    }
  }
}
```

This is open access. For private use with friends, that is usually fine. If you want secure auth rules later, add Firebase Auth.

## Run locally

Open `index.html` directly, or run:

```powershell
python -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy on GitHub Pages

1. Push files to your GitHub repo.
2. Repo `Settings` -> `Pages`.
3. Source: `Deploy from a branch`.
4. Branch: `main`, folder `/ (root)`.
5. Open your Pages URL and join a month schedule.

## How friends use it

1. Open your GitHub Pages link on phone.
2. Enter their name and choose the same month.
3. Tap availability cells.
4. Everyone sees updates in real time.
