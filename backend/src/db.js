// /backend/src/db.js
const mongoose = require('mongoose');

let connected = false;
exports.connect = () => {
  if (connected) return;
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10,
    autoIndex: false
  }).then(() => {
    connected = true;
    console.log('Mongo connected');
  }).catch(err => {
    console.error('Mongo connection failed:', err.message);
    process.exit(1);
  });

  // graceful shutdown
  process.on('SIGTERM', async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
};
