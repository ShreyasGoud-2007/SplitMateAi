# SplitMate AI 💸

**SplitMate AI** is an AI-powered bill-splitting mobile application designed to make splitting restaurant bills easier, smarter and more transparent. It allows users to scan bills, organize items, assign items to individuals and automatically calculate how much each person needs to pay.

The application aims to eliminate the hassle of manually calculating shared expenses by combining AI-powered bill extraction with item-based bill splitting.

---

## 🚀 Features

- **AI Bill Scanning** – Extract bill details, items, quantities and prices using AI-powered OCR.
- **Bill Review & Editing** – Review and modify extracted bill information before splitting.
- **Manual Bill Entry** – Add bills and items manually.
- **Demo Bill** – Use a sample bill to explore and test the application.
- **Group Management** – Create bill-splitting groups and add participants.
- **Item-Based Splitting** – Assign specific items to individual participants.
- **Quantity-Based Splitting** – Split item quantities among multiple people.
- **Shared Items** – Distribute shared food items among selected participants.
- **Automatic Calculations** – Calculate individual shares and bill totals.
- **Currency Support** – Designed with INR (₹) as the default currency.
- **Saved Split History** – Supabase-backed history is available after authenticated access is configured.

---

## 🛠️ Tech Stack

### Frontend
- React Native
- Expo
- TypeScript
- Expo Router

### Backend
- Python
- FastAPI

### AI
- Google Gemini API
- AI-powered OCR and bill data extraction

### Database
- Supabase
- PostgreSQL

---

## 🏗️ Architecture

SplitMate AI follows a frontend-backend architecture.

<escape>
Mobile Application (React Native + Expo)
        |
        | API Requests
        v
Backend API (FastAPI)
        |
        | AI Processing
        v
Google Gemini API
        |
        v
Bill Data Extraction & Processing
        |
        v
Database (Supabase PostgreSQL with authenticated RLS)
</escape>

---

## 📱 Application Workflow

1. User opens SplitMate AI.
2. User scans a bill or manually enters bill details.
3. AI extracts bill items and prices from the image.
4. User reviews and edits the extracted bill.
5. User creates a group and adds participants.
6. Bill items are assigned to participants.
7. The application calculates each participant's share.
8. A final split summary is generated.

---

## 📂 Project Structure

```text
SplitMateAI/
│
├── app/                       # Expo Router screens
│   ├── scan/                  # Bill scanning and review
│   └── ...
│
├── components/                 # Reusable UI components
│
├── utils/                     # Utility functions and API logic
│
├── backend/                   # FastAPI backend
│   ├── routes/
│   ├── services/
│   ├── main.py
│   └── requirements.txt
│
├── assets/                     # Images, icons and assets
├── .env                       # Frontend environment variables
├── .gitignore
└── README.md
```

---

## ⚙️ Setup & Installation

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/SplitMateAI.git
cd SplitMateAI
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Configure Frontend Environment

Create a `.env` file in the project root.

```env
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:8000
```

Replace `YOUR_LOCAL_IP` with your computer's local IP address.

### 4. Setup Backend

Navigate to the backend folder:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate it on Windows:

```powershell
.\venv\Scripts\Activate.ps1
```

Install backend dependencies:

```bash
pip install -r requirements.txt
```

### 5. Configure Backend Environment

Create a `.env` file inside the `backend` folder.

```env
GEMINI_API_KEY=your_api_key_here
```

Add other backend environment variables if required by the project configuration.

**Do not commit API keys or environment files to GitHub.**

### 6. Start the Backend

From the backend folder:

```bash
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend will be available at:

```text
http://localhost:8000
```

API documentation:

```text
http://localhost:8000/docs
```

### 7. Start the Mobile Application

Open a new terminal in the project root:

```bash
npx expo start
```

Scan the QR code using Expo Go on your Android device.

Ensure your phone and computer are connected to the same Wi-Fi network.

---

## 🗺️ Development Roadmap

### Phase 1 — Project Setup & Foundation

- Set up React Native, Expo and TypeScript.
- Configure Expo Router for navigation.
- Set up FastAPI backend.
- Configure environment variables and API communication.
- Establish the basic UI theme and project structure.

### Phase 2 — Bill Scanning & Bill Processing

- Implement bill image upload and camera capture.
- Integrate AI-powered OCR using Gemini.
- Extract bill items, quantities, prices and totals.
- Validate and normalize extracted bill data.
- Allow users to review and edit extracted details.

### Phase 3 — Manual Bill & Demo Bill

- Implement manual bill entry.
- Create a sample/demo bill for testing.
- Allow editing of bill items and quantities.
- Automatically calculate subtotal, GST and total.

### Phase 4 — Group & Participant Management

- Create split groups or sessions.
- Add, edit and remove participants.
- Configure group details and currency.
- Manage participant information within a split session.

### Phase 5 — Item-Based Bill Splitting

- Assign individual items to participants.
- Support quantity-based splitting.
- Support shared items.
- Track unassigned items and quantities.
- Calculate each participant's share accurately.

### Phase 6 — Split Summary & Settlement

- Generate individual participant summaries.
- Calculate final amounts, including applicable bill charges.
- Display who owes how much.
- Simplify settlement calculations between participants.

### Phase 7 — Database & Data Persistence

- Integrate Supabase.
- Store users, bills, groups, participants and split records.
- Implement persistent bill history.
- Synchronize data across sessions.

### Phase 8 — Authentication & User Accounts

- Implement user authentication.
- Add sign-up and login functionality.
- Associate bills and groups with users.
- Manage user profiles.

### Phase 9 — Testing & Refinement

- Test bill scanning and extraction.
- Test splitting calculations.
- Validate edge cases and shared items.
- Improve UI/UX and performance.
- Fix bugs and improve reliability.

### Phase 10 — Deployment & Release

- Prepare the backend for deployment.
- Deploy the API.
- Prepare the Android application for release.
- Conduct final testing.
- Release SplitMate AI.

---

## 🔐 Environment Variables

Environment files are used to store configuration and API credentials.

### Frontend

```env
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:8000
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Copy `.env.example` to `.env` and replace the placeholders. The Supabase publishable/anon key is intended for client use and is restricted by database grants and Row Level Security. Never add a service-role key to the mobile application.

### Backend

```env
GEMINI_API_KEY=your_api_key_here
```

Environment files should never be committed to the public repository.

---

## 💾 Supabase Persistence and Authentication (Phases 7–8)

Bills from OCR, manual entry, and the demo workflow are normalized into the same canonical bill model before they enter the existing bill store. The bill's `source` is metadata; item assignment and calculations use the same path for every source. The OCR boundary is `adaptOCRResponseToBill` in `utils/billAdapters.ts`.

To prepare a Supabase project:

1. Create a Supabase project.
2. Open its SQL Editor and review/run [`supabase/schema.sql`](./supabase/schema.sql). This creates the tables, indexes, authenticated-only RLS policies, and an atomic `save_split_session` RPC. It does not drop existing tables.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Restart Expo after setting the environment.

Email/password authentication is available from the sign-in and sign-up screens. Native sessions are persisted with Expo SecureStore and restored before protected screens are shown. Supabase Auth state changes (including sign-out) are observed by the app, and the router protects bill, split, and history screens.

### Supabase Auth setup

1. In **Authentication → Providers → Email**, enable email/password sign-in. Keep email confirmation enabled for production.
2. In **Authentication → URL Configuration → Redirect URLs**, add `splitmateai://auth/callback`. The app uses this callback to verify email links.
3. For Expo Go, `Linking.createURL` may generate an `exp://.../--/auth/callback` URL instead. Add the exact generated redirect URL to the allow list, or temporarily disable email confirmation for local testing. A development build gives a stable `splitmateai://` callback.
4. Confirm the root `.env` contains the Supabase project URL and publishable/anon key shown above, then restart Expo.

The login screen accepts an email and password. Sign-up validates the email and password, and displays a confirmation message if the Supabase project requires email verification. The callback route supports Supabase PKCE codes and email token hashes. Sign out is available from Profile and clears the local device session.

The persistence service in `services/supabaseStorage.ts` accepts canonical bill/session models, not OCR response objects. Saves and history requests use the current Supabase Auth session; the existing `auth.uid()`-scoped RLS policies remain enabled, so each account can only access its own sessions. It persists only remote/storage image references; local device image URIs are omitted so saved bills remain usable without their original image. Never place a service-role key in the mobile app.

### Test on Android

1. Configure the Supabase Auth provider and redirect URL above.
2. Run `npx expo start` from the project root and open the project in Expo Go.
3. Create an account with an email you can access. If email confirmation is on, open the email link on the same phone; otherwise the app signs in immediately.
4. Sign in, create a group split, assign bill items, then save the summary. Open History and select the saved split.
5. In Profile, sign out. Confirm the app returns to sign-in. Sign in again and verify the saved split is still present.
6. Close and reopen Expo Go to verify the persisted session restores without showing the sign-in screen first.

---

## 🎯 Project Goal

The goal of SplitMate AI is to simplify shared expenses through AI-powered bill scanning and intelligent item-based splitting, making group dining and expense sharing easier, faster and more accurate.

---

## 👨‍💻 Development

SplitMate AI is currently under active development. Features and architecture may evolve as development progresses.
