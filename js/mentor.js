document.addEventListener('DOMContentLoaded', () => {
    // === 1. SELECTORS ===
    const nameDisplay = document.getElementById('profile-name-main');
    const nameInput = document.getElementById('name-edit');
    const bioDisplay = document.getElementById('profile-bio'); 
    const bioInput = document.getElementById('bio-edit');      
    const eduDisplay = document.getElementById('profile-education');
    const eduInput = document.getElementById('education-edit');
    const wordCountDisplay = document.getElementById('word-count'); // Ensure this ID exists in HTML
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

    let isEditMode = false; 
    const user = JSON.parse(localStorage.getItem("currentUser"));
    const token = localStorage.getItem("token");

    // === AUTH CHECK ===
    if (!token || !user) {
        window.location.href = 'login.html';
        return;
    }

    // === 2. IMAGE UPLOAD LOGIC ===
    if (uploadInput) {
        uploadInput.addEventListener('change', function(e) {
            if (!isEditMode) return;
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    profilePic.src = event.target.result;
                    calculateProgress();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // === 3. TAB SWITCHING ===
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetTab = link.getAttribute('data-tab');
            tabLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            tabPanels.forEach(p => {
                p.style.display = p.id === targetTab ? (targetTab === 'edit-profile' ? 'grid' : 'block') : 'none';
            });

            if (targetTab === 'incoming-requests') loadIncomingRequests();
            if (targetTab === 'activity-log') loadActivityHistory();
        });
    });

    // === 4. SKILL MANAGEMENT ===
    const addSkillBtn = document.getElementById('add-skill-btn');
    
    function createSkillTag(name, ref) {
        const span = document.createElement('span');
        span.className = 'skill-tag';
        span.innerHTML = `${name} <button class="remove-skill" type="button">&times;</button>`;
        
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

    // === 5. INCOMING REQUESTS & ACTIVITY LOG ===
    async function loadIncomingRequests() {
        const list = document.getElementById('requests-list');
        try {
            const res = await fetch(`http://localhost:3000/api/bookings/mentor/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const requests = await res.json();
            const pending = requests.filter(r => r.status === 'pending');
            list.innerHTML = pending.length ? '' : '<p class="empty-msg">No pending requests.</p>';

            pending.forEach(req => {
                const card = document.createElement('div');
                card.className = 'session-card pending';
                card.innerHTML = `
                    <div class="session-details">
                        <h4>Topic: ${req.topic}</h4>
                        <p><strong>Student:</strong> ${req.studentId ? req.studentId.name : 'Unknown Student'}</p>
                        <p><i class="fas fa-calendar"></i> ${req.date} at ${req.time}</p>
                    </div>
                    <div class="session-actions">
                        <button class="save-btn" onclick="updateStatus('${req._id}', 'accepted')">Accept</button>
                        <button class="auth-btn" style="background:#e74c3c" onclick="updateStatus('${req._id}', 'rejected')">Decline</button>
                    </div>`;
                list.appendChild(card);
            });
        } catch (err) { console.error(err); }
    }


    window.updateStatus = async function(bookingId, newStatus) {
    try {
        const res = await fetch(`http://localhost:3000/api/bookings/${bookingId}`, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (res.ok) { 
            showToast(`Request ${newStatus}!`); 
            
            // Refresh BOTH lists so the change reflects everywhere
            loadIncomingRequests(); // Removes the card from "Pending"
            loadActivityHistory();  // Adds the card to "Confirmed" or "Rejected"
        } else {
            const errorData = await res.json();
            showToast(errorData.message || "Failed to update status");
        }
    } catch (err) { 
        console.error("Error updating status:", err);
        showToast("Server error. Please try again.");
    }
};
    async function loadActivityHistory() {
        const activeList = document.getElementById('active-sessions-list');
        const historyList = document.getElementById('history-sessions-list');

        if (!activeList || !historyList) return;

        try {
            const res = await fetch(`http://localhost:3000/api/bookings/mentor/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const bookings = await res.json();
            
            activeList.innerHTML = ''; 
            historyList.innerHTML = '';

            const activeStates = ['accepted', 'paid', 'ongoing'];
            const historyStates = ['completed', 'rejected', 'cancelled'];

            const active = bookings.filter(b => activeStates.includes(b.status));
            const history = bookings.filter(b => historyStates.includes(b.status));

            if (active.length === 0) {
                activeList.innerHTML = '<p class="empty-msg">No active sessions.</p>';
            } else {
                active.forEach(b => activeList.insertAdjacentHTML('beforeend', createHistoryCard(b, b.status)));
            }

            if (history.length === 0) {
                historyList.innerHTML = '<p class="empty-msg">No session history.</p>';
            } else {
                history.forEach(b => historyList.insertAdjacentHTML('beforeend', createHistoryCard(b, b.status)));
            }
        } catch (err) { console.error("Error loading activity log:", err); }
    }

    function createHistoryCard(booking, status) {
        const studentName = booking.studentId ? booking.studentId.name : "Unknown Student";
        
        let actionHtml = '';
        if (status === 'accepted') {
            actionHtml = `<span class="status-tag" style="color: #f39c12; font-weight: bold;"><i class="fas fa-hourglass-half"></i> Payment Pending</span>`;
        } else if (status === 'paid' || status === 'ongoing') {
            actionHtml = `
                <span class="status-tag" style="background:#2ecc71; color:white; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-size: 0.8rem;"><i class="fas fa-check"></i> Paid</span>
                <a href="chat.html?student=${encodeURIComponent(studentName)}" class="save-btn" style="background-color: #3498db; text-decoration:none;"><i class="fas fa-comment"></i> Chat</a>
                <a href="video-call.html?room=${booking._id}" class="save-btn" style="text-decoration:none;"><i class="fas fa-video"></i> Join Call</a>
            `;
        } else if (status === 'rejected' || status === 'cancelled') {
            actionHtml = `<span class="status-tag" style="background:#e74c3c; color:white; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-size: 0.8rem;"><i class="fas fa-ban"></i> Discarded</span>`;
        } else if (status === 'completed') {
            actionHtml = `<span class="status-tag" style="background:#2ecc71; color:white; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-size: 0.8rem;"><i class="fas fa-check-double"></i> Completed</span>`;
        }

        return `
            <div class="session-card ${status}" style="display: flex; align-items: center; justify-content: space-between; gap: 15px;">
                <div class="session-details" style="flex: 1;">
                    <h4>${booking.topic}</h4>
                    <p><strong>Student:</strong> ${studentName}</p>
                    <p><i class="fas fa-clock"></i> ${booking.date} at ${booking.time}</p>
                </div>
                <div class="session-actions" style="display: flex; gap: 10px; align-items: center;">
                    ${actionHtml}
                </div>
            </div>`;
    }

    // === 6. PROFILE DATA LOAD & SAVE ===
    async function loadUserProfile() {
        try {
            const response = await fetch('http://localhost:3000/api/users/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                nameDisplay.textContent = data.name || "Mentor Name";
                bioDisplay.textContent = data.bio || "No bio added.";
                eduDisplay.textContent = data.education || "No education listed";
                
                const ratingDiv = document.getElementById("profile-rating");
                if (ratingDiv) {
                    const ratingValue = data.rating || 4.0;
                    ratingDiv.innerHTML = `<i class="fas fa-star"></i>`.repeat(Math.floor(ratingValue)) + 
                         (ratingValue % 1 !== 0 ? `<i class="fas fa-star-half-alt"></i>` : '') + 
                         ` <span style="color:#333; margin-left:5px; font-weight:bold;">${ratingValue.toFixed(1)}</span>`;
                }

                nameInput.value = data.name || "";
                bioInput.value = data.bio || "";
                eduInput.value = data.education || "";
                profilePic.src = data.profilePic || 'assets/images/default-avatar.png';
                
                editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)').forEach(t => t.remove());
                if (data.skills) data.skills.forEach(skill => createSkillTag(skill, addSkillBtn));
                
                updateSummarySkills();
                calculateProgress();
            }
        } catch (err) { console.error(err); }
    }

    saveBtn.addEventListener('click', async () => {
        const body = {
            name: nameInput.value,
            bio: bioInput.value,
            education: eduInput.value, 
            profilePic: profilePic.src,
            skills: Array.from(editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)'))
                         .map(t => t.firstChild.textContent.trim())
        };

        try {
            saveBtn.textContent = "Saving...";
            const res = await fetch('http://localhost:3000/api/users/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(body)
            });
            if (res.ok) { showToast("Profile Updated!"); toggleEditMode(false); loadUserProfile(); }
        } catch (err) { showToast("Error saving profile."); }
        finally { saveBtn.textContent = "Save Changes"; }
    });

    // === 7. UI HELPERS ===
    function toggleEditMode(showEdit) {
        isEditMode = showEdit;
        editBtn.textContent = isEditMode ? "Cancel Changes" : "Edit Profile";
        saveBtn.style.display = isEditMode ? "inline-block" : "none";
        [nameDisplay, bioDisplay, eduDisplay].forEach(el => el.style.display = isEditMode ? "none" : "block");
        [nameInput, bioInput, eduInput].forEach(el => el.style.display = isEditMode ? "block" : "none");
    }

    editBtn.addEventListener('click', () => toggleEditMode(!isEditMode));

    // Bio Word Count Listener
    if (bioInput && wordCountDisplay) {
        bioInput.addEventListener('input', () => {
            const limit = 200;
            if (bioInput.value.length > limit) {
                bioInput.value = bioInput.value.substring(0, limit);
            }
            wordCountDisplay.textContent = `${bioInput.value.length}/${limit}`;
            calculateProgress(); 
        });
    }

    function calculateProgress() {
        let score = 0;
        if (nameInput.value.length > 2) score += 25;
        if (bioInput.value.length > 10) score += 25;
        if (eduInput.value.length > 2) score += 25;
        if (summarySkillsContainer.children.length > 0) score += 25;
        
        if (progressText) progressText.textContent = `${score}%`;
        if (progressCircle) {
            progressCircle.style.background = `conic-gradient(var(--accent-color) ${(score/100)*360}deg, #e0e0e0 0deg)`;
        }
    }

    function updateSummarySkills() {
        summarySkillsContainer.innerHTML = "";
        editSkillsContainer.querySelectorAll('.skill-tag:not(.add-skill)').forEach(tag => {
            const sTag = document.createElement('span');
            sTag.className = 'skill-tag';
            sTag.textContent = tag.firstChild.textContent.trim();
            summarySkillsContainer.appendChild(sTag);
        });
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