const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/skillbridge').then(async () => {
    try {
        const db = mongoose.connection.db;
        const b = await db.collection('bookings').find({ studentId: new mongoose.Types.ObjectId('695113bccc07044a5f15b392') }).toArray();
        console.log('Bookings:', b.length);
        const mentorNames = [...new Set(b.map(x => x.mentorName))];
        console.log('Mentor Names:', mentorNames);
        const mentors = await db.collection('users').find({ role: 'mentor', name: { $in: mentorNames } }).toArray();
        console.log('Mentors found:', mentors.length, mentors);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
});
