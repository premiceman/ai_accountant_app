import mongoose from 'mongoose';
import logger from './logger';

let connecting: Promise<typeof mongoose> | null = null;

export async function connectMongo(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is required for parse worker');
    }
    connecting = mongoose.connect(uri, { maxPoolSize: 10 }).then((conn) => {
      logger.info({ host: conn.connection.host }, 'Connected to MongoDB');
      return conn;
    });
  }
  return connecting;
}

export default connectMongo;
