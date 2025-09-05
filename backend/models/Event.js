// backend/models/Event.js
const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },
    title: { type: String, required: true, maxlength: 50, trim: true },
    description: { type: String, maxlength: 1000, default: '' },
    // The first (anchor) date for this event
    date: { type: Date, required: true },
    // Recurrence: none, monthly, quarterly, yearly
    recurrence: {
      type: String,
      enum: ['none', 'monthly', 'quarterly', 'yearly'],
      default: 'none',
    },
    source: {
      type: String,
      enum: ['user'],
      default: 'user',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', EventSchema);
