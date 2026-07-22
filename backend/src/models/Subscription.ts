import mongoose from 'mongoose';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  frequency: {
    type: String,
    enum: FREQUENCIES,
    required: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  dueDayOfWeek: {
    type: String,
    enum: DAYS_OF_WEEK,
    default: null,
  },
  dueDayOfMonth: {
    type: Number,
    min: 1,
    max: 31,
    default: null,
  },
  dueMonth: {
    type: Number,
    min: 1,
    max: 12,
    default: null,
  },
}, { timestamps: true });

export { FREQUENCIES, DAYS_OF_WEEK };
export default mongoose.model('Subscription', subscriptionSchema);
