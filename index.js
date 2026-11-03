const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();

// মিডলওয়্যার
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(express.json());
// JWT ভেরিফাই মিডলওয়্যার
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ success: false, message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    next(); 
  } catch (error) {
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
  } catch (error) {
  }
}

connectDB();


app.get("/", (req, res) => {
  res.send("BookNook Server is Running!");
});

// API (POST)
app.post("/api/books", verifyToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).send({ success: false, message: "Database not connected yet!" });
    }
    const bookData = req.body;
    const result = await db.collection("books").insertOne(bookData);
    res.status(201).send({ success: true, message: "Book added successfully", data: result });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to add book", error: error.message });
  }
});
// API (GET)
app.get("/api/books", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).send({ success: false, message: "Database not connected yet!" });
    }
    
    const books = await db.collection("books").find().sort({ addedAt: -1 }).toArray();
    res.status(200).send({ success: true, data: books });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch books", error: error.message });
  }
});

// API (GET by ID)
app.get("/api/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { ObjectId } = require("mongodb"); 
    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    
    if (!book) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }
    res.status(200).send({ success: true, data: book });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch book", error: error.message });
  }
});

// API (POST)
app.post("/api/borrows",verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail, ...rest } = req.body;
    const { ObjectId } = require("mongodb");

    const existingBorrow = await db.collection("borrows").findOne({ 
      bookId: bookId, 
      userEmail: userEmail 
    });
    
    if (existingBorrow) {
      return res.status(400).send({ success: false, message: "You have already borrowed this book!" });
    }
     // (Available Copies)
    const book = await db.collection("books").findOne({ _id: new ObjectId(bookId) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });
    
    if (!book.totalCopies || book.totalCopies <= 0) {
      return res.status(400).send({ success: false, message: "Book is not available right now!" });
    }

    // borrows 
    const result = await db.collection("borrows").insertOne({ bookId, userEmail, ...rest });
    
    await db.collection("books").updateOne(
      { _id: new ObjectId(bookId) },
      { $inc: { totalCopies: -1 } }
    );

    res.status(201).send({ success: true, message: "Book borrowed successfully", data: result });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to borrow book", error: error.message });
  }
});

// API (GET)
app.get("/api/my-borrows", async (req, res) => {
  try {
    const userEmail = req.query.email; // ফ্রন্টএন্ড থেকে ইমেইল নেওয়া
    if (!userEmail) return res.status(400).send({ success: false, message: "Email is required" });

    const borrows = await db.collection("borrows").find({ userEmail: userEmail }).sort({ borrowDate: -1 }).toArray();
    res.status(200).send({ success: true, data: borrows });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to fetch borrows", error: error.message });
  }
});

// API (DELETE)
app.delete("/api/borrows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { ObjectId } = require("mongodb");
    
    const borrowRecord = await db.collection("borrows").findOne({ _id: new ObjectId(id) });
    if (!borrowRecord) return res.status(404).send({ success: false, message: "Borrow record not found" });

    await db.collection("borrows").deleteOne({ _id: new ObjectId(id) });
    
    await db.collection("books").updateOne(
      { _id: new ObjectId(borrowRecord.bookId) },
      { $inc: { totalCopies: 1 } }
    );

    res.status(200).send({ success: true, message: "Book returned successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to return book", error: error.message });
  }
});

// API (GET)
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

// API (DELETE)
app.delete("/api/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { ObjectId } = require("mongodb");
    
    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });

    // Authorization
    if (book.userEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Forbidden: You can only delete your own books!" });
    }
    await db.collection("books").deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ success: true, message: "Book deleted successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to delete book", error: error.message });
  }
});

// API (PATCH)
app.patch("/api/books/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { ObjectId } = require("mongodb");
    const updatedData = req.body;
    delete updatedData._id; 

    const book = await db.collection("books").findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ success: false, message: "Book not found" });

    // Authorization চেক
    if (book.userEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Forbidden: You can only update your own books!" });
    } 
    await db.collection("books").updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
    res.status(200).send({ success: true, message: "Book updated successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to update book", error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
});