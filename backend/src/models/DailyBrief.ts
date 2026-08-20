import mongoose from 'mongoose';

/**
 * One day's read on someone's money, kept.
 *
 * The briefing used to be generated on demand and cached in a React module for
 * the length of a session. That was wrong in both directions: it re-spent every
 * time someone opened the app in a new tab, and — much worse — it produced a
 * *different* briefing each time. An insight that changes when nothing changed
 * was never an insight, and a dashboard that tells you a different story every
 * time you glance at it teaches you to stop reading it.
 *
 * So the briefing is a fact about a day. It is written once, on the first visit
 * after midnight in the reader's own timezone, and it says the same thing all
 * day. That is also what makes "you are ahead of where you were last month at
 * this point" a sentence worth writing: it has a fixed vantage point.
 *
 * `fingerprint` is how the card knows the ground has moved underneath it. It is
 * not used to invalidate anything automatically — quietly rewriting the morning
 * briefing at lunchtime is the behaviour this model exists to prevent — it is
 * shown, so the person can ask for a fresh read if they want one.
 */

const dailyBriefSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  /** The reader's calendar day, `YYYY-MM-DD`. Their day, not the server's. */
  day: {
    type: String,
    required: true,
  },
  /** The whole rendered briefing, as returned to the client. */
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  /** Which model wrote it, so a bad run can be traced to a model change. */
  model: {
    type: String,
    default: '',
  },
  /**
   * A cheap summary of the data it was written from: payment count, spend so
   * far this month, and total debt. If those have moved materially since, the
   * card offers a fresh read rather than pretending the morning's still holds.
   */
  fingerprint: {
    type: String,
    default: '',
  },
  /** How many times a fresh read was asked for today. Bounds the spend. */
  regenerations: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

/** One briefing per person per day — the guarantee the whole model rests on. */
dailyBriefSchema.index({ userId: 1, day: 1 }, { unique: true });

/**
 * Dropped after 90 days.
 *
 * Long enough to look back over a quarter of briefings, short enough that the
 * collection never becomes something to think about. Mongo's TTL monitor runs
 * roughly every minute, so expiry is approximate — which is fine for a cache.
 */
dailyBriefSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('DailyBrief', dailyBriefSchema);
