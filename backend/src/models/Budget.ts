import mongoose from 'mongoose';

const budgetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  categories: [
    {
      name: {
        type: String,
        required: true,
      },
      allocatedAmount: {
        type: Number,
        required: true,
      }
    }
  ],
}, { timestamps: true });

export default mongoose.model('Budget', budgetSchema);
