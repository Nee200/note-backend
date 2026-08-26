const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');

const ORDER_SEQUENCE_START = Math.max(1, Number.parseInt(process.env.ORDER_SEQUENCE_START || '1', 10) || 1);
const ORDER_COUNTER_KEY = 'order:global';

function asDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatOrderNumber(sequence) {
    const normalizedSequence = Number(sequence);
    if (!Number.isInteger(normalizedSequence) || normalizedSequence < 1) {
        throw new Error('Ungültige Bestellnummer-Sequenz.');
    }
    return `#${normalizedSequence}`;
}

async function allocateOrderNumber() {
    let counter = await OrderCounter.findById(ORDER_COUNTER_KEY);
    if (!counter) {
        try {
            counter = await OrderCounter.create({
                _id: ORDER_COUNTER_KEY,
                sequence: ORDER_SEQUENCE_START - 1
            });
        } catch (error) {
            if (!error || error.code !== 11000) throw error;
        }
    }
    counter = await OrderCounter.findByIdAndUpdate(
        ORDER_COUNTER_KEY,
        { $inc: { sequence: 1 } },
        { new: true }
    );
    if (!counter) throw new Error('Bestellnummer konnte nicht vergeben werden.');
    return formatOrderNumber(counter.sequence);
}

async function ensureOrderNumber(order) {
    if (!order || !order._id) throw new Error('Bestellung fehlt.');
    const current = String(order.orderNumber || '').trim();
    if (current) return current;

    const allocated = await allocateOrderNumber();
    const updated = await Order.findOneAndUpdate(
        {
            _id: order._id,
            $or: [
                { orderNumber: { $exists: false } },
                { orderNumber: '' },
                { orderNumber: null }
            ]
        },
        { $set: { orderNumber: allocated } },
        { new: true, runValidators: true }
    );
    const finalNumber = updated && updated.orderNumber
        ? updated.orderNumber
        : ((await Order.findById(order._id).select('orderNumber').lean()) || {}).orderNumber;
    if (!finalNumber) throw new Error('Bestellnummer konnte nicht gespeichert werden.');

    if (typeof order.set === 'function') order.set('orderNumber', finalNumber);
    else order.orderNumber = finalNumber;
    return finalNumber;
}

async function ensureOrderNumbers(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const chronological = [...list].sort((left, right) => {
        const leftDate = asDate(left && left.date);
        const rightDate = asDate(right && right.date);
        const dateDifference = (leftDate ? leftDate.getTime() : 0) - (rightDate ? rightDate.getTime() : 0);
        if (dateDifference !== 0) return dateDifference;
        return String((left && left._id) || '').localeCompare(String((right && right._id) || ''));
    });
    for (const order of chronological) {
        await ensureOrderNumber(order);
    }
    return list;
}

function getPublicOrderNumberConfig() {
    return {
        prefix: '#',
        sequenceStart: ORDER_SEQUENCE_START,
        format: '#LAUFNUMMER'
    };
}

module.exports = {
    ORDER_SEQUENCE_START,
    formatOrderNumber,
    allocateOrderNumber,
    ensureOrderNumber,
    ensureOrderNumbers,
    getPublicOrderNumberConfig
};
