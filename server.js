// server.js
const express = require('express');
const admin = require('firebase-admin');

// 1. Initialize Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(express.json({ limit: '10mb' })); // For the Emergency Audio
app.use(express.static('public'));

// Hardcoded for the MVP demo (You can move this to Firebase later if you want)
const workerCodes = ['1111', '2222', '3333', '4444', '5555'];

// --- AUTO-ESCALATION LOGIC ---
const triggerAutoEscalation = async () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    
    // Fetch complaints that haven't been escalated yet
    const snapshot = await db.collection('complaints').where('escalated', '==', false).get();

    snapshot.forEach(async (doc) => {
        const data = doc.data();
        if (data.status !== 'Resolved' && data.status !== 'Unresolved' && data.createdAt) {
            const createdAt = data.createdAt.toDate();
            if ((now - createdAt) > sevenDaysMs) {
                await db.collection('complaints').doc(doc.id).update({
                    status: 'Escalated',
                    escalated: true
                });
            }
        }
    });
};

// 1. Logins
app.post('/api/validate-code', (req, res) => {
    if (workerCodes.includes(req.body.code)) res.json({ success: true, code: req.body.code });
    else res.status(400).json({ success: false });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.adminId === 'ADMIN123') res.json({ success: true });
    else res.status(401).json({ success: false });
});

// 2. Standard Complaint (Writes to Firebase)
app.post('/api/complaints', async (req, res) => {
    const complaintId = 'SV-' + Math.floor(1000 + Math.random() * 9000);
    const newDoc = {
        complaintId,
        supportCount: 0,
        ...req.body,
        status: 'Under Review',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        escalated: false
    };
    await db.collection('complaints').doc(complaintId).set(newDoc);
    res.json({ success: true, complaintId });
});

// 3. EMERGENCY AUDIO (Writes to Firebase)
app.post('/api/emergency-audio', async (req, res) => {
    const complaintId = 'SV-EMRG-' + Math.floor(1000 + Math.random() * 9000);
    const newDoc = { 
        complaintId, workerCode: 'Anonymous', issueType: '🚨 Emergency Audio', 
        department: 'Unknown', accusedName: 'Unknown', isPublic: false, 
        status: 'Escalated', escalated: true, 
        createdAt: admin.firestore.FieldValue.serverTimestamp(), 
        audioData: req.body.audioData, supportCount: 0 
    };
    await db.collection('complaints').doc(complaintId).set(newDoc);
    res.json({ success: true, complaintId });
});

// 4. Public Board & Solidarity (Reads/Updates Firebase)
app.get('/api/public/complaints', async (req, res) => {
    const snapshot = await db.collection('complaints').get();
    let complaints = [];
    snapshot.forEach(doc => {
        const c = doc.data();
        c.createdAt = c.createdAt ? c.createdAt.toDate() : new Date();
        complaints.push(c);
    });
    
    // Filter/Sort in memory to avoid Firebase missing index errors during demo
    const publicData = complaints
        .filter(c => c.isPublic)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(c => ({
            complaintId: c.complaintId, issueType: c.issueType, 
            accusedName: c.accusedName || 'Unknown', supportCount: c.supportCount || 0
        }));
        
    res.json(publicData); 
});

app.post('/api/public/complaints/:id/support', async (req, res) => {
    const docRef = db.collection('complaints').doc(req.params.id);
    const doc = await docRef.get();
    if (doc.exists) {
        const newCount = (doc.data().supportCount || 0) + 1;
        await docRef.update({ supportCount: newCount });
        res.json({ success: true, count: newCount });
    } else res.status(404).json({ success: false });
});

// 5. Admin Data & History
app.get('/api/admin/complaints', async (req, res) => { 
    await triggerAutoEscalation(); 
    const snapshot = await db.collection('complaints').get();
    let complaints = [];
    snapshot.forEach(doc => {
        const c = doc.data();
        c.createdAt = c.createdAt ? c.createdAt.toDate() : new Date();
        complaints.push(c);
    });
    res.json(complaints.sort((a, b) => b.createdAt - a.createdAt)); 
});

app.get('/api/complaints/history/:code', async (req, res) => { 
    await triggerAutoEscalation(); 
    const snapshot = await db.collection('complaints').where('workerCode', '==', req.params.code).get();
    let history = [];
    snapshot.forEach(doc => {
        const c = doc.data();
        c.createdAt = c.createdAt ? c.createdAt.toDate() : new Date();
        history.push(c);
    });
    res.json(history.sort((a, b) => b.createdAt - a.createdAt)); 
});

app.put('/api/admin/complaints/:id', async (req, res) => {
    const docRef = db.collection('complaints').doc(req.params.id);
    const doc = await docRef.get();
    if (doc.exists) {
        let escalated = doc.data().escalated;
        if (req.body.status === 'Resolved' || req.body.status === 'Unresolved') escalated = false;
        await docRef.update({ status: req.body.status, escalated });
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

app.listen(3000, () => console.log(`🌸 Sakhi connected to Firebase on http://localhost:3000`));