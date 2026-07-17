// --- CRITICAL: Add these missing element and state variables ---

// Side chat elements
const sideChatForm = document.getElementById("side-chat-form");
const sideMessageInput = document.getElementById("side-message-input");
const sideFileInput = document.getElementById("side-file-input");
const fileBtn = document.getElementById("file-btn"); // Correct ID from HTML
const sideChatMessages = document.getElementById("side-chat-messages");
const overlay = document.getElementById("image-overlay");
const enlargedImg = document.getElementById("enlarged-img");
const imageModal = document.getElementById("image-modal");
const modalImage = document.getElementById("modal-image");

// Video call elements
const localVideo = document.querySelector(".local-video video");
const remoteVideo = document.querySelector(".remote-video video");
const startCallBtn = document.getElementById("start-call");
const endCallBtn = document.getElementById("end-call");
const muteAudioBtn = document.getElementById("mute-audio");
const toggleVideoBtn = document.getElementById("toggle-video");
const screenShareBtn = document.getElementById("screen-share"); // <--- CRITICAL FIX: Select existing button
const timerDisplay = document.getElementById("timer");
const localUserLabel = document.getElementById("local-user-label");
const remoteUserLabel = document.getElementById("remote-user-label");

// State Variables
let localStream = null;
let peerConnection = null;
let timerInterval;
let seconds = 0;
let screenStream = null; // State for screen share stream
let pendingCandidates = [];
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// User Role Definition: Check localStorage to set the sender role dynamically
const currentUser = JSON.parse(localStorage.getItem("currentUser"));
const userRole = currentUser
  ? currentUser.role === "student"
    ? "Student"
    : "Mentor"
  : "Guest";

if (localUserLabel) {
  localUserLabel.textContent = "You";
}

if (remoteUserLabel) {
  remoteUserLabel.textContent = userRole === "Student" ? "Mentor" : "Student";
}

const socket =
  window.socket || io("https://skillbridge-backend-qovl.onrender.com");
if (!window.socket) {
  window.socket = socket;
  if (currentUser) socket.emit("joinChat", currentUser.id);
}

// --- START: REFINED ROOM ID LOGIC ---
// Get the room ID from the URL parameters (e.g., ?room=xyz789)
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get("bookingId") || urlParams.get("room");

// --- START: CORRECTED SIDE CHAT SEND MESSAGE/FILE ---
function enlargeImage(src) {
  const overlay = document.getElementById("image-overlay");
  const enlargedImg = document.getElementById("enlarged-img");
  if (overlay && enlargedImg) {
    enlargedImg.src = src;
    overlay.style.display = "flex";
  }
}

// --- START: Time Utility Function ---
function formatTime(date) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? "0" + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}
// --- END: Time Utility Function ---

// console.log("Joining Room:", roomId);

fileBtn.addEventListener("click", () => sideFileInput.click());

// If redirected via Accept Call, automatically accept and wait for offer
const autoJoin = urlParams.get("autoJoin");
if (autoJoin === "true" && currentUser) {
  socket.emit("callResponse", {
    callerId: urlParams.get("callerId"),
    accepted: true,
    roomId,
  });

  // START local camera immediately
  navigator.mediaDevices
    .getUserMedia({
      video: true,
      audio: true,
    })
    .then((stream) => {
      localStream = stream;
      localVideo.srcObject = stream;

      if (!peerConnection) {
        peerConnection = new RTCPeerConnection(config);
      }
      peerConnection.onconnectionstatechange = () => {
        console.log("STATE:", peerConnection.connectionState);

        if (peerConnection.connectionState === "connected") {
          startTimer();
        }

        if (peerConnection.connectionState === "disconnected") {
          console.log("User actually disconnected");
          remoteVideo.srcObject = null;
        }
      };

      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      peerConnection.ontrack = (event) => {
        if (!remoteVideo.srcObject) {
          console.log("Remote stream received", event.streams);
          remoteVideo.srcObject = event.streams[0];
          remoteVideo.onloadedmetadata = () => {
            remoteVideo.play();
          };
        }
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("iceCandidate", {
            candidate: event.candidate,
            room: roomId,
          });
        }
      };
    })
    .catch((err) => {
      console.error("Mentor media error:", err);
    });
}

sideChatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = sideMessageInput.value.trim();
  const file = sideFileInput.files[0];

  if (!message && !file) return;

  // FIX: Use the dynamically defined userRole
  const sender = userRole;

  // Data structure to be sent to server and appended locally
  const messageData = {
    room: roomId,
    message,
    sender,
    isFile: false,
    fileName: "",
    fileType: "",
    fileData: "",
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      // Update messageData with file details
      messageData.isFile = true;
      messageData.fileName = file.name;
      messageData.fileType = file.type;
      messageData.fileData = reader.result;

      // 1. Instantly display the message on the sender's screen
      appendMessage(messageData);

      // 2. Send to server for the other user
      socket.emit("sendMessage", messageData);

      sideFileInput.value = null; // Reset file input
    };
    reader.readAsDataURL(file);
  } else {
    // 1. Instantly display the message on the sender's screen
    appendMessage(messageData);

    // 2. Send to server for the other user
    socket.emit("sendMessage", messageData);
  }

  sideMessageInput.value = "";
});
// --- END: CORRECTED SIDE CHAT SEND MESSAGE/FILE ---

// Screen share control
// Screen share control logic
screenShareBtn.addEventListener("click", async () => {
  // Safe way to get icon
  const icon = screenShareBtn?.querySelector("i");

  try {
    if (!screenStream) {
      // 1. Screen capture permission mangein[cite: 3]
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      const screenTrack = screenStream.getVideoTracks()[0];

      // 2. PeerConnection check karein[cite: 3]
      if (peerConnection) {
        const sender = peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
      }

      // 3. Local preview update[cite: 3]
      localVideo.srcObject = screenStream;

      // 4. UI update (Crash prevention)[cite: 3]
      if (icon) icon.className = "fas fa-stop-circle";
      screenShareBtn.classList.add("sharing");

      // Browser ke default "Stop Sharing" button ke liye[cite: 3]
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } else {
      stopScreenShare();
    }
  } catch (err) {
    console.error("Screen share error:", err);
  }
});

// Update stopScreenShare to be safer[cite: 3]
function stopScreenShare() {
  if (!screenStream) return;

  screenStream.getTracks().forEach((track) => track.stop());
  screenStream = null;

  if (peerConnection && localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    const sender = peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(videoTrack);
    localVideo.srcObject = localStream;
  }

  // UI Reset[cite: 3]
  const icon = screenShareBtn?.querySelector("i");
  if (icon) icon.className = "fas fa-desktop";
  screenShareBtn.classList.remove("sharing");
}
// Video call control
startCallBtn.addEventListener("click", async () => {
  startCallBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  socket.emit("initiateCall", {
    roomId,
    callerId: currentUser.id,
    callerName: currentUser.name,
  });
});

socket.on("callFailed", (data) => {
  startCallBtn.innerHTML = '<i class="fas fa-phone"></i>';
  alert("Call Failed: " + data.reason);
});

socket.on("callResponse", async ({ accepted }) => {
  startCallBtn.innerHTML = '<i class="fas fa-phone"></i>';
  if (accepted) {
    await startWebRTC();
  } else {
    alert("The user declined your call.");
  }
});

function startTimer() {
  seconds = 0;
  timerDisplay.textContent = "00:00";
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    timerDisplay.textContent = `${mins}:${secs}`;
  }, 1000);
}

// console.log("Joining Room:", roomId);
socket.on("connect", () => {
  console.log("Socket Connected:", socket.id);

  socket.emit("joinRoom", roomId);
});

async function startWebRTC() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;

    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(config);
    }
    peerConnection.onconnectionstatechange = () => {
      console.log("STATE:", peerConnection.connectionState);

      if (peerConnection.connectionState === "connected") {
        startTimer();
      }

      if (peerConnection.connectionState === "disconnected") {
        console.log("User actually disconnected");
        remoteVideo.srcObject = null;
      }
    };
    localStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      if (!remoteVideo.srcObject) {
        console.log("Remote stream received", event.streams);
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.onloadedmetadata = () => {
          remoteVideo.play();
        };
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("iceCandidate", {
          candidate: event.candidate,
          room: roomId,
        });
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Offer sent");
    socket.emit("videoOffer", { offer, room: roomId });
  } catch (err) {
    console.error("Media error:", err);
  }
}

endCallBtn.addEventListener("click", () => {
  if (peerConnection) (peerConnection.close(), (peerConnection = null));
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }
  if (screenStream) {
    stopScreenShare(); // UI reset karne ke liye
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  clearInterval(timerInterval);
  timerDisplay.textContent = "00:00";

  const totalDuration = Math.ceil(seconds / 60); // minutes
  socket.emit("endCall", { roomId, duration: totalDuration });

  alert(`Call ended. Duration: ${totalDuration} minute(s).`);
});

// Corrected Mute Audio Logic
muteAudioBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;

  // UI Update
  const icon = muteAudioBtn.querySelector("i");
  const isMuted = !audioTrack.enabled;

  muteAudioBtn.classList.toggle("muted", isMuted);
  icon.className = isMuted ? "fas fa-microphone-slash" : "fas fa-microphone";
  muteAudioBtn.setAttribute(
    "aria-label",
    isMuted ? "Unmute Audio" : "Toggle Mute",
  );
});

// Corrected Toggle Video Logic
toggleVideoBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;

  // UI Update
  const icon = toggleVideoBtn.querySelector("i");
  const isVideoOff = !videoTrack.enabled;

  toggleVideoBtn.classList.toggle("muted", isVideoOff);
  icon.className = isVideoOff ? "fas fa-video-slash" : "fas fa-video";
  toggleVideoBtn.setAttribute(
    "aria-label",
    isVideoOff ? "Turn Video On" : "Toggle Video",
  );
});

// --- WebRTC Signaling Listeners ---
socket.on("videoOffer", async ({ offer }) => {
  try {
    // Create peer connection if not exists
    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(config);

      peerConnection.ontrack = (event) => {
        if (!remoteVideo.srcObject) {
          console.log("Remote stream received", event.streams);
          remoteVideo.srcObject = event.streams[0];
          remoteVideo.onloadedmetadata = () => {
            remoteVideo.play();
          };
        }
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("iceCandidate", {
            candidate: event.candidate,
            room: roomId,
          });
        }
      };
    }

    // Get local media ONLY if not already available
    if (!localStream) {
      console.log("Requesting camera access...");

      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localVideo.srcObject = localStream;

      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Set remote description FIRST
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log("Offer received");

    // Now add pending ICE candidates
    while (pendingCandidates.length) {
      await peerConnection.addIceCandidate(
        new RTCIceCandidate(pendingCandidates.shift()),
      );
    }

    // Create answer
    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    socket.emit("videoAnswer", {
      answer,
      room: roomId,
    });
  } catch (err) {
    console.error("Error handling video offer:", err);
  }
});

socket.on("videoAnswer", async ({ answer }) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  console.log("Answer received");

  while (pendingCandidates.length) {
    await peerConnection.addIceCandidate(
      new RTCIceCandidate(pendingCandidates.shift()),
    );
  }
});

socket.on("iceCandidate", async ({ candidate }) => {
  try {
    if (peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidates.push(candidate);
    }
  } catch (err) {
    console.error(err);
  }
});

// --- START: SIDE CHAT RECEIVE MESSAGE/FILE (CONSOLIDATED & CLEANED) ---
function appendMessage({
  message,
  sender,
  isFile,
  fileName,
  fileType,
  fileData,
}) {
  const isSent = sender === userRole;
  const msgEl = document.createElement("div");
  msgEl.classList.add("message", isSent ? "sent" : "received");
  const currentTime = formatTime(new Date());

  let contentHTML = "";

  if (isFile && fileData) {
    const fileText = message ? `<p>${message}</p>` : "";

    if (fileType.startsWith("image/")) {
      // FIX: Ensure the <div> is opened before the <img>
      contentHTML = `
                <div class="message-content">
                    <p class="file-info"><strong>${fileName}</strong></p>
                    ${fileText}
                   <img 
  src="${fileData}" 
  class="chat-image"
  alt="${fileName}"
/>

                </div>
            `;
    } else {
      contentHTML = `
                <div class="message-content">
                    <p class="file-info">File: <strong>${fileName}</strong></p>
                    ${fileText}
                    <a href="${fileData}" download="${fileName}" class="btn secondary small-btn">Download File</a>
                </div>
            `;
    }
  } else {
    contentHTML = `<div class="message-content"><p>${message}</p></div>`;
  }

  msgEl.innerHTML = `
        <span class="sender-name">${isSent ? "You" : sender}:</span>
        ${contentHTML}
        <span class="time">${currentTime}</span>
    `;

  sideChatMessages.appendChild(msgEl);
  sideChatMessages.scrollTop = sideChatMessages.scrollHeight;
}

// --- START: SIDE CHAT RECEIVE MESSAGE/FILE (CORRECTED) ---
// Socket listener for receiving messages (Call the dedicated function)
socket.on("receiveMessage", (data) => {
  // Pass the received data object directly to your existing rendering function
  appendMessage(data);
});
// --- END: SIDE CHAT RECEIVE MESSAGE/FILE (CORRECTED) ---

// video-call.js

// Listen for when the other user disconnects
socket.on("peerDisconnected", () => {
  console.log("Peer disconnected");

  // ONLY remove remote video
  remoteVideo.srcObject = null;

  // DO NOT close everything immediately
});

// ===============================
// IMAGE PREVIEW LOGIC
// ===============================
sideChatMessages.addEventListener("click", (e) => {
  if (e.target.classList.contains("chat-image")) {
    modalImage.src = e.target.src;
    imageModal.classList.remove("hidden");
  }
});

imageModal.addEventListener("click", () => {
  imageModal.classList.add("hidden");
  modalImage.src = "";
});

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
