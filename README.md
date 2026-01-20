# 🚚 Zap Shift Server (Backend API)

This repository contains the backend server for **Zap Shift**, a parcel delivery and logistics management system. The server is built with **Node.js**, **Express**, **MongoDB**, **Firebase Authentication**, and **Stripe** for payments.

---

## ✨ Features Overview

- User authentication using **Firebase Admin SDK**
- Role-based access control (user, admin, rider)
- Parcel management system
- Rider management and assignment
- Secure payment system using **Stripe Checkout**
- Tracking ID generation for parcels
- MongoDB Atlas database integration

---

## 🛠️ Tech Stack

- Node.js
- Express.js
- MongoDB (Atlas)
- Firebase Admin SDK
- Stripe Payment Gateway
- dotenv
- CORS

---

## 📁 Project Structure (Simplified)

```
root
│── index.js (main server file)
│── .env
│── package.json
│── README.md
```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory and add the following:

```
PORT=5000
DB_USERNAME=your_mongodb_username
DB_PASSWORD=your_mongodb_password
STRIPE_SECRETE=your_stripe_secret_key
SITE_DOMAIN=https://your-frontend-domain.com
FIREBASE_SERVICE_KEY=base64_encoded_firebase_admin_sdk
```

⚠️ `FIREBASE_SERVICE_KEY` must be **Base64 encoded JSON** of Firebase Admin SDK credentials.

---

## 🚀 Getting Started

### 1️⃣ Install Dependencies

```
npm install
```

### 2️⃣ Run Server

```
npm start
```

or (for development)

```
nodemon index.js
```

Server will run on:

```
http://localhost:5000
```

---

## 🔑 Authentication Middleware

### `verifyFBToken`

- Verifies Firebase ID token
- Extracts user email from token
- Protects secure routes

### `verifyAdmin`

- Checks user role from database
- Allows access only to admin users

---

## 📦 Parcel API Endpoints

### Get User Parcels

`GET /parcels?email=user@email.com&deliveryStatus=pending`

### Get All Parcels (Admin)

`GET /parcels/admin?deliveryStatus=delivered`

### Get Rider Parcels

`GET /parcels/rider?riderEmail=rider@email.com`

### Get Single Parcel

`GET /parcels/:id`

### Create Parcel

`POST /parcels`

### Assign Rider to Parcel

`PATCH /parcels/:id`

### Update Parcel Status

`PATCH /parcels/:id/status`

### Delete Parcel

`DELETE /parcels/:id`

---

## 💳 Payment APIs (Stripe)

### Create Checkout Session

`POST /payment-checkout-session`

### Verify Payment Success

`PATCH /payment-success?session_id=STRIPE_SESSION_ID`

✔ Automatically updates:

- Payment status
- Delivery status
- Tracking ID

---

## 👤 User APIs

### Get All Users (Admin)

`GET /users`

### Add User

`POST /users`

### Update User Role (Admin)

`PATCH /users/:id/role`

### Check User Role

`GET /users/:email/role`

### Delete User

`DELETE /users/:id/delete`

---

## 🛵 Rider APIs

### Get Riders

`GET /riders?status=pending&district=Dhaka`

### Add Rider

`POST /riders`

### Approve / Reject Rider

`PATCH /riders/:id/role`

### Delete Rider

`DELETE /riders/:id/delete`

---

## 🧾 Tracking ID Format

Tracking IDs are auto-generated like:

```
ZAP-20260121-A1B2C3D4
```

Format:

- `ZAP` → Company prefix
- `YYYYMMDD` → Date
- Random HEX string

---

## 🧪 Health Check

```
GET /
```

Response:

```
Zap Shift Server is running
```

---

## ⚠️ Notes & Best Practices

- Always protect admin routes with `verifyFBToken + verifyAdmin`
- Never expose Stripe secret key on frontend
- Use HTTPS in production
- Do not commit `.env` file

---

## 👨‍💻 Author

**Osman Zakaria**
Frontend & Backend Developer
Zap Shift Project

---

## 📜 License

This project is for educational and commercial use under Zap Shift.
