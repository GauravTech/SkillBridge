require("dotenv").config();
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const PORT = process.env.PORT || 3000;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const app = express();
app.use(
  cors({
    origin: "https://skillbridge-frontend-pi.vercel.app",
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(express.static(__dirname));

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "https://skillbridge-frontend-pi.vercel.app",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const onlineUsers = new Set();

io.on("connection", (socket) => {
  socket.on("joinRoom", (room) => {
    socket.join(room);
    socket.currentRoom = room;

    console.log(`Socket ${socket.id} joined room ${room}`);

    const clients = io.sockets.adapter.rooms.get(room);

    console.log(
      `Room ${room} has ${clients ? clients.size : 0} client(s):`,
      clients ? [...clients] : [],
    );
  });

  // 1. Relay the Video Offer to the other person in the room
  socket.on("videoOffer", (data) => {
    console.log("Video Offer:", socket.id, "Room:", data.room);
    socket.to(data.room).emit("videoOffer", data);
  });

  // 2. Relay the Video Answer back to the person who started the call
  socket.on("videoAnswer", (data) => {
    console.log("Video Answer:", socket.id, "Room:", data.room);
    socket.to(data.room).emit("videoAnswer", data);
  });

  // 3. Relay ICE Candidates (network paths) so the devices can find each other
  socket.on("iceCandidate", (data) => {
    console.log("ICE Candidate:", socket.id, "Room:", data.room);
    socket.to(data.room).emit("iceCandidate", data);
  });

  socket.on("joinChat", (userId) => {
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.add(userId);
    io.emit("userOnline", userId);
  });

  socket.on("checkOnlineStatus", (userId) => {
    if (onlineUsers.has(userId)) socket.emit("userOnline", userId);
    else socket.emit("userOffline", userId);
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit("userOffline", socket.userId);
    }
  });

  socket.on("sendPrivateMessage", async (data) => {
    // Automatically deliver if receiver is online
    if (onlineUsers.has(data.receiverId)) {
      data.status = "delivered";
      // update in db
      await mongoose
        .model("Message")
        .findByIdAndUpdate(data._id, { status: "delivered" });
    }
    socket.to(data.receiverId).emit("receivePrivateMessage", data);
  });

  socket.on("typing", ({ senderId, receiverId }) => {
    socket.to(receiverId).emit("typing", senderId);
  });

  socket.on("stopTyping", ({ senderId, receiverId }) => {
    socket.to(receiverId).emit("stopTyping", senderId);
  });

  socket.on("markAsSeen", async ({ messageId, senderId, receiverId }) => {
    await mongoose
      .model("Message")
      .findByIdAndUpdate(messageId, { status: "seen" });
    socket.to(senderId).emit("messageSeen", { messageId, receiverId });
  });

  socket.on(
    "sendMessage",
    ({
      room,
      message,
      sender,
      isFile = false,
      fileName = "",
      fileType = "",
      fileData = "",
    }) => {
      socket.to(room).emit("receiveMessage", {
        message,
        sender,
        isFile,
        fileName,
        fileType,
        fileData,
      });
    },
  );

  socket.on("initiateCall", async ({ roomId, callerId, callerName }) => {
    try {
      const booking = await mongoose.model("Booking").findById(roomId);
      if (!booking) return;

      let receiverId;
      if (booking.studentId.toString() === callerId) {
        const mentor = await mongoose
          .model("User")
          .findOne({ name: booking.mentorName });
        if (mentor) receiverId = mentor._id.toString();
      } else {
        receiverId = booking.studentId.toString();
      }

      if (receiverId && onlineUsers.has(receiverId)) {
        socket
          .to(receiverId)
          .emit("incomingCall", { roomId, callerName, callerId });
      } else {
        socket.emit("callFailed", {
          reason: "User is offline or not responding.",
        });
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("callResponse", ({ callerId, accepted, roomId }) => {
    socket.to(callerId).emit("callResponse", { accepted, roomId });
  });

  socket.on("endCall", async ({ roomId, duration }) => {
    try {
      await mongoose
        .model("Booking")
        .findByIdAndUpdate(roomId, { status: "completed" });

      socket.to(roomId).emit("peerDisconnected", {
        id: socket.id,
      });
    } catch (err) {
      console.error(err);
    }
  });
});

// --- Database & Schema ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    match: [/^[A-Za-z\s]+$/, "Name must only contain alphabets"],
  },
  email: {
    type: String,
    required: true,
    unique: true,
    match: [/.+\@.+\..+/, "Please fill a valid email address"],
  },
  password: { type: String, required: true },
  role: { type: String, enum: ["student", "mentor"], required: true },
  bio: { type: String, default: "" },
  education: { type: String, default: "" },
  skills: { type: [String], default: [] },
  profilePic: { type: String, default: "" },
  rating: { type: Number, default: 4.0 },
  resetOTP: { type: String, default: null },
  otpExpires: { type: Date, default: null },
});
const User = mongoose.model("User", userSchema);

// 1. UPDATE THE SCHEMA (Around line 55)
const bookingSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  mentorName: { type: String, required: true },
  topic: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  duration: { type: Number, default: 10 },
  // status: pending, cancelled, rejected, accepted, paid, ongoing, completed
  status: {
    type: String,
    enum: [
      "pending",
      "cancelled",
      "rejected",
      "accepted",
      "paid",
      "ongoing",
      "completed",
    ],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

const Booking = mongoose.model("Booking", bookingSchema);

// --- Add Payment Schema ---
const paymentSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  transactionId: { type: String, unique: true },
  status: { type: String, default: "success" },
  createdAt: { type: Date, default: Date.now },
});
const Payment = mongoose.model("Payment", paymentSchema);

// --- Add Message Schema ---
const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  text: { type: String, default: "" },
  msgType: {
    type: String,
    enum: ["text", "image", "audio", "video", "file"],
    default: "text",
  },
  src: { type: String, default: "" },
  fileName: { type: String, default: "" },
  status: {
    type: String,
    enum: ["sent", "delivered", "seen"],
    default: "sent",
  },
  createdAt: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// --- Middleware (MUST BE DEFINED BEFORE ROUTES) ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ message: "Access denied" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
};

// --- Routes ---

app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role });
    await user.save();
    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ message: "Email already exists." });
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    res.json({
      token,
      user: { id: user._id, name: user.name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during login" });
  }
});

// --- FORGOT PASSWORD ROUTES ---

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    await transporter.sendMail({
      // FIXED: Ensure this matches your verified sender in Brevo
      from: "skillbridge.otp@gmail.com",
      to: email,
      subject: "Your Reset Code",
      html: `
                <div style="font-family: sans-serif; text-align: center; padding: 20px;">
                    <h2>Password Reset</h2>
                    <p>Use the code below to reset your password:</p>
                    <h1 style="letter-spacing: 5px; color: #6c5ce7;">${otp}</h1>
                    <p>Valid for 10 minutes.</p>
                </div>`,
    });
    res.json({ message: "OTP sent to your email!" });
  } catch (err) {
    console.error("BREVO ERROR:", err); // This prints the real error to your CMD
    res
      .status(500)
      .json({ message: "Error sending email. Check server console." });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.resetOTP !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }
    res.json({ message: "OTP verified successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || user.resetOTP !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired request" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOTP = null;
    user.otpExpires = null;
    await user.save();

    res.json({ message: "Password reset successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/users/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// POST: Create a new booking
app.post("/api/bookings", authenticateToken, async (req, res) => {
  try {
    const { mentorName, topic, date, time, duration } = req.body;
    const newBooking = new Booking({
      studentId: req.user.id, // ID extracted from JWT token by middleware
      mentorName,
      topic,
      date,
      time,
      duration: duration || 10,
      status: "pending",
    });
    await newBooking.save();
    res.status(201).json({ message: "Booking request successful!" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error saving booking", error: err.message });
  }
});

// GET: Fetch sessions for the logged-in student
app.get("/api/bookings/my-sessions", authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ studentId: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: "Error fetching sessions" });
  }
});

// GET: Fetch sessions for a specific mentor (by Mentor Name or ID)
app.get(
  "/api/bookings/mentor/:mentorId",
  authenticateToken,
  async (req, res) => {
    try {
      const mentor = await User.findById(req.params.mentorId);
      if (!mentor) return res.status(404).json({ message: "Mentor not found" });

      // Change .find() to include .populate('studentId', 'name')
      // This tells MongoDB: "Look at the studentId, find that user, and give me their name"
      const bookings = await Booking.find({ mentorName: mentor.name })
        .populate("studentId", "name")
        .sort({ createdAt: -1 });

      res.json(bookings);
    } catch (err) {
      res.status(500).json({ message: "Error fetching mentor sessions" });
    }
  },
);

// PATCH: Update booking status (Accept/Reject)
app.patch("/api/bookings/:id", authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    // VALIDATION: Ensure the status is one of the strictly allowed states
    console.log("PATCH request received with status:", status);
    if (
      ![
        "pending",
        "cancelled",
        "rejected",
        "accepted",
        "paid",
        "ongoing",
        "completed",
      ].includes(status)
    ) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: status },
      { new: true },
    );
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ message: "Error updating booking" });
  }
});

// GET booking details for payment page
app.get("/api/bookings/:id", authenticateToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const mentor = await User.findOne({
      name: booking.mentorName,
      role: "mentor",
    });

    res.json({
      ...booking.toObject(),
      mentorPic: mentor?.profilePic || "assets/images/default-avatar.png",
      mentorRating: mentor?.rating || 4.0,
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching booking details" });
  }
});

// --- Add Payment Route ---
app.post(
  "/api/payments/razorpay/order",
  authenticateToken,
  async (req, res) => {
    try {
      const { amount } = req.body;
      // Amount is expected in INR, Razorpay takes amount in paise (multiply by 100)
      const options = {
        amount: amount * 100,
        currency: "INR",
        receipt: "receipt_" + Date.now(),
      };

      const order = await razorpayInstance.orders.create(options);
      res.status(200).json({
        success: true,
        order,
      });
    } catch (err) {
      console.error("Razorpay order creation error:", err);
      res
        .status(500)
        .json({ message: "Failed to create order", error: err.message });
    }
  },
);

app.post(
  "/api/payments/razorpay/verify",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        bookingId,
        amount,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body;

      // Verify Signature
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac("sha256", razorpayInstance.key_secret)
        .update(body.toString())
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid payment signature" });
      }

      // 1. Create the payment record
      const newPayment = new Payment({
        bookingId,
        studentId: req.user.id,
        amount,
        method: "razorpay",
        transactionId: razorpay_payment_id,
      });
      await newPayment.save();

      // 2. Automatically set state to 'paid'
      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        { status: "paid" },
        { new: true },
      );

      // 3. REAL-TIME: Notify the mentor if they are online
      io.emit("paymentSuccess", {
        message: `New confirmed booking from ${req.user.id}`,
        booking: updatedBooking,
      });

      res.status(200).json({
        success: true,
        transactionId: razorpay_payment_id,
        message: "Payment verified and booking confirmed!",
      });
    } catch (err) {
      console.error("Razorpay verification error:", err);
      res.status(500).json({
        success: false,
        message: "Verification failed",
        error: err.message,
      });
    }
  },
);

// GET all mentors for the search page
app.get("/api/users/mentors", async (req, res) => {
  try {
    // Find users where role is 'mentor'
    const mentors = await User.find({ role: "mentor" }).select(
      "name bio skills profilePic role rating",
    );

    res.status(200).json(mentors);
  } catch (err) {
    console.error("Backend Error:", err);
    res.status(500).json({ message: "Server error fetching mentors" });
  }
});

app.put("/api/users/profile", authenticateToken, async (req, res) => {
  try {
    const { name, bio, skills, profilePic, education } = req.body; // Add profilePic here

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { name, bio, skills, profilePic, education }, // And here
      { new: true, runValidators: true },
    ).select("-password");

    res.json(updatedUser);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
// --- CHAT APIs ---
app.get("/api/chat/contacts", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    let contacts = [];
    if (user.role === "student") {
      const bookings = await Booking.find({ studentId: user._id });
      const mentorNames = [...new Set(bookings.map((b) => b.mentorName))];
      contacts = await User.find({
        role: "mentor",
        name: { $in: mentorNames },
      }).select("_id name profilePic role rating");
    } else if (user.role === "mentor") {
      const bookings = await Booking.find({ mentorName: user.name }).populate(
        "studentId",
        "_id name profilePic role rating",
      );
      const studentMap = {};
      bookings.forEach((b) => {
        if (b.studentId) studentMap[b.studentId._id] = b.studentId;
      });
      contacts = Object.values(studentMap);
    }
    res.json(contacts);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching contacts", error: err.message });
  }
});

app.get("/api/chat/history/:userId", authenticateToken, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { senderId: req.user.id, receiverId: req.params.userId },
        { senderId: req.params.userId, receiverId: req.user.id },
      ],
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching history", error: err.message });
  }
});

app.post("/api/chat/send", authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, msgType, src, fileName } = req.body;
    const newMsg = new Message({
      senderId: req.user.id,
      receiverId,
      text,
      msgType,
      src,
      fileName,
    });
    await newMsg.save();
    res.status(201).json(newMsg);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error sending message", error: err.message });
  }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
