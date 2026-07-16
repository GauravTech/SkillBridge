// --- AUTH GUARD ---
// This checks if the user is logged in before showing the page content
(function() {
    const token = localStorage.getItem('token');
    const isPublicPage = window.location.pathname.includes('index.html') || 
                         window.location.pathname.includes('login.html') || 
                         window.location.pathname.includes('signup.html') ||
                         window.location.pathname === '/' ||
                         window.location.pathname.endsWith('/');
    
    // If not logged in and not already on the login/index page, redirect
    if (!token && !isPublicPage) {
        alert("Please login to access your dashboard.");
        window.location.href = 'login.html'; 
    }
})();

// --- Simple Login Logic ---
const loginBtn = document.querySelector('.login-trigger-btn'); // Add this class to your login button

if(loginBtn) {
    loginBtn.addEventListener('click', () => {
        localStorage.setItem('isLoggedIn', 'true');
        window.location.href = 'student-profile.html'; // Redirect after "login"
    });
}

// --- Logout Logic ---
const logoutBtn = document.getElementById('logout-btn'); // Add to your sidebar
if(logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        // Only handle if not already handled by another script
        if(e.defaultPrevented) return;
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('isLoggedIn');
        window.location.href = 'login.html';
    });
}
