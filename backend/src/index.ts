import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { config } from './config';
import authRoutes from './routes/auth';
import expenseRoutes from './routes/expenses';
import budgetRoutes from './routes/budgets';
import subscriptionRoutes from './routes/subscriptions';

const app = express();

// In production only the configured origins may call the API. In development
// CORS_ORIGINS is typically empty, which reflects the request origin so any
// localhost port works without configuration.
app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
  })
);

app.use(express.json());

// Railway health checks hit this; it must not require a database round-trip.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log('Connected to MongoDB');
    // Bind to 0.0.0.0 so the container is reachable from outside on Railway.
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`Server running on port ${config.port}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    // Exit non-zero so the platform restarts the container instead of leaving
    // a process alive that is listening on nothing.
    process.exit(1);
  });
