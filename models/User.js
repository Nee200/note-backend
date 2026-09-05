const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const AddressSchema = new mongoose.Schema({
    id: { type: String, default: randomUUID },
    firstName: String,
    lastName: String,
    label: String,
    street: String,
    zip: String,
    city: String,
    country: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
    id: { type: String, default: randomUUID, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
    emailVerifiedAt: { type: Date, default: null },
    sessionVersion: { type: Number, default: 0 },
    emailVerificationHash: { type: String, select: false },
    emailVerificationExpiresAt: Date,
    passwordResetHash: { type: String, select: false },
    passwordResetExpiresAt: Date,
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    addresses: [AddressSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
