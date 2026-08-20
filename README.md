# SafeRoadAI - Setup & Run Guide

SafeRoadAI is an AI-powered road hazard detection system. Follow the steps below to get it running.

## 🚀 One-Click Start (Recommended)
Simply double-click the `start.bat` file in the root directory. This will:
1. Start the **AI Engine** (FastAPI)
2. Start the **Backend Server** (Node.js/Express)
3. Start the **Frontend** (Vite/React)
4. Open the dashboard in your browser.

---

## 🛠️ Manual Start (Separate Terminals)

If you prefer to run services manually, open **3 terminal windows** and run the following:

### 1. AI Engine (FastAPI)
```powershell
cd ai-engine
.\venv\Scripts\activate
python app.py
```
*Port: 8000*

### 2. Backend Server (Node.js)
```powershell
cd backend
npm install
node server.js
```
*Port: 5000*

### 3. Frontend (React/Vite)
```powershell
cd frontend
npm install
npm run dev
```
*Port: 5173*

---

## 📝 Important Notes
- **Database**: The system uses MongoDB. If MongoDB is not running locally, it will automatically fall back to an **In-Memory storage** (data will be lost on restart).
- **AI Connectivity**: The backend will attempt to connect to the AI engine at `localhost:8000`. If unavailable, it will use mock hazard scores.
