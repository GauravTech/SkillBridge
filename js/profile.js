// === 1. GLOBAL SCOPE FUNCTIONS ===
window.openBooking = function(mentorName) {
    const modal = document.getElementById('booking-modal');
    const nameSpan = document.getElementById('modal-mentor-name');
    if (modal && nameSpan) {
        nameSpan.innerHTML = `With: <strong>${mentorName}</strong>`;
        modal.style.display = 'flex';
    }
};

window.openReview = function(mentorName, rating) {
    const modal = document.getElementById('review-modal');
    if (modal) {
        document.getElementById('modal-review-mentor-name').innerText = `Reviews for ${mentorName}`;
        document.getElementById('modal-mentor-rating').innerText = `${parseFloat(rating).toFixed(1)}/5`;
        modal.style.display = 'flex';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('currentUser'));
    // === 2. SELECTORS ===
    const nameDisplay = document.getElementById('profile-name-main');
    const nameInput = document.getElementById('name-edit');
    const bioDisplay = document.getElementById('profile-bio'); 
    const bioInput = document.getElementById('bio-edit');      
    const wordCountDisplay = document.getElementById('word-count');
    const profilePic = document.getElementById('profile-picture');
    const uploadInput = document.getElementById('upload-pic');
    const editBtn = document.getElementById('edit-profile-btn');
    const saveBtn = document.getElementById('save-profile-btn');
    const editSkillsContainer = document.getElementById('skills-container');
    const summarySkillsContainer = document.getElementById('profile-skills-summary');
    const progressText = document.getElementById('progress-text');
    const progressCircle = document.querySelector('.progress-circle');
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const modal = document.getElementById('booking-modal');
    const closeBtn = document.querySelector('.close-modal');

    const searchInput = document.getElementById('mentor-search');
    const filterSelect = document.getElementById('mentor-filter');

    let isEditMode = false; 
    let allMentors = []; 



     // === AUTH CHECK ===
    if (!token || !user) {
        window.location.href = 'login.html';
        return;
    }

    // === PROFILE IMAGE BASE64 CONVERSION ===
uploadInput.addEventListener('change', () => {
    const file = uploadInput.files[0];
    if (!file) return;

    // Optional size check (recommended)
    if (file.size > 2 * 1024 * 1024) {
        showToast("Image size must be under 2MB");
        uploadInput.value = "";
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        // This is BASE64 string
        profilePic.src = reader.result;

        calculateProgress(); // update profile completion
    };

    reader.readAsDataURL(file); //  converts image → base64
});


    // === 3. LIVE WORD COUNTER ===
    if (bioInput && wordCountDisplay) {
        bioInput.addEventListener('input', () => {
            const words = bioInput.value.trim().split(/\s+/).filter(w => w.length > 0);
            const count = words.length;
            wordCountDisplay.textContent = count;
            const isTooLong = count > 200;
            
            wordCountDisplay.style.color = isTooLong ? "var(--warning-color)" : "inherit";
            saveBtn.disabled = isTooLong;
            saveBtn.style.opacity = isTooLong ? "0.5" : "1";
        });
    }

    // === 4. TAB SWITCHING ===
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetTab = link.getAttribute('data-tab');
            console.log("Switching to tab:", targetTab); // DEBUG LINE
            tabLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            tabPanels.forEach(p => {
                p.style.display = p.id === targetTab ? (targetTab === 'edit-profile' ? 'grid' : 'block') : 'none';
            });

            if (targetTab === 'activity-log') {
                console.log("Loading activity data..."); // DEBUG LINE
                loadUpcomingSessions(); // Refresh data whenever tab is clicked
            }

            if (targetTab === 'mentor-booking') {
                loadMentors();
            }
        });
    });

    // === 5. MODAL CLOSING ===
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { 
        if (e.target == modal) modal.style.display = 'none'; 
        const reviewModal = document.getElementById('review-modal');
        if (reviewModal && e.target == reviewModal) reviewModal.style.display = 'none';
    };

    // === 6. SKILL MANAGEMENT ===
    const addSkillBtn = document.getElementById('add-skill-btn');
    
    // Core function to create tags with ACTIVE removal logic
    function createSkillTag(name, ref) {
        const span = document.createElement('span');
        span.className = 'skill-tag';
        span.innerHTML = `${name} <button class="remove-skill" type="button">&times;</button>`;
        
        // Attach event listener immediately to the new button
        span.querySelector('.remove-skill').addEventListener('click', () => {
            if (!isEditMode) return;
            span.remove();
            calculateProgress();
            updateSummarySkills();
        });

        editSkillsContainer.insertBefore(span, ref);
    }

    if (addSkillBtn) {
        addSkillBtn.addEventListener('click', () => {
            if (!isEditMode) return;
            if (document.querySelector('.skill-input-inline')) return;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'skill-input-inline';
            input.placeholder = 'Skill name...';
            editSkillsContainer.insertBefore(input, addSkillBtn);
            input.focus();

            const finalizeSkill = () => {
                const value = input.value.trim();
                if (value !== "") {
                    // Check for duplicates
                    const existing = Array.from(editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)'))
                        .map(t => t.firstChild.textContent.trim().toLowerCase());
                    
                    if (!existing.includes(value.toLowerCase())) {
                        createSkillTag(value, addSkillBtn);
                        calculateProgress();
                        updateSummarySkills();
                    }
                }
                input.remove();
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finalizeSkill(); });
            input.addEventListener('blur', finalizeSkill);
        });
    }

    // === 7. MENTOR FETCH & RENDER LOGIC ===
    async function loadMentors() {
        const mentorGrid = document.getElementById('mentor-grid');
        if (!mentorGrid) return;

        mentorGrid.innerHTML = '<p>Finding mentors...</p>';
        try {
            const response = await fetch('http://localhost:3000/api/users/mentors');
            allMentors = await response.json();
            renderMentors(allMentors);
        } catch (error) {
            mentorGrid.innerHTML = '<p>Error loading mentor list.</p>';
        }
    }

    function renderMentors(mentorsToDisplay) {
        const mentorGrid = document.getElementById('mentor-grid');
        if (!mentorGrid) return;
        mentorGrid.innerHTML = '';

        if (mentorsToDisplay.length === 0) {
            mentorGrid.innerHTML = '<p>No mentors found matching your search.</p>';
            return;
        }

        mentorsToDisplay.forEach(mentor => {
            const card = document.createElement('div');
            card.className = 'mentor-card';
            card.innerHTML = `
                <div class="mentor-header">
                    <img src="${mentor.profilePic || 'assets/images/default-avatar.png'}" class="mentor-avatar">
                    <div class="mentor-title">
                        <h3>${mentor.name}</h3>
                        <span class="role-badge">Mentor</span>
                    </div>
                </div>
                <div class="mentor-body">
                    <p class="mentor-bio-text">${mentor.bio || 'No bio available.'}</p>
                    <div class="mentor-skills-grid">
                        ${mentor.skills.map(s => `<span class="skill-pill">${s}</span>`).join('')}
                    </div>
                </div>
                <div class="mentor-actions" style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
                    <button class="book-btn" onclick="window.openBooking('${mentor.name}')" style="flex:1;">
                        <i class="fas fa-calendar-check"></i> Book Session
                    </button>
                    <button class="review-btn" onclick="window.openReview('${mentor.name}', ${mentor.rating || 4.5})" style="padding: 10px 15px; background: #fff; border: 1px solid var(--accent-color); color: var(--accent-color); border-radius: 5px; cursor: pointer; font-size: 0.9rem; font-weight: 500;">
                        Review
                    </button>
                </div>
            `;
            mentorGrid.appendChild(card);
        });
    }

    // === 8. SEARCH & FILTER LOGIC ===
    searchInput?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allMentors.filter(m => 
            m.name.toLowerCase().includes(term) || 
            m.skills.some(s => s.toLowerCase().includes(term))
        );
        renderMentors(filtered);
    });

    filterSelect?.addEventListener('change', (e) => {
        const category = e.target.value.toLowerCase();
        const filtered = category === 'all' ? allMentors : 
            allMentors.filter(m => m.skills.some(s => s.toLowerCase().includes(category)));
        renderMentors(filtered);
    });

    // === 9. PROFILE DATA (FETCH/SAVE) ===
    async function loadUserProfile() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('http://localhost:3000/api/users/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                nameDisplay.textContent = data.name || "User Name";
                bioDisplay.textContent = data.bio || "No bio added yet.";
                nameInput.value = data.name || "";
                bioInput.value = data.bio || "";
                profilePic.src = data.profilePic || 'assets/images/default-avatar.png';
                
                // Clear existing tags to prevent doubling
                const existingTags = editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)');
                existingTags.forEach(t => t.remove());

                if (data.skills) data.skills.forEach(skill => createSkillTag(skill, addSkillBtn));
                
                updateSummarySkills();
                calculateProgress();
            }
        } catch (err) { console.error("Profile load error:", err); }
    }

    saveBtn.addEventListener('click', async () => {
        const body = {
            name: nameInput.value,
            bio: bioInput.value,
            profilePic: profilePic.src,
            skills: Array.from(editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)'))
                         .map(t => t.firstChild.textContent.trim())
        };

        try {
            saveBtn.textContent = "Saving...";
            const res = await fetch('http://localhost:3000/api/users/profile', {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}` 
                },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                showToast("Profile Updated!");
                toggleEditMode(false);
                loadUserProfile(); // Re-sync UI with database
            }
        } catch (err) { showToast("Error saving profile."); }
        finally { saveBtn.textContent = "Save Changes"; }
    });

    // === 10. UI HELPERS ===
    function toggleEditMode(showEdit) {
        isEditMode = showEdit;
        editBtn.textContent = isEditMode ? "Cancel Changes" : "Edit Profile";
        saveBtn.style.display = isEditMode ? "inline-block" : "none";
        
        [nameDisplay, bioDisplay].forEach(el => el.style.display = isEditMode ? "none" : "block");
        [nameInput, bioInput].forEach(el => el.style.display = isEditMode ? "block" : "none");
        
        const counterDiv = document.getElementById('bio-counter');
        if (counterDiv) counterDiv.style.display = isEditMode ? "block" : "none";
    }

    editBtn.addEventListener('click', () => toggleEditMode(!isEditMode));

    function updateSummarySkills() {
        summarySkillsContainer.innerHTML = "";
        editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)').forEach(tag => {
            const sTag = document.createElement('span');
            sTag.className = 'skill-tag';
            sTag.textContent = tag.firstChild.textContent.trim();
            summarySkillsContainer.appendChild(sTag);
        });
    }

    function calculateProgress() {
        let score = 0;
        if (nameDisplay.textContent.trim() !== "" && nameDisplay.textContent !== "User Name") score += 25;
        if (bioDisplay.textContent.length > 10 && !bioDisplay.textContent.includes("No bio")) score += 25;
        if (summarySkillsContainer.children.length > 0) score += 25;
        if (!profilePic.src.includes('default-avatar')) score += 25;
        
        progressText.textContent = `${score}%`;
        progressCircle.style.background = `conic-gradient(var(--accent-color) ${(score/100)*360}deg, #e0e0e0 0deg)`;
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

  // === 11. ACTIVITY TAB DYNAMIC LOADING ===
    async function loadUpcomingSessions() {
        const activeList = document.getElementById('active-sessions-list');
        const historyList = document.getElementById('history-sessions-list');
        if (!activeList || !historyList) return;

        // Show initial loading state
        activeList.innerHTML = '<p class="loading-msg">Loading sessions...</p>';
        historyList.innerHTML = '';

        try {
            const res = await fetch('http://localhost:3000/api/bookings/my-sessions', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const bookings = await res.json();

            // Clear containers
            activeList.innerHTML = '';
            historyList.innerHTML = '';

            // 1. Check if there are absolutely no bookings at all
            if (bookings.length === 0) {
                activeList.innerHTML = '<div class="empty-msg">No active sessions. Book a mentor to get started!</div>';
                historyList.innerHTML = '<div class="empty-msg">No session history.</div>';
                return;
            }

            const activeStates = ['pending', 'accepted', 'paid', 'ongoing'];
            const historyStates = ['cancelled', 'rejected', 'completed'];

            const hasActive = bookings.some(b => activeStates.includes(b.status));
            const hasHistory = bookings.some(b => historyStates.includes(b.status));

            if (!hasActive) activeList.innerHTML = '<div class="empty-msg">No active sessions.</div>';
            if (!hasHistory) historyList.innerHTML = '<div class="empty-msg">No session history.</div>';

            bookings.forEach(booking => {
                let month = "TBD";
                let day = "??";
                
                if (booking.date) {
                    const dateObj = new Date(booking.date);
                    if (!isNaN(dateObj.getTime())) {
                        month = dateObj.toLocaleString('default', { month: 'short' }).toUpperCase();
                        day = dateObj.getDate();
                    }
                }

                // Determine what action button to show the student
                let actionHtml = '';
                if (booking.status === 'pending') {
                    actionHtml = `
                        <button class="join-btn" disabled style="background-color: #f1c40f; color: #333; opacity: 0.8; cursor: not-allowed; border:none;"><i class="fas fa-hourglass-half"></i> Pending</button>
                        <button onclick="updateStudentStatus('${booking._id}', 'cancelled')" class="join-btn" style="background-color: #e74c3c; color: white; border:none; cursor:pointer;"><i class="fas fa-times"></i> Cancel</button>
                    `;
                } else if (booking.status === 'accepted') {
                    actionHtml = `
                        <a href="payment.html?bookingId=${booking._id}&mentor=${encodeURIComponent(booking.mentorName)}&topic=${encodeURIComponent(booking.topic)}" class="join-btn" style="background-color: #f39c12; text-decoration:none; white-space: nowrap;"><i class="fas fa-credit-card"></i> Payment</a>
                        <a href="chat.html?mentor=${encodeURIComponent(booking.mentorName)}" class="join-btn" style="background-color: #3498db; text-decoration:none; white-space: nowrap;"><i class="fas fa-comment"></i> Chat</a>
                    `;
                } else if (booking.status === 'paid' || booking.status === 'ongoing') {
                    actionHtml = `
                        <a href="video-call.html?room=${booking._id}" class="join-btn" style="text-decoration:none; white-space: nowrap;"><i class="fas fa-video"></i> Join Call</a>
                        <a href="chat.html?mentor=${encodeURIComponent(booking.mentorName)}" class="join-btn" style="background-color: #3498db; text-decoration:none; white-space: nowrap;"><i class="fas fa-comment"></i> Chat</a>
                    `;
                } else if (booking.status === 'cancelled' || booking.status === 'rejected') {
                    actionHtml = `
                        <span class="status-tag" style="background:#e74c3c; color:white; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-size: 0.8rem;"><i class="fas fa-ban"></i> Session Discarded</span>
                    `;
                } else if (booking.status === 'completed') {
                    actionHtml = `
                        <span class="status-tag" style="background:#2ecc71; color:white; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-size: 0.8rem;"><i class="fas fa-check-double"></i> Completed</span>
                    `;
                }

                const cardHtml = `
                    <div class="session-card ${booking.status}" style="display: flex; flex-wrap: nowrap; gap: 15px; align-items: center; overflow: hidden;">
                        <div class="session-date" style="flex-shrink: 0;">
                            <span class="month">${month}</span>
                            <span class="day">${day}</span>
                        </div>
                        <div class="session-details" style="flex: 1; min-width: 0; padding-right: 10px;">
                            <h4 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 0 5px 0;" title="${booking.topic || 'Mentorship Session'}">${booking.topic || 'Mentorship Session'}</h4>
                            <p style="margin: 0 0 3px 0;"><strong>Mentor:</strong> ${booking.mentorName}</p>
                            <p style="margin: 0;"><i class="fas fa-clock"></i> ${booking.time}</p>
                        </div>
                        <div class="session-actions" style="display: flex; gap: 10px; align-items: center; flex-shrink: 0; flex-wrap: nowrap;">
                            ${actionHtml}
                        </div>
                    </div>`;

                if (activeStates.includes(booking.status)) {
                    activeList.insertAdjacentHTML('beforeend', cardHtml);
                } else {
                    historyList.insertAdjacentHTML('beforeend', cardHtml);
                }
            });
        } catch (err) {
            activeList.innerHTML = '<p class="error-msg">Error loading sessions. Please try again.</p>';
            console.error("Fetch error:", err);
        }
    }

    window.updateStudentStatus = async function(bookingId, newStatus) {
        if (!confirm("Are you sure you want to cancel this request?")) return;
        try {
            const res = await fetch(`http://localhost:3000/api/bookings/${bookingId}`, {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${localStorage.getItem('token')}` 
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) { 
                loadUpcomingSessions(); 
            } else {
                alert("Failed to update status");
            }
        } catch (err) { 
            console.error(err);
            alert("Error updating status.");
        }
    };


// === 12. BOOKING FORM SUBMISSION ===
    const bookingForm = document.getElementById('booking-form');
    // Targeted selector for your specific button class
    const modalSubmitBtn = bookingForm?.querySelector('.auth-btn'); 

    if (bookingForm) {
        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const mentorNameRaw = document.getElementById('modal-mentor-name').innerText;
            const mentorName = mentorNameRaw.replace('With: ', '').trim();

            const bookingData = {
                mentorName: mentorName,
                topic: document.getElementById('booking-topic').value,
                date: document.getElementById('booking-date').value,
                time: document.getElementById('booking-time').value,
                duration: parseInt(document.getElementById('booking-duration').value) || 10,
                status: 'pending' 
            };

            try {
                // Visual feedback: Disable the button so they don't click twice
                if (modalSubmitBtn) {
                    modalSubmitBtn.disabled = true;
                    modalSubmitBtn.innerText = "Sending Request...";
                }
                
                const response = await fetch('http://localhost:3000/api/bookings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(bookingData)
                });

                if (response.ok) {
                    showToast("Booking request sent!");
                    modal.style.display = 'none'; 
                    bookingForm.reset();
                    loadUpcomingSessions(); // Refresh the activity list
                }
            } catch (err) {
                showToast("Failed to book session.");
            } finally {
                // Re-enable the button if there's an error or after finishing
                if (modalSubmitBtn) {
                    modalSubmitBtn.disabled = false;
                    modalSubmitBtn.innerText = "Confirm Booking";
                }
            }
        });
    }
    

    loadUserProfile(); 

    // === LOGOUT LOGIC ===
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            // 1. Clear the storage
            localStorage.removeItem("token");
            localStorage.removeItem("currentUser");
            
            // 2. Optional: Show a goodbye message
            showToast("Logged out successfully!");
            
            // 3. Redirect to login page after a tiny delay
            setTimeout(() => {
                window.location.href = 'login.html'; 
            }, 500);
        });
    }
});




