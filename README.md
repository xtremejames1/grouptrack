# GroupTrack
https://grouptrack-three.vercel.app/ 

## Elevator Pitch

GroupTrack turns daily habits into a shared team calendar, helping small groups stay consistent through visibility, encouragement, and quick social accountability.

## Screenshots

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/85cc6b07-30c9-4689-8246-625a47bb543f" alt="Landing page" /></td>
    <td><img src="https://github.com/user-attachments/assets/0cab90ad-52c7-495c-b4fb-76050b3b9553" alt="Calender page" /></td>
  </tr>
   <tr>
    <td><img src="https://github.com/user-attachments/assets/f8f3a948-9290-4237-bd2b-bb754e0ede71" alt="Habits page" /></td>
    <td><img src="https://github.com/user-attachments/assets/a0cf798f-468f-4edc-83f6-a46096f31e46" alt="Social page" /></td>
   </tr>
</table>

## About The Project

GroupTrack was inspired by a simple problem: personal habit apps are great for tracking yourself, but consistency often improves when you are accountable to other people. We wanted a product where friends, classmates, or teammates could check in together and see progress in one place.

### What We Built

We built a full-stack habit accountability app with:

- Group creation and invite-code onboarding
- Shared habit definitions across a group
- Daily check-ins and monthly calendar visualization
- Social layer: nudges, celebrations, and achievement posts
- AI-assisted motivational message generation with factual context
- Achievement "Congratulate" interactions (kudos-style)
- QR/invite-link sharing that works in local and deployed environments

### How We Built It

- **Frontend:** React + TypeScript + Vite
- **Backend:** FastAPI + SQLAlchemy
- **Database:** PostgreSQL (Docker), SQLite-compatible local paths in dev/test
- **Infra/Dev workflow:** Docker Compose services for frontend, backend, and database
- **AI integration:** Anthropic Messages API for generating nudge/celebration/achievement text

The product logic centers around group habits and daily check-ins, then derives social context from real completion data. This context is used to generate more accurate, motivating messages instead of generic prompts.

### What We Learned

- Real-time-feeling UX often depends on backend response timing (for example, flushing writes before returning counts).
- "Supportive AI" quality improves dramatically when prompts include concrete context and explicit tone constraints.
- Team accountability UX must balance visibility and privacy (for example, recipient-only nudge/celebration popups).
- Deployment-ready URL handling matters for share features (QR links, invite links, and environment-based base URLs).

### Challenges We Faced (and How We Addressed Them)

1. **Generic or inaccurate motivational messages**
   - **Challenge:** Early nudges sounded generic and did not reflect actual habits.
   - **Fix:** Expanded social context and tightened prompt rules (uplifting tone, tiny next-step framing, no guilt language, factual grounding).

2. **Social interactions not updating immediately**
   - **Challenge:** Congratulation counts could appear stale until another refresh action.
   - **Fix:** Flushed kudos inserts before counting in the API response so the frontend updates instantly.

3. **Cross-device invite/QR reliability**
   - **Challenge:** Links based only on local origin can break in some deployment/network contexts.
   - **Fix:** Added support for `VITE_PUBLIC_BASE_URL` with fallback to `window.location.origin`.

4. **Landing-page navigation clarity**
   - **Challenge:** Header links and section targeting were inconsistent with sticky nav behavior.
   - **Fix:** Added section anchors, smooth scrolling, and proper scroll offset handling.

## Built With

- **Languages:** Python, TypeScript, SQL, CSS
- **Frontend:** React, Vite, qrcode.react
- **Backend:** FastAPI, Uvicorn, SQLAlchemy, HTTPX
- **Database:** PostgreSQL, Psycopg
- **DevOps/Platform:** Docker, Docker Compose
- **AI/API:** Anthropic Messages API
- **Tooling:** Pytest, TypeScript

## Repository Structure

- `frontend/` - React + Vite client app
- `backend/` - FastAPI API and application logic
- `ops/` - Nginx and operational configs
- `tests/` - automated tests and validation helpers

## Setup Instructions

### Prerequisites

- Docker + Docker Compose
- (Optional for AI messages) Anthropic API key

### 1) Configure Environment

At project root, create/update `.env`:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-3-5-haiku-latest
ANTHROPIC_TIMEOUT_SECONDS=10
```

For frontend deploys (for example, Vercel), set:

```bash
VITE_PUBLIC_BASE_URL=https://your-app.vercel.app
VITE_API_BASE_URL=https://your-backend.onrender.com
```

### 2) Run Locally (Docker Compose)

```bash
docker compose up --build
```

Typical local endpoints:

- Frontend (dev override): `http://localhost:5173`
- Backend API: `http://localhost:8000`

### 3) Development Override (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

### 4) Run Tests

From project root:

```bash
pytest
```

## Notes for Deployment (Vercel + Render)

- Frontend is deployed to Vercel. Backend is deployed to Render (or any host running the Docker image).
- `frontend/vercel.json` rewrites `/api/*` requests to the backend URL so the frontend never needs to know the backend origin at runtime.
- Set `VITE_PUBLIC_BASE_URL` and `VITE_API_BASE_URL` in Vercel environment variables.
- After deploying, verify the invite link and QR code workflow on both mobile and desktop.
