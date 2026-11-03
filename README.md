# BookNook - Server API

This is the backend REST API for the BookNook online library application. It handles database operations, book borrowing logic, and JWT-protected routes.

## ⚙️ Key Features & APIs
- **Express.js & MongoDB:** High-performance backend utilizing MongoDB Atlas for data storage.
- **JWT Protection:** Secure API endpoints using JSON Web Token (JWT) validation middleware.
- **Book Management:** APIs for creating, reading, updating, and deleting (CRUD) books.
- **Borrow Logic:** Handles book borrowing with `$inc` operators to manage available copies.
- **User Data:** Fetches specific data based on the logged-in user's email.

## 🔗 Live Server URL
- **Base API URL:** [Will be added after deployment]

## 🛠️ Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (Native Driver)
- **Security:** JWT (jsonwebtoken), CORS

## 🚀 How to Run Locally
1. Clone the repository: `git clone <your-server-repo-link>`
2. Install dependencies: `npm install`
3. Create a `.env` file with `PORT`, `MONGODB_URI`, and `JWT_SECRET`.
4. Run the server: `npm run dev`
