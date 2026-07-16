const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("currentUser"));
const API_URL = "https://skillbridge-backend-qovl.onrender.com";

// === AUTH CHECK ===
if (!token || !user) {
  window.location.href = "login.html";
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

window.payNow = async function (bookingId, amount) {
  try {
    // 1. Create order from backend
    const res = await fetch(`${API_URL}/api/payments/razorpay/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      cache: "no-store",
      body: JSON.stringify({ amount }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || "Failed to create order");
      return;
    }

    // 2. Razorpay options
    const options = {
      key: "rzp_test_SgvjuT8Zz2MPy9", // ⚠️ replace this
      amount: data.order.amount,
      currency: "INR",
      name: "SkillBridge",
      description: "Mentorship Session",
      order_id: data.order.id,

      handler: async function (response) {
        // 3. Verify payment
        const verifyRes = await fetch(
          `${API_URL}/api/payments/razorpay/verify`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              ...response,
              bookingId: bookingId,
              amount: amount,
            }),
          },
        );

        const verifyData = await verifyRes.json();

        if (verifyRes.ok) {
          window.showToast("Payment Successful!");
          document.getElementById("success-modal").style.display = "flex";
          document.getElementById("booking-id").innerText = bookingId;
        } else {
          window.showToast("Payment Unsuccessful!");
        }
      },

      prefill: {
        name: user.name || "Student",
        email: "user@example.com",
      },

      theme: {
        color: "#4a90e2",
      },
    };

    // 4. Open Razorpay popup
    const rzp = new Razorpay(options);
    rzp.open();
  } catch (err) {
    console.error(err);
    alert("Payment failed to start");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  // === PAYMENT PAGE LOGIC ===
  const urlParams = new URLSearchParams(window.location.search);
  const bookingId = urlParams.get("bookingId");

  if (!bookingId) {
    alert("No booking ID found. Redirecting to profile.");
    window.location.href = "student-profile.html";
    return;
  }

  loadPaymentPage(bookingId);

  async function loadPaymentPage(bookingId) {
    try {
      const res = await fetch(`${API_URL}/api/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const booking = await res.json();

      if (!res.ok) {
        alert("Failed to load booking details.");
        return;
      }

      // Update UI
      document.getElementById("mentor-name-summary").textContent =
        booking.mentorName;
      document.getElementById("mentor-img-summary").src =
        booking.mentorPic || "assets/images/default-avatar.png";
      document.getElementById("mentor-rating-summary").textContent =
        booking.mentorRating.toFixed(1);
      document.getElementById("mentor-skill-summary").textContent =
        `Mentorship on: ${booking.topic}`;

      const duration = booking.duration || 10; // Defaulting to 10 mins as requested
      document.getElementById("session-duration").textContent =
        `${duration} mins`;

      // Format date and time
      let displayDate = booking.date;
      if (booking.date) {
        const dateObj = new Date(booking.date);
        if (!isNaN(dateObj)) {
          displayDate = dateObj.toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        }
      }
      document.getElementById("session-datetime").textContent =
        `${displayDate} at ${booking.time}`;

      // Calculate Prices Based on Rating
      // Formula: Total Amount = (Base Price × Rating × Duration) + Platform Commission
      let rating = Math.round(booking.mentorRating || 0);
      if (rating < 1) rating = 1;

      const basePrice = 5;
      const mentorAmount = basePrice * rating * duration;
      const platformFee = mentorAmount * 0.2; // 20% platform commission
      const finalPrice = mentorAmount + platformFee;

      document.getElementById("session-price").textContent =
        `₹${mentorAmount.toFixed(2)}`;
      document.getElementById("platform-fee").textContent =
        `₹${platformFee.toFixed(2)}`;
      document.getElementById("total-amount").textContent =
        `₹${finalPrice.toFixed(2)}`;
      document.getElementById("pay-amount-final").textContent =
        finalPrice.toFixed(2);

      // Checkout Button Event Listener
      const checkoutBtn = document.getElementById("razorpay-checkout-btn");
      if (checkoutBtn) {
        checkoutBtn.addEventListener("click", (e) => {
          e.preventDefault();
          window.payNow(bookingId, finalPrice);
        });
      }
    } catch (err) {
      console.error("Error loading payment page:", err);
      alert("Error loading payment page.");
    }
  }
});
