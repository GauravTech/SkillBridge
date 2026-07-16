const token = localStorage.getItem("token");
const currentUser = JSON.parse(localStorage.getItem("currentUser"));

if (!token || !currentUser) {
  window.location.href = "login.html";
}

// Socket.io initialization
// Socket.io initialization
const socket = window.socket || io("http://localhost:3000");
if (!window.socket) {
  window.socket = socket;
  socket.emit("joinChat", currentUser.id);
}

window.showToast = function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

/* ===============================
   ELEMENTS
================================= */
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const typingIndicator = document.getElementById("typing-indicator");
const attachmentBtn = document.querySelector(".attachment-btn");
const attachmentMenu = document.getElementById("attachment-menu");
const profileAvatar = document.getElementById("profile-avatar");
const chatName = document.getElementById("chat-name");
const chatStatus = document.getElementById("chat-status");
const fileInput = document.getElementById("file-input");
const imageModal = document.getElementById("image-modal");
const modalImage = document.getElementById("modal-image");
const conversationList = document.querySelector(".conversation-list");

let activePersonId = null;
let activePersonName = "";
let contactsMap = {}; // Maps id -> { _id, name, profilePic, role }

/* ===============================
   LOAD CONTACTS
================================= */
async function loadContacts() {
  try {
    const response = await fetch("http://localhost:3000/api/chat/contacts", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(
        `Server returned ${response.status}. Please restart your Node server!`,
      );
    }

    const contacts = await response.json();

    conversationList.innerHTML = "";

    if (contacts.length === 0) {
      conversationList.innerHTML =
        '<li style="text-align:center; padding: 20px; color: #888;">No active chats.<br><br>Book a session with a mentor to start chatting!</li>';
      profileAvatar.src =
        "https://ui-avatars.com/api/?name=None&background=random";
      chatName.textContent = "No Contacts";
      chatStatus.innerHTML = '<i class="fas fa-circle"></i> Offline';
      chatStatus.style.color = "gray";
      chatMessages.innerHTML =
        '<p style="text-align:center; padding: 20px; color: #888;">You have no active conversations yet.</p>';
      messageInput.disabled = true;
      document.querySelector(".send-btn").disabled = true;
      return;
    }

    // Add users
    contacts.forEach((contact) => {
      contactsMap[contact._id] = contact;

      const li = document.createElement("li");
      li.dataset.id = contact._id;
      li.innerHTML = `
                <img src="${contact.profilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=random`}" alt="${contact.name}">
                <div class="status-dot offline" id="status-dot-${contact._id}"></div>
                <div class="details">
                  <div class="name-time">
                    <h4>${contact.name}</h4>
                  </div>
                  <p class="last-message">Tap to chat</p>
                </div>
            `;
      li.addEventListener("click", () => selectContact(contact._id));
      conversationList.appendChild(li);

      // Immediately ask the server if this contact is online
      socket.emit("checkOnlineStatus", contact._id);
    });

    // Check if there is a specific mentor name in URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlMentorName = urlParams.get("mentor");

    if (urlMentorName) {
      const matchedContact = contacts.find((c) => c.name === urlMentorName);
      if (matchedContact) {
        selectContact(matchedContact._id);
      } else if (contacts.length > 0) {
        selectContact(contacts[0]._id);
      }
    } else if (contacts.length > 0) {
      selectContact(contacts[0]._id);
    }
  } catch (err) {
    console.error("Failed to load contacts:", err);
    chatName.textContent = "Connection Error";
    chatStatus.innerHTML =
      '<i class="fas fa-exclamation-triangle"></i> Offline';
    chatStatus.style.color = "red";
    conversationList.innerHTML = `<li style="padding: 20px; color: red; font-size: 0.9rem;">⚠️ Could not reach the server API. <br><br><b>Please stop and restart your Node server</b> to load the new chat routes!</li>`;
  }
}

/* ===============================
   SELECT CONTACT
================================= */
function selectContact(contactId) {
  activePersonId = contactId;
  const contact = contactsMap[contactId];
  activePersonName = contact.name;

  document
    .querySelectorAll(".conversation-list li")
    .forEach((li) => li.classList.remove("active"));
  const activeLi = document.querySelector(
    `.conversation-list li[data-id="${contactId}"]`,
  );
  if (activeLi) activeLi.classList.add("active");

  profileAvatar.src =
    contact.profilePic ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=random`;

  let ratingHtml = "";
  if (contact.rating) {
    ratingHtml = `<span style="font-size: 0.8rem; color: #f1c40f; margin-left: 10px;"><i class="fas fa-star"></i> ${contact.rating.toFixed(1)}</span>`;
  }
  chatName.innerHTML = `${contact.name} ${ratingHtml}`;

  chatStatus.innerHTML = '<i class="fas fa-circle"></i> Checking status...';
  chatStatus.style.color = "gray";

  socket.emit("checkOnlineStatus", contactId);
  loadChatHistory(contactId);
}

/* ===============================
   LOAD CHAT HISTORY
================================= */
async function loadChatHistory(contactId) {
  chatMessages.innerHTML =
    '<p style="text-align:center; padding: 20px; color: #888;">Loading messages...</p>';

  try {
    const response = await fetch(
      `http://localhost:3000/api/chat/history/${contactId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const messages = await response.json();

    chatMessages.innerHTML = "";
    if (messages.length === 0) {
      chatMessages.innerHTML =
        '<p style="text-align:center; padding: 20px; color: #888;">No messages yet. Say hi!</p>';
    }

    messages.forEach((msg) => {
      renderMessage(msg);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    console.error("Failed to load history:", err);
    chatMessages.innerHTML =
      '<p style="text-align:center; padding: 20px; color: red;">Failed to load messages.</p>';
  }
}

/* ===============================
   RENDER A SINGLE MESSAGE
================================= */
function renderMessage(msg) {
  // Remove "No messages yet" if present
  if (chatMessages.querySelector('p[style*="text-align:center"]')) {
    chatMessages.innerHTML = "";
  }

  const isSentByMe = msg.senderId === currentUser.id;
  const msgEl = document.createElement("div");
  msgEl.className = `message ${isSentByMe ? "sent" : "received"}`;

  const timeStr = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  let tickHtml = "";
  if (isSentByMe) {
    if (msg.status === "seen")
      tickHtml =
        '<i class="fas fa-check-double" style="color: #4CAF50; margin-left: 5px;"></i>';
    else if (msg.status === "delivered")
      tickHtml =
        '<i class="fas fa-check-double" style="color: gray; margin-left: 5px;"></i>';
    else
      tickHtml =
        '<i class="fas fa-check" style="color: gray; margin-left: 5px;"></i>';
  }

  if (msg.msgType === "image") {
    msgEl.classList.add("image-message");
    msgEl.innerHTML = `
            <img src="${msg.src}" class="chat-image">
            <a href="${msg.src}" download="${msg.fileName}" class="download-btn">⬇ Download</a>
            <span class="time">${timeStr} ${tickHtml}</span>
        `;
  } else if (msg.msgType === "audio") {
    msgEl.innerHTML = `
            <audio controls src="${msg.src}"></audio>
            <a href="${msg.src}" download="${msg.fileName}" class="download-btn">⬇ Download</a>
            <span class="time">${timeStr} ${tickHtml}</span>
        `;
  } else if (msg.msgType === "video") {
    msgEl.innerHTML = `
            <video controls src="${msg.src}" class="chat-video"></video>
            <a href="${msg.src}" download="${msg.fileName}" class="download-btn">⬇ Download</a>
            <span class="time">${timeStr} ${tickHtml}</span>
        `;
  } else if (msg.msgType === "file") {
    msgEl.innerHTML = `
            <div class="file-box">
              <p class="file-name">📄 ${msg.fileName}</p>
              <a href="${msg.src}" download="${msg.fileName}" class="download-btn">⬇ Download</a>
            </div>
            <span class="time">${timeStr} ${tickHtml}</span>
        `;
  } else {
    msgEl.innerHTML = `
            <p>${msg.text}</p>
            <span class="time">${timeStr} ${tickHtml}</span>
        `;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ===============================
   SEND MESSAGE (TEXT)
================================= */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activePersonId) return;

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  socket.emit("stopTyping", {
    senderId: currentUser.id,
    receiverId: activePersonId,
  });

  const msgData = {
    receiverId: activePersonId,
    text,
    msgType: "text",
  };

  try {
    const response = await fetch("http://localhost:3000/api/chat/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(msgData),
    });
    const savedMsg = await response.json();

    renderMessage(savedMsg);

    // Emit via socket
    socket.emit("sendPrivateMessage", savedMsg);
  } catch (err) {
    console.error("Failed to send message:", err);
  }
});

/* ===============================
   FILE UPLOAD (BASE64)
================================= */
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || !activePersonId) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let msgType = "file";
    if (file.type.startsWith("image/")) msgType = "image";
    else if (file.type.startsWith("audio/")) msgType = "audio";
    else if (file.type.startsWith("video/")) msgType = "video";

    const msgData = {
      receiverId: activePersonId,
      text: "",
      msgType,
      src: reader.result,
      fileName: file.name,
    };

    try {
      const response = await fetch("http://localhost:3000/api/chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(msgData),
      });
      const savedMsg = await response.json();

      renderMessage(savedMsg);
      socket.emit("sendPrivateMessage", savedMsg);
    } catch (err) {
      console.error("Failed to send file:", err);
    }
  };

  reader.readAsDataURL(file);
  fileInput.value = "";
  attachmentMenu.classList.add("hidden");
});

let typingTimeout;
messageInput.addEventListener("input", () => {
  if (!activePersonId) return;
  socket.emit("typing", {
    senderId: currentUser.id,
    receiverId: activePersonId,
  });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stopTyping", {
      senderId: currentUser.id,
      receiverId: activePersonId,
    });
  }, 2000);
});

/* ===============================
   SOCKET RECEIVE
================================= */
socket.on("receivePrivateMessage", (data) => {
  // If the received message is from the currently active chat
  if (data.senderId === activePersonId) {
    renderMessage(data);
    socket.emit("markAsSeen", {
      messageId: data._id,
      senderId: activePersonId,
      receiverId: currentUser.id,
    });
  } else {
    window.showToast(
      `New message from ${contactsMap[data.senderId]?.name || "someone"}`,
    );
  }
});

socket.on("typing", (senderId) => {
  if (senderId === activePersonId) typingIndicator.classList.remove("hidden");
});

socket.on("stopTyping", (senderId) => {
  if (senderId === activePersonId) typingIndicator.classList.add("hidden");
});

socket.on("userOnline", (userId) => {
  // 1. Update Header if currently chatting
  if (userId === activePersonId) {
    chatStatus.innerHTML = '<i class="fas fa-circle"></i> Online';
    chatStatus.style.color = "#4CAF50";
  }
  // 2. Update Sidebar Dot
  const dot = document.getElementById(`status-dot-${userId}`);
  if (dot) {
    dot.classList.remove("offline");
    dot.classList.add("online");
  }
});

socket.on("userOffline", (userId) => {
  // 1. Update Header if currently chatting
  if (userId === activePersonId) {
    chatStatus.innerHTML = '<i class="fas fa-circle"></i> Offline';
    chatStatus.style.color = "gray";
  }
  // 2. Update Sidebar Dot
  const dot = document.getElementById(`status-dot-${userId}`);
  if (dot) {
    dot.classList.remove("online");
    dot.classList.add("offline");
  }
});

socket.on("messageSeen", ({ messageId, receiverId }) => {
  if (receiverId === activePersonId) {
    // Find message and update tick (a reload of history would be cleaner, but we can do it locally)
    loadChatHistory(activePersonId);
  }
});

/* ===============================
   ATTACHMENTS TOGGLE
================================= */
attachmentBtn.addEventListener("click", () => {
  attachmentMenu.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".attachment-wrapper")) {
    attachmentMenu.classList.add("hidden");
  }
});

document
  .querySelectorAll("#attach-document, #attach-photo-video, #attach-audio")
  .forEach((btn) => {
    btn.addEventListener("click", () => fileInput.click());
  });

/* ===============================
   IMAGE PREVIEW
================================= */
chatMessages.addEventListener("click", (e) => {
  if (e.target.classList.contains("chat-image")) {
    modalImage.src = e.target.src;
    imageModal.classList.remove("hidden");
  }
});

imageModal.addEventListener("click", () => {
  imageModal.classList.add("hidden");
  modalImage.src = "";
});

// INITIALIZE
loadContacts();

const homeLink = document.getElementById("home-link");

if (homeLink) {
  homeLink.addEventListener("click", (e) => {
    e.preventDefault();

    const currentUser = JSON.parse(localStorage.getItem("currentUser"));

    if (!currentUser) {
      window.location.href = "login.html";
      return;
    }

    if (currentUser.role === "student") {
      window.location.href = "student-profile.html";
    } else if (currentUser.role === "mentor") {
      window.location.href = "mentor-profile.html";
    } else {
      window.location.href = "index.html";
    }
  });
}
