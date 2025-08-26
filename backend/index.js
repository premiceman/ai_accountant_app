require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth'); // ✅ Include auth route

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/ping', (req, res) => res.json({ message: 'pong' }));
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes); // ✅ Mount the /api/auth route
const profileRoutes = require('./routes/profile');
app.use('/api/user', profileRoutes);

const dashboardRoutes = require('./routes/dashboard');
const docsRoutes = require('./routes/docs');

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/docs', docsRoutes);

const aiRoutes = require('./routes/ai');
app.use('/api/ai', aiRoutes);

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch((err) => console.error('❌ MongoDB connection error:', err));


