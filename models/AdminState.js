const mongoose = require('mongoose');
const schema = new mongoose.Schema({ username: { type: String, unique: true, required: true }, lastTimeStep: { type: Number, default: -1 } });
module.exports = mongoose.model('AdminState', schema);
