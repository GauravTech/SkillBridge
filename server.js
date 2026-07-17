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
const fs = require("fs");
const PORT = process.env.PORT || 3000;
const path = require("path");
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

// Small dependency-free .env loader for local development. Environment values
// supplied by the host always win.
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]])
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    });
}

// Keep credentials out of source control.  Set these in the process environment
// (see .env.example) before deploying.
const JWT_SECRET = process.env.JWT_SECRET || "development-only-change-me";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
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
    origin: [
      "https://skillbridge-frontend-pi.vercel.app",
      "http://localhost:5500",
    ],
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(express.static(__dirname));

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: [
      "https://skillbridge-frontend-pi.vercel.app",
      "http://localhost:5500",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error("Invalid token"));
    socket.user = user;
    next();
  });
});

const onlineUsers = new Set();
const activeCalls = new Map(); // key: roomId, value: { callerId, receiverId, status, messageId }

io.on("connection", (socket) => {
  socket.on("joinRoom", async (room) => {
    const user = await mongoose
      .model("User")
      .findById(socket.user.id)
      .select("name");
    const isDirect =
      typeof room === "string" &&
      room.startsWith("direct_") &&
      room.split("_").slice(1).includes(socket.user.id);
    const booking = mongoose.Types.ObjectId.isValid(room)
      ? await mongoose.model("Booking").findById(room)
      : null;
    const isSessionParticipant =
      booking &&
      (booking.studentId.toString() === socket.user.id ||
        booking.mentorName === user?.name);
    if (!isDirect && !isSessionParticipant)
      return socket.emit("callFailed", {
        reason: "You are not allowed in this call.",
      });
    socket.join(room);
    socket.currentRoom = room;
  });

  // 1. Relay the Video Offer to the other person in the room
  socket.on("videoOffer", (data) => {
    if (socket.currentRoom !== data.room) return;
    socket.to(data.room).emit("videoOffer", data);
  });

  // 2. Relay the Video Answer back to the person who started the call
  socket.on("videoAnswer", (data) => {
    if (socket.currentRoom !== data.room) return;
    socket.to(data.room).emit("videoAnswer", data);
  });

  // 3. Relay ICE Candidates (network paths) so the devices can find each other
  socket.on("iceCandidate", (data) => {
    if (socket.currentRoom !== data.room) return;
    socket.to(data.room).emit("iceCandidate", data);
  });

  socket.on("joinChat", () => {
    const userId = socket.user.id;
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.add(userId);
    io.emit("userOnline", userId);
  });

  socket.on("checkOnlineStatus", (userId) => {
    if (onlineUsers.has(userId)) socket.emit("userOnline", userId);
    else socket.emit("userOffline", userId);
  });

  socket.on("disconnect", async () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit("userOffline", socket.userId);
    }
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit("peerDisconnected", { id: socket.id });
    }
    if (socket.activeCallRoom) {
      const roomId = socket.activeCallRoom;
      const activeCall = activeCalls.get(roomId);
      if (activeCall) {
        if (activeCall.status === "initiated") {
          try {
            const Message = mongoose.model("Message");
            const callMsg = await Message.findById(activeCall.messageId);
            if (callMsg) {
              callMsg.text = "❌ Missed call";
              await callMsg.save();
              io.to(activeCall.callerId).emit(
                "receivePrivateMessage",
                callMsg.toObject(),
              );
              io.to(activeCall.receiverId).emit(
                "receivePrivateMessage",
                callMsg.toObject(),
              );
            }
          } catch (err) {
            console.error("Error setting missed call on disconnect:", err);
          }
        }
        activeCalls.delete(roomId);
      }
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

  socket.on("initiateCall", async ({ roomId, receiverId }) => {
    try {
      const callerId = socket.user.id;
      const caller = await mongoose
        .model("User")
        .findById(callerId)
        .select("name");
      const callerName = caller?.name || "Someone";
      socket.activeCallRoom = roomId;

      let targetReceiverId = receiverId;
      if (!targetReceiverId) {
        if (mongoose.Types.ObjectId.isValid(roomId)) {
          const booking = await mongoose.model("Booking").findById(roomId);
          if (booking) {
            if (booking.studentId.toString() === callerId) {
              const mentor = await mongoose
                .model("User")
                .findOne({ name: booking.mentorName });
              if (mentor) targetReceiverId = mentor._id.toString();
            } else {
              targetReceiverId = booking.studentId.toString();
            }
          }
        }
      }

      if (!targetReceiverId) {
        socket.emit("callFailed", { reason: "Receiver could not be found." });
        return;
      }

      // Create video call message
      const Message = mongoose.model("Message");
      const callMsg = new Message({
        senderId: callerId,
        receiverId: targetReceiverId,
        text: "📹 Video Call",
        msgType: "call_event",
        status: "sent",
      });
      await callMsg.save();

      // Save to activeCalls
      activeCalls.set(roomId, {
        callerId,
        receiverId: targetReceiverId,
        status: "initiated",
        messageId: callMsg._id.toString(),
      });

      if (onlineUsers.has(targetReceiverId)) {
        callMsg.status = "delivered";
        await callMsg.save();

        io.to(targetReceiverId).emit("incomingCall", {
          roomId,
          callerName,
          callerId,
        });
        io.to(targetReceiverId).emit(
          "receivePrivateMessage",
          callMsg.toObject(),
        );
        io.to(callerId).emit("receivePrivateMessage", callMsg.toObject());
      } else {
        callMsg.text = "❌ Missed call";
        await callMsg.save();
        activeCalls.delete(roomId);
        socket.emit("callFailed", {
          reason: "User is offline or not responding.",
        });
        socket.emit("receivePrivateMessage", callMsg.toObject());
      }
    } catch (err) {
      console.error(err);
      socket.emit("callFailed", { reason: "Server error starting call." });
    }
  });

  socket.on("callResponse", async ({ callerId, accepted, roomId }) => {
    try {
      const activeCall = activeCalls.get(roomId);
      if (activeCall) {
        if (activeCall.receiverId !== socket.user.id) return;
        if (accepted) {
          activeCall.status = "accepted";

          // Create "📞 Joined video call" message from receiver to caller
          const Message = mongoose.model("Message");
          const joinMsg = new Message({
            senderId: activeCall.receiverId,
            receiverId: activeCall.callerId,
            text: "📞 Joined video call",
            msgType: "call_event",
            status: "sent",
          });
          await joinMsg.save();

          // Emit to both
          io.to(activeCall.callerId).emit(
            "receivePrivateMessage",
            joinMsg.toObject(),
          );
          io.to(activeCall.receiverId).emit(
            "receivePrivateMessage",
            joinMsg.toObject(),
          );
        } else {
          // Missed call
          const Message = mongoose.model("Message");
          const callMsg = await Message.findById(activeCall.messageId);
          if (callMsg) {
            callMsg.text = "❌ Missed call";
            await callMsg.save();
            io.to(activeCall.callerId).emit(
              "receivePrivateMessage",
              callMsg.toObject(),
            );
            io.to(activeCall.receiverId).emit(
              "receivePrivateMessage",
              callMsg.toObject(),
            );
          }
          activeCalls.delete(roomId);
        }
      }
      socket.to(callerId).emit("callResponse", { accepted, roomId });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("endCall", async ({ roomId, duration }) => {
    try {
      const activeCall = activeCalls.get(roomId);
      if (activeCall) {
        if (
          ![activeCall.callerId, activeCall.receiverId].includes(socket.user.id)
        )
          return;
        if (
          activeCall.status === "accepted" &&
          mongoose.Types.ObjectId.isValid(roomId)
        ) {
          await mongoose
            .model("Booking")
            .findByIdAndUpdate(roomId, { status: "completed" });
        }
        if (activeCall.status === "initiated") {
          const Message = mongoose.model("Message");
          const callMsg = await Message.findById(activeCall.messageId);
          if (callMsg) {
            callMsg.text = "❌ Missed call";
            await callMsg.save();
            io.to(activeCall.callerId).emit(
              "receivePrivateMessage",
              callMsg.toObject(),
            );
            io.to(activeCall.receiverId).emit(
              "receivePrivateMessage",
              callMsg.toObject(),
            );
          }
        }
        activeCalls.delete(roomId);

        if (activeCall.status === "accepted") {
          const Message = mongoose.model("Message");
          const endMsg = await new Message({
            senderId: socket.user.id,
            receiverId:
              activeCall.callerId === socket.user.id
                ? activeCall.receiverId
                : activeCall.callerId,
            text: "📴 Video call ended",
            msgType: "call_event",
            status: "sent",
          }).save();
          io.to(activeCall.callerId).emit(
            "receivePrivateMessage",
            endMsg.toObject(),
          );
          io.to(activeCall.receiverId).emit(
            "receivePrivateMessage",
            endMsg.toObject(),
          );
        }
      }

      // The client must wait for this event before offering a session review;
      // at this point the completed status and the end message are committed.
      if (activeCall?.status === "accepted") {
        io.to(activeCall.callerId).emit("callEnded", {
          roomId,
          completed: true,
        });
        io.to(activeCall.receiverId).emit("callEnded", {
          roomId,
          completed: true,
        });
      }

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
  rating: { type: Number, default: 0.0 },
  positiveReviewsCount: { type: Number, default: 0 },
  negativeReviewsCount: { type: Number, default: 0 },
  totalReviewsCount: { type: Number, default: 0 },
  resetOTP: { type: String, default: null },
  otpExpires: { type: Date, default: null },
});
const User = mongoose.model("User", userSchema);

const reviewSchema = new mongoose.Schema({
  mentorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true,
    unique: true,
  },
  rating: { type: Number, required: true, min: 1, max: 5 },
  reviewText: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Review = mongoose.model("Review", reviewSchema);

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
    enum: ["text", "image", "audio", "video", "file", "call_event"],
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

  jwt.verify(token, JWT_SECRET, (err, user) => {
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
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "1h",
    });
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

    try {
      await transporter.verify();
      console.log("SMTP Connected Successfully");
    } catch (err) {
      console.error("SMTP VERIFY FAILED:", err);
    }

    await transporter.sendMail({
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

// GET: Find active booking between logged-in user and another user
app.get(
  "/api/bookings/active-between/:otherUserId",
  authenticateToken,
  async (req, res) => {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.otherUserId;
      const otherUser = await User.findById(otherUserId);
      if (!otherUser) return res.status(404).json({ bookingId: null });

      let booking = null;
      if (req.user.role === "student") {
        // Current user is student, other is mentor
        booking = await Booking.findOne({
          studentId: currentUserId,
          mentorName: otherUser.name,
          status: { $in: ["paid", "ongoing"] },
        }).sort({ createdAt: -1 });
      } else {
        // Current user is mentor, other is student — look up mentor's name from DB
        const currentUserDoc =
          await User.findById(currentUserId).select("name");
        if (!currentUserDoc) return res.json({ bookingId: null });
        booking = await Booking.findOne({
          studentId: otherUserId,
          mentorName: currentUserDoc.name,
          status: { $in: ["paid", "ongoing"] },
        }).sort({ createdAt: -1 });
      }

      if (booking) {
        res.json({ bookingId: booking._id });
      } else {
        res.json({ bookingId: null });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ bookingId: null });
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

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const actor = await User.findById(req.user.id).select("name role");
    const isStudent = booking.studentId.toString() === req.user.id;
    const isMentor =
      actor?.role === "mentor" && booking.mentorName === actor.name;
    const allowed =
      (isStudent && status === "cancelled" && booking.status === "pending") ||
      (isMentor &&
        ["accepted", "rejected"].includes(status) &&
        booking.status === "pending");
    if (!allowed)
      return res
        .status(403)
        .json({ message: "You cannot make this booking change" });

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
      mentorRating: mentor?.rating || 0.0,
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
      "name bio skills profilePic role rating positiveReviewsCount negativeReviewsCount totalReviewsCount",
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
        "_id name profilePic role",
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

app.get("/api/chat/unread-count", authenticateToken, async (req, res) => {
  try {
    const count = await Message.countDocuments({
      receiverId: req.user.id,
      status: { $ne: "seen" },
    });
    res.json({ count });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error getting unread count", error: err.message });
  }
});

app.post("/api/chat/mark-all-seen", authenticateToken, async (req, res) => {
  try {
    const { senderId } = req.body;
    await Message.updateMany(
      { senderId, receiverId: req.user.id, status: { $ne: "seen" } },
      { status: "seen" },
    );
    // Emit socket event to the sender so their ticks update
    io.to(senderId).emit("messageSeen", { receiverId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error marking messages as seen", error: err.message });
  }
});

// POST: Submit a review for a session (completed booking)
app.post("/api/reviews", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can submit reviews." });
    }

    const { bookingId, rating, reviewText } = req.body;

    // 1. Validate inputs
    if (
      !bookingId ||
      !rating ||
      typeof reviewText !== "string" ||
      !reviewText.trim()
    ) {
      return res
        .status(400)
        .json({ message: "Booking ID, rating, and review text are required." });
    }

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ message: "Invalid session booking ID." });
    }

    const ratingVal = Number(rating);
    if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5." });
    }

    // Validate word count (max 200 words)
    const words = reviewText
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length > 200) {
      return res
        .status(400)
        .json({ message: "Review text cannot exceed 200 words." });
    }

    // 2. Fetch booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Session booking not found." });
    }

    // 3. Ensure student matches booking's studentId
    if (booking.studentId.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only review sessions you booked." });
    }
    if (booking.status !== "completed") {
      return res.status(400).json({
        message: "A review can only be submitted after a completed session.",
      });
    }

    // 4. Find the mentor
    const mentor = await User.findOne({
      name: booking.mentorName,
      role: "mentor",
    });
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found." });
    }

    // 5. Ensure duplicate reviews for the same session are not allowed
    const existingReview = await Review.findOne({ bookingId });
    if (existingReview) {
      return res.status(400).json({
        message: "You have already submitted a review for this session.",
      });
    }

    // 6. Create and save the review
    const review = new Review({
      mentorId: mentor._id,
      studentId: req.user.id,
      bookingId,
      rating: ratingVal,
      reviewText: reviewText.trim(),
    });
    await review.save();

    // 7. Recalculate mentor rating statistics
    const mentorReviews = await Review.find({ mentorId: mentor._id });
    const totalReviews = mentorReviews.length;
    const sumRatings = mentorReviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalReviews > 0 ? sumRatings / totalReviews : 0.0;

    const positiveReviewsCount = mentorReviews.filter(
      (r) => r.rating >= 3,
    ).length;
    const negativeReviewsCount = mentorReviews.filter(
      (r) => r.rating <= 2,
    ).length;

    // Update mentor immediately
    mentor.rating = Number(averageRating.toFixed(2));
    mentor.totalReviewsCount = totalReviews;
    mentor.positiveReviewsCount = positiveReviewsCount;
    mentor.negativeReviewsCount = negativeReviewsCount;
    await mentor.save();

    res.status(201).json({
      message: "Review submitted successfully!",
      review: {
        id: review._id,
        rating: review.rating,
        reviewText: review.reviewText,
        createdAt: review.createdAt,
      },
      updatedRating: mentor.rating,
    });
  } catch (err) {
    console.error("Submit review error:", err);
    if (err?.code === 11000) {
      return res.status(400).json({
        message: "You have already submitted a review for this session.",
      });
    }
    res
      .status(500)
      .json({ message: "Server error submitting review.", error: err.message });
  }
});

// GET: Fetch reviews for a specific mentor, ordered by priority:
// 1. Higher ratings first (5 down to 1)
// 2. Newest reviews first
app.get("/api/reviews/mentor/:mentorId", async (req, res) => {
  try {
    const { mentorId } = req.params;

    // We populate student name for display purposes
    const reviews = await Review.find({ mentorId })
      .populate("studentId", "name profilePic")
      .sort({ rating: -1, createdAt: -1 });

    const mentor = await User.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }

    res.status(200).json({
      reviews,
      stats: {
        averageRating: mentor.rating || 0.0,
        totalReviewsCount: mentor.totalReviewsCount || 0,
        positiveReviewsCount: mentor.positiveReviewsCount || 0,
        negativeReviewsCount: mentor.negativeReviewsCount || 0,
      },
    });
  } catch (err) {
    console.error("Fetch reviews error:", err);
    res.status(500).json({ message: "Server error fetching reviews." });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
