// Global Call Listener Logic
const callToken = localStorage.getItem('token');
const callUser = JSON.parse(localStorage.getItem('currentUser'));

if (callToken && callUser) {
    // Only initialize socket if not already initialized
    const callSocket = window.socket || io('http://localhost:3000');
    
    if (!window.socket) {
        window.socket = callSocket;
        callSocket.emit('joinChat', callUser.id);
    }

    // Create Modal UI
    const callModalHTML = `
        <div id="incoming-call-modal" style="display:none; position:fixed; top:20px; right:20px; background:white; padding:20px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.2); z-index:9999; border-left: 5px solid #4CAF50;">
            <h4 style="margin:0 0 10px 0; display:flex; align-items:center; gap:10px;">
                <i class="fas fa-video" style="color:#4CAF50; animation: bounce 1s infinite;"></i> 
                Incoming Call
            </h4>
            <p id="incoming-caller-name" style="margin:0 0 15px 0; font-size:0.9rem; color:#555;">Someone is calling you...</p>
            <div style="display:flex; gap:10px;">
                <button id="accept-call-btn" style="flex:1; background:#4CAF50; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer;">Accept</button>
                <button id="reject-call-btn" style="flex:1; background:#f44336; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer;">Reject</button>
            </div>
        </div>
        <style>
            @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        </style>
    `;
    
    const div = document.createElement('div');
    div.innerHTML = callModalHTML;
    document.body.appendChild(div);

    let activeCallRoom = null;
    let activeCallerId = null;

    callSocket.on('incomingCall', ({ roomId, callerName, callerId }) => {
        activeCallRoom = roomId;
        activeCallerId = callerId;
        document.getElementById('incoming-caller-name').textContent = `${callerName || 'Student'} is calling you...`;
        document.getElementById('incoming-call-modal').style.display = 'block';
        
        // Play sound (optional)
        try {
            const audio = new Audio('https://www.soundjay.com/phone/telephone-ring-04.mp3');
            audio.play().catch(e => console.log('Audio autoplay blocked', e));
        } catch(e){}
    });

    document.getElementById('accept-call-btn').addEventListener('click', () => {
        document.getElementById('incoming-call-modal').style.display = 'none';
        window.location.href = `video-call.html?room=${activeCallRoom}&autoJoin=true&callerId=${activeCallerId}`;
    });

    document.getElementById('reject-call-btn').addEventListener('click', () => {
        document.getElementById('incoming-call-modal').style.display = 'none';
        callSocket.emit('callResponse', { callerId: activeCallerId, accepted: false, roomId: activeCallRoom });
    });
}
