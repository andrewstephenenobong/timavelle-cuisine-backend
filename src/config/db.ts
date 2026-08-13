import mongoose from 'mongoose';

const connectionTimeout = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000);
let retryTimer: NodeJS.Timeout | undefined;
let isConnecting = false;

function scheduleReconnect() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void connectDB().catch(() => undefined);
  }, 15000);
  retryTimer.unref();
}

mongoose.connection.on('disconnected', scheduleReconnect);

export async function connectDB() {
  if (isConnecting || mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGO_URI;
  if (!uri) {
    const error = new Error('MONGO_URI is not defined in .env');
    console.error('MongoDB connection error:', error.message);
    scheduleReconnect();
    throw error;
  }

  isConnecting = true;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: connectionTimeout,
      connectTimeoutMS: connectionTimeout,
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    scheduleReconnect();
    throw error;
  } finally {
    isConnecting = false;
  }
}
