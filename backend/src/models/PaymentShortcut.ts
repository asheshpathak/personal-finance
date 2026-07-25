import mongoose from 'mongoose';

/** A one-tap template for recording an expense, saved from a real payment. */
const paymentShortcutSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  label: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  paymentMode: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  // Drives ordering in the picker: the shortcuts you reach for most stay first.
  usageCount: {
    type: Number,
    default: 0,
  },
  lastUsedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

export default mongoose.model('PaymentShortcut', paymentShortcutSchema);
