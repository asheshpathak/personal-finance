import mongoose from 'mongoose';

const CURRENCIES = ['USD', 'INR'] as const;

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  // Preference, not device state — it follows the account to any browser.
  // Deliberately has no default: "never chosen" has to stay distinguishable
  // from "chose USD", so accounts that predate this field adopt whatever the
  // browser was already set to instead of being reset.
  currency: {
    type: String,
    enum: CURRENCIES,
  },
}, { timestamps: true });

export { CURRENCIES };
export default mongoose.model('User', userSchema);
