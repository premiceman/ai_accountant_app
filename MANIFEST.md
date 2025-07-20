# AI Accountant Application - Feature Manifest

## 🔐 Authentication & User Management
- **Feature**: User Signup
  - **File**: backend/routes/auth.js
  - **Description**: Registers new users with hashed passwords using bcryptjs and stores them in MongoDB.

- **Feature**: User Login
  - **File**: backend/routes/auth.js
  - **Description**: Authenticates users by validating credentials and issues JWT tokens for session management.

## 📁 Document Uploads
- **Feature**: File Upload via UI
  - **File**: frontend/home.html
  - **Description**: Allows users to upload files with real-time feedback and timestamp display. Warns if upload is outdated.

- **Feature**: Backend File Upload Endpoint
  - **File**: backend/routes/upload.js
  - **Description**: Handles `multipart/form-data` POST requests. Saves files to `uploads/` and updates user metadata.

## 🧠 AI-Powered Report Generation
- **Feature**: Financial Report Generation with OpenAI
  - **File**: backend/ai/reportGenerator.js
  - **Description**: Calls OpenAI's API with user financial data and returns a natural language summary.

- **Feature**: User Report Endpoint
  - **File**: backend/routes/user.js
  - **Description**: Accepts user financial data via POST, generates insights using GPT, and returns the response.

## 🛠️ Backend Configuration
- **Feature**: Express App Configuration
  - **File**: backend/index.js
  - **Description**: Bootstraps the server, connects to MongoDB using Mongoose, and mounts all routes.

## 🧾 Models
- **Feature**: User Model
  - **File**: backend/models/User.js
  - **Description**: Defines schema for users including name, email, password, and uploaded file data.

## 🌍 Environment Variables
- **File**: backend/.env
- **Keys**:
  - `MONGODB_URI`: mongodb+srv://Cluster27100:oct181998MPH@cluster27100.kty6g3j.mongodb.net/ai_accountant?retryWrites=true&w=majority&appName=Cluster27100
  - `OPENAI_API_KEY`: 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
  - `JWT_SECRET`: mysupersecurejwtsecret
  - `PORT`: 3000

## 📂 Directory Structure
- backend/
  - index.js
  - routes/
    - auth.js
    - upload.js
    - user.js
  - ai/
    - reportGenerator.js
  - models/
    - User.js
  - .env
- frontend/
  - index.html
  - login.html
  - signup.html
  - home.html
- uploads/
  - (user-uploaded files)

---

## ✅ Last Verified: v1.0 Complete Restore
This manifest tracks the current state of all working features, file locations, and configuration in your application.