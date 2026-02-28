const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const AddressSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4 },
    firstName: String,
    lastName: String,
    label: String,
    street: String,
    zip: String,
    city: String,
    country: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    addresses: [AddressSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
