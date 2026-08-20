import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { config } from './config';
import Expense from './models/Expense';
import authRoutes from './routes/auth';
import expenseRoutes from './routes/expenses';
import budgetRoutes from './routes/budgets';
import subscriptionRoutes from './routes/subscriptions';
import paymentShortcutRoutes from './routes/paymentShortcuts';
import debtRoutes from './routes/debts';
import incomeRoutes from './routes/income';
import assetRoutes from './routes/assets';
import positionRoutes from './routes/position';
import aiRoutes from './routes/ai';

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
app.use('/api/payment-shortcuts', paymentShortcutRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/position', positionRoutes);
app.use('/api/ai', aiRoutes);

mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log('Connected to MongoDB');

    // The unique index on (userId, subscriptionId, billingDay) is what makes
    // subscription charging idempotent. Mongoose builds indexes in the
    // background and swallows the error, so a build that fails — most likely
    // E11000 from duplicate rows written before the index existed — would leave
    // the guarantee silently absent and every catch-up run duplicating charges.
    // Loud is the only safe setting here.
    // The same guarantee now covers debt instalments and part-payments, which
    // are posted by the same lazy catch-up mechanism and carry the same
    // duplicate risk.
    Expense.on('index', (err: unknown) => {
      if (err) {
        console.error(
          '[startup] FAILED to build an expense uniqueness index. ' +
            'Automatic subscription or debt charges can duplicate until this is resolved. ' +
            'Look for duplicate (userId, subscriptionId, billingDay) or (userId, debtId, billingDay) ' +
            'rows in the expenses collection.',
          err
        );
      }
    });
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
