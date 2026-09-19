# 🛡️ FamilyShield — AI-Powered Family Safety Platform

**Ask AI. Ask Family. Decide Safely.**

[![Live Website](https://img.shields.io/badge/Live-familyshield.rounakraj.online-10b981?style=for-the-badge)](https://familyshield.rounakraj.online/)
[![GitHub](https://img.shields.io/badge/GitHub-Family--Shield-181717?style=for-the-badge&logo=github)](https://github.com/rajrounak21/Family-Shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Groq AI](https://img.shields.io/badge/Groq_AI-F55036?style=flat&logo=data:image/svg+xml;base64,花的)](https://groq.com/)

FamilyShield is a full-stack family safety app built for one real moment: your parent gets a scary SMS — “bank blocked, verify now” — and has no one trusted to ask. Paste it, get AI risk analysis in Hindi / Hinglish / English, send it to selected family members in one tap, and record the family verdict **before** anyone clicks, pays, or shares an OTP.

> 👨‍🎓 Built by a student as a portfolio + real-world safety project. Live, open-source, MIT licensed.

🔗 **Repo:** https://github.com/rajrounak21/Family-Shield

🌐 **Live website:** https://familyshield.rounakraj.online/

⭐ **Showcase tip:** open the live site → scroll to Dashboard preview → check Features + FAQ.

---

## 📚 Table of Contents

- [Why FamilyShield?](#-why-familyshield)
- [Features](#-features)
- [Demo](#-demo)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Quickstart](#-quickstart-local)
- [Env Vars](#-env-vars)
- [API Overview](#-api-overview)
- [Security](#-security-notes)
- [Contributing](#-contributing)
- [Author](#-author)
- [License](#-license)

## 💡 Why FamilyShield?

| Today | With FamilyShield |
|-------|-------------------|
| Scary screenshot drowns in WhatsApp forwards | Dedicated case: AI analysis + family verdict in one place |
| Generic chatbot — can you trust it with savings? | AI explains + **humans you love confirm** |
| Google needs expertise elders don't have | Paste message/link → risk level + reasons + next steps in simple words |
| Money sent in panic | Emergency mode: 1930 helpline, cybercrime.gov.in, bank-freeze steps |

## ✨ Features

- **Family Protection Hub** — create family, invite via link / QR, admin / member roles
- **AI Shield Assistant** — Groq + LangGraph advice, risk levels High / Medium / Low, reasons + safe next steps
- **Ask Family + Verdicts** — one-tap share to selected members, one-tap replies (Safe / Don't touch / Be careful), verdict recorded
- **Real-Time Family Chat** — WebSocket, images, replies, reactions, seen receipts, typing + online status
- **Smart Push Notifications** — Web Push (VAPID) for messages, invites, offline alerts
- **Activity Feed** — who joined, who is online, full family timeline
- **Emergency Guidance** — money sent / OTP shared → instant 1930 + reporting checklist
- **Hindi + Hinglish** — ask in your language, AI answers in the same language
- **Solid Auth** — JWT, Google OAuth, Argon2 hashing, single-use reset links, invite-only families
- **Landing Site** — Problem, Features, How-it-works, Dashboard preview, FAQ, Privacy, Security (`website/`)

## 🎬 Demo

- **Live:** https://familyshield.rounakraj.online/
- **Local app:** run backend → `http://localhost:8000` (API docs at `/docs`)
- **Try this:** paste a fake “KYC blocked” SMS into Ask Shield → check risk → share to family → record verdict.

> Want screenshots? Add `docs/screenshot-dashboard.png` and link here — recruiters click images first.

## 🧰 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI, Uvicorn, PyMongo, Pydantic + pydantic-settings, PyJWT, pwdlib (Argon2), Authlib, aiosmtplib, pywebpush, itsdangerous, httpx |
| AI | Groq, LangChain, LangGraph |
| Frontend | Vanilla JS / HTML / CSS, WebSocket client, Service Worker, i18n |
| Data | MongoDB (local or Atlas) |
| Deploy | Backend: any Python host · Landing site: static host (current: custom domain) |

## 📁 Project Structure

```
Family-Shield/
├── backend/              # FastAPI app (import as backend.main)
│   ├── main.py           # app + CORS + mounts frontend/ at /
│   ├── core/             # config, database, security, google_auth
│   ├── routers/          # auth, family, chat, ai, case, share, review, notification
│   ├── services/         # business logic + AI pipeline + push
│   ├── models/ schemas/ utils/
├── frontend/             # app UI, no build step
│   ├── index.html app.js styles.css sw.js
│   ├── chat/ family/ ai/ case/ share/ review/ auth/
├── website/              # public landing site
│   ├── index.html privacy.html security.html
├── requirements.txt
├── .env.example
├── LICENSE (MIT)
```

## 🚀 Quickstart (local)

```powershell
# 1. Clone
git clone https://github.com/rajrounak21/Family-Shield.git
cd Family-Shield

# 2. Venv + deps
python -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Env
copy .env.example .env
# fill MONGODB_URI, JWT_SECRET, SESSION_SECRET, SMTP_*, GOOGLE_*, GROQ_API_KEY

# 4. Run (backend also serves frontend/)
uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000  |  API docs: http://localhost:8000/docs
```

MongoDB: use local `mongodb://localhost:27017` or a free Atlas URI.

## 🔑 Env Vars

| Key | Used for |
|-----|----------|
| MONGODB_URI / MONGODB_URL | database connection |
| JWT_SECRET, SESSION_SECRET | auth + sessions |
| SMTP_HOST / PORT / USERNAME / PASSWORD, EMAIL_FROM | password-reset emails |
| GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI | Google login |
| GROQ_API_KEY | AI Shield |
| FRONTEND_URL | CORS allowlist |
| VAPID_PRIVATE_KEY | web push |

Template: `.env.example`. Never commit `.env` (already gitignored).

## 🔌 API Overview

Base `http://localhost:8000`:

- Auth: `POST /auth/signup, /auth/login, /auth/google, /auth/forgot-password, /auth/reset-password`
- Family: `GET/POST /family/*` — create, invite, members, roles
- Chat: `WS /chat/ws/{family_id}`, `GET /chat/{family_id}/messages`
- AI: `POST /ai/ask`
- Cases / Share / Review: `*/case/*, */share/*, */review/*`
- Notifications / Push: `*/notification/*, */push/*`

Full interactive docs: `/docs` when server runs.

## 🔒 Security Notes

- Argon2 password hashing, passwords never logged
- Short-lived JWT, official Google OAuth flow
- Invite-only families, per-case member picker
- Production: HTTPS/WSS, tight CORS, `https_only=True`
- Users can delete chats, cases, shares, even full account

See `website/privacy.html` and `website/security.html` for user-facing policies.

## 🤝 Contributing

Student project — issues and PRs welcome:

```powershell
git checkout -b feat/my-change
# ... edit ...
git commit -m "feat: describe change"
git push -u origin feat/my-change
```

Then open a PR against `main`.

## 👨‍💻 Author

**Rounak Raj** — student developer
- GitHub: https://github.com/rajrounak21
- Project: https://github.com/rajrounak21/Family-Shield
- Live: https://familyshield.rounakraj.online/
- Portfolio Link: https://portfolio.rounakraj.online/

## 📄 License

MIT — see [LICENSE](./LICENSE). Free for learning and reuse with credit.
