const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose"); 
require("dotenv").config();

const app = express();

// মিডলওয়্যার
app.use(cors({
  origin: process.env.BETTER_AUTH_URL,
  credentials: true
}));
app.use(express.json());

// BetterAuth এর JWKS এন্ডপয়েন্ট (টোকেন ভেরিফাই করার জন্য)
const JWKS = createRemoteJWKSet(new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`));

// JWT ভেরিফাই করার মিডলওয়্যার
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ success: false, message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // jose দিয়ে টোকেন ভেরিফাই করা
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.BETTER_AUTH_URL,
      audience: process.env.BETTER_AUTH_URL,
    });

    req.user = payload; 
    next(); 
  } catch (error) {
    console.error("Token Error:", error.message);
    return res.status(403).send({ success: false, message: "Unauthorized: Invalid token" });
  }
};

// ডাটাবেস কানেকশন
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("booknookDB"); 
    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
  }
}

connectDB();

// বেসিক টেস্ট রুট
app.get("/", (req, res) => {
  res.send("BookNook Server is Running!");
});

// ১. নতুন বই যোগ করার API (POST)
app.post("/api/books", verifyToken, async (req, res) => {
  try {
    if (!db) return res.status(500).send({ success: false, message: "Database not connected yet!" });
    const bookData = req.body;
    const result = await db.collection("books").insertOne(bookData);
    res.status(201).send({ success: true, message: "Book added successfully", data: result });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to add book", error: error.message });
  }
});

// ২. সব বই আনার API (GET)
app.get("/api/books", async (req, res) => {
  try {
    if (!db) return res.status(500).send({ success: false, message: "Database not connected yet!" });
    const books = await db.collection("books").find().sort({ addedAt: -1 }).toArray();
    res.status(200).send({ success: true, data: books });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch books", error: error.message });
  }
});

// ৩. নির্দিষ্ট একটি বই আনার API (GET by ID)
app.get("/api/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });
    res.status(200).send({ success: true, data: book });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch book", error: error.message });
  }
});

// ৪. বই ধার নেওয়ার API (POST) - Available Copies ও No Double Borrow সহ
app.post("/api/borrows", verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail, ...rest } = req.body;

    // চেক: ইউজার কি ইতিমধ্যে এই বই ধার নিয়েছে?
    const existingBorrow = await db.collection("borrows").findOne({ bookId: bookId, userEmail: userEmail });
    if (existingBorrow) {
      return res.status(400).send({ success: false, message: "You have already borrowed this book!" });
    }

    // চেক: বইটির কপি আছে কি না?
    const book = await db.collection("books").findOne({ _id: new ObjectId(bookId) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });
    if (!book.totalCopies || book.totalCopies <= 0) {
      return res.status(400).send({ success: false, message: "Book is not available right now!" });
    }

    // borrows কালেকশনে ডাটা সেভ করা
    const result = await db.collection("borrows").insertOne({ bookId, userEmail, ...rest });

    // বইয়ের কপি ১ কমিয়ে দেওয়া
    await db.collection("books").updateOne({ _id: new ObjectId(bookId) }, { $inc: { totalCopies: -1 } });

    res.status(201).send({ success: true, message: "Book borrowed successfully", data: result });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to borrow book", error: error.message });
  }
});

// ৫. ইউজারের ধার নেওয়া বইয়ের লিস্ট আনার API (GET)
app.get("/api/my-borrows", async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) return res.status(400).send({ success: false, message: "Email is required" });
    const borrows = await db.collection("borrows").find({ userEmail: userEmail }).sort({ borrowDate: -1 }).toArray();
    res.status(200).send({ success: true, data: borrows });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch borrows", error: error.message });
  }
});

// ৬. বই ফেরত দেওয়ার API (DELETE)
app.delete("/api/borrows/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const borrowRecord = await db.collection("borrows").findOne({ _id: new ObjectId(id) });
    if (!borrowRecord) return res.status(404).send({ success: false, message: "Borrow record not found" });

    await db.collection("borrows").deleteOne({ _id: new ObjectId(id) });
    await db.collection("books").updateOne({ _id: new ObjectId(borrowRecord.bookId) }, { $inc: { totalCopies: 1 } });

    res.status(200).send({ success: true, message: "Book returned successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to return book", error: error.message });
  }
});

// ৭. নির্দিষ্ট ইউজারের যোগ করা বইয়ের লিস্ট আনার API (GET)
app.get("/api/my-books", async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) return res.status(400).send({ success: false, message: "Email is required" });
    const books = await db.collection("books").find({ userEmail: userEmail }).sort({ addedAt: -1 }).toArray();
    res.status(200).send({ success: true, data: books });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch your books", error: error.message });
  }
});

// ৮. বই ডিলিট করার API (DELETE)
app.delete("/api/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });
    
    // Authorization চেক (jose থেকে পাওয়া payload এ ইমেইল থাকে)
    if (book.userEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Forbidden: You can only delete your own books!" });
    }

    await db.collection("books").deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ success: true, message: "Book deleted successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to delete book", error: error.message });
  }
});

// ৯. বই আপডেট করার API (PATCH)
app.patch("/api/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    delete updatedData._id;

    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });
    
    // Authorization চেক
    if (book.userEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Forbidden: You can only update your own books!" });
    }

    await db.collection("books").updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
    res.status(200).send({ success: true, message: "Book updated successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to update book", error: error.message });
  }
});

// সার্ভার চালু করা
const PORT = process.env.NEXT_PUBLIC_API_URL;
app.listen(PORT, () => {
  
});