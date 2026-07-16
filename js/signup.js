// 1. UI Logic & Live Validation (Wait for DOM to load)
document.addEventListener("DOMContentLoaded", () => {
  // Select Role Boxes
  const roleBoxes = document.querySelectorAll(".role-box");

  // Select Inputs for Live Validation
  const emailInput = document.getElementById("user-email");
  const firstNameInput = document.getElementById("first-name");
  const lastNameInput = document.getElementById("last-name");
  const passwordInput = document.getElementById("user-password");

  // REGEX Definitions
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // Requires .com/extension
  const nameRegex = /^[A-Za-z]+$/;
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  // --- Role Switching Logic ---
  roleBoxes.forEach((box) => {
    box.addEventListener("click", function () {
      roleBoxes.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      const radio = this.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
      }
    });
  });

  // --- Helper for Live Visuals (Red/Green) ---
  const toggleClass = (input, isValid) => {
    const group = input.parentElement;
    if (isValid) {
      group.classList.add("success");
      group.classList.remove("error");
    } else {
      group.classList.add("error");
      group.classList.remove("success");
    }
  };

  // --- Live Event Listeners ---
  emailInput.addEventListener("input", () =>
    toggleClass(emailInput, emailRegex.test(emailInput.value.trim())),
  );
  firstNameInput.addEventListener("input", () =>
    toggleClass(firstNameInput, nameRegex.test(firstNameInput.value.trim())),
  );
  lastNameInput.addEventListener("input", () =>
    toggleClass(lastNameInput, nameRegex.test(lastNameInput.value.trim())),
  );
  passwordInput.addEventListener("input", () =>
    toggleClass(passwordInput, passwordRegex.test(passwordInput.value)),
  );
});

// 2. Helper Function: Show Toast (Global)
function showErrorMessage(message) {
  const toast = document.getElementById("error-toast");
  const toastText = document.getElementById("error-toast-text");
  toastText.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

// 3. Form Submission Logic
document
  .getElementById("signup-form")
  .addEventListener("submit", async function (e) {
    e.preventDefault();

    const firstName = document.getElementById("first-name").value.trim();
    const lastName = document.getElementById("last-name").value.trim();
    const email = document.getElementById("user-email").value.trim();
    const password = document.getElementById("user-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const role = document.querySelector('input[name="role"]:checked').value;

    const errorDisplay = document.getElementById("password-match-error");
    const authCard = document.querySelector(".auth-card");

    // Validation Checks
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const nameRegex = /^[A-Za-z]+$/;
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
      showErrorMessage("Names must contain only letters!");
      authCard.classList.add("shake");
      return;
    }

    if (!emailRegex.test(email)) {
      showErrorMessage("Please enter a valid email (e.g., name@gmail.com)");
      authCard.classList.add("shake");
      return;
    }

    if (!passwordRegex.test(password)) {
      showErrorMessage("Password is too weak!");
      return;
    }

    if (password !== confirmPassword) {
      errorDisplay.style.display = "block";
      authCard.classList.add("shake");
      return;
    } else {
      errorDisplay.style.display = "none";
    }

    // API Call
    try {
      const response = await fetch(
        "https://skillbridge-backend-qovl.onrender.com/api/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${firstName} ${lastName}`,
            email,
            password,
            role,
          }),
        },
      );

      const data = await response.json();

      if (response.ok) {
        document.getElementById("success-modal").style.display = "flex";
        setTimeout(() => (window.location.href = "login.html"), 2500);
      } else {
        showErrorMessage(data.message || "Signup failed");
        authCard.classList.add("shake");
      }
    } catch (error) {
      showErrorMessage("Server connection error.");
    }
  });

function togglePasswordVisibility(inputId, icon) {
  const passwordInput = document.getElementById(inputId);

  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    passwordInput.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}
