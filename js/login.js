document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const authCard = document.querySelector(".auth-card");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorElement = document.getElementById("login-error");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      const response = await fetch(
        "https://skillbridge-backend-qovl.onrender.com/api/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );

      const data = await response.json();

      if (response.ok) {
        // SUCCESS: Save 'Session' to LocalStorage
        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(data.user));

        // Redirect based on the role stored in your DB
        window.location.href =
          data.user.role === "mentor"
            ? "mentor-profile.html"
            : "student-profile.html";
      } else {
        // FAILURE: DB rejected credentials
        errorElement.textContent = data.message || "Invalid email or password";
        errorElement.style.display = "block";

        // 1. Shake the whole card
        authCard.classList.add("shake");

        // 2. APPLY RED BORDER TO BOTH FIELDS
        // Email's parent is .input-group
        emailInput.parentElement.classList.add("error");
        // Password's parent is .password-field, so we go up one more to .input-group
        passwordInput.closest(".input-group").classList.add("error");

        // 3. Reset shake animation
        setTimeout(() => {
          authCard.classList.remove("shake");
        }, 400);
      }
    } catch (err) {
      console.error("Connection error:", err);
      alert("Cannot connect to server. Is your Node.js app running?");
    }
  });

  // Clear error state as soon as user starts typing again
  [emailInput, passwordInput].forEach((input) => {
    input.addEventListener("input", () => {
      // Find the closest .input-group and remove the error class
      input.closest(".input-group").classList.remove("error");
      // Hide the error text
      errorElement.style.display = "none";
    });
  });
});

// Password Toggle Function
function togglePasswordVisibility(inputId, icon) {
  const passwordInput = document.getElementById(inputId);
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    passwordInput.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}
