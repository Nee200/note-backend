const RateLimit = require('../models/RateLimit');
class MongoRateStore {
    constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
    init(options) { this.windowMs = options.windowMs; }
    async increment(key) {
        const now = new Date(), expiry = new Date(Date.now() + this.windowMs);
        const expired = { $lte: [{ $ifNull: ['$resetTime', new Date(0)] }, now] };
        const query = { key: `${this.prefix}:${key}` };
        const update = [{ $set: { hits: { $cond: [expired, 1, { $add: [{ $ifNull: ['$hits', 0] }, 1] }] }, resetTime: { $cond: [expired, expiry, '$resetTime'] } } }];
        let result;
        try { result = await RateLimit.findOneAndUpdate(query, update, { upsert: true, returnDocument: 'after', updatePipeline: true, setDefaultsOnInsert: false }); }
        catch (error) { if (error.code !== 11000) throw error; result = await RateLimit.findOneAndUpdate(query, update, { returnDocument: 'after', updatePipeline: true }); }
        return { totalHits: result.hits, resetTime: result.resetTime };
    }
    async decrement(key) { await RateLimit.updateOne({ key: `${this.prefix}:${key}`, hits: { $gt: 0 } }, { $inc: { hits: -1 } }); }
    async resetKey(key) { await RateLimit.deleteOne({ key: `${this.prefix}:${key}` }); }
}
module.exports = { MongoRateStore };
