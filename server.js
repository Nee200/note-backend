const { loadEnvironment, validateEnvironment } = require('./config/environment');

async function start() {
    const env = loadEnvironment();
    validateEnvironment(env);
    const mongoose = require('mongoose');
    const { createApp } = require('./app');
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const app = createApp({ env });
    // Idempotency relies on unique indexes being ready before requests arrive.
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    await app.locals.refreshProductCache();
    const server = app.listen(Number(env.PORT || 4242), () => console.log('Backend gestartet.'));
    let activeJob = null, stopping = false;
    const runJobs = () => {
        if (activeJob || stopping) return;
        activeJob = (async () => {
            for (const [name, run] of [
                ['webhooks', () => app.locals.webhookService.processPending()],
                ['notifications', () => app.locals.notificationService.processPending()],
                ['invoices', () => app.locals.invoiceRepairService.processPending()],
                ['newsletter', () => app.locals.newsletterService.processPending()],
                ['mail', () => app.locals.mailService.processPending()],
                ['checkout', () => app.locals.checkoutService.reconcileExpired()]
            ]) {
                if (stopping) break;
                try { await run(); } catch (error) { console.error(`Background ${name}:`, error.message); }
            }
        })().finally(() => { activeJob = null; });
    };
    const jobs = setInterval(runJobs, 30000);
    jobs.unref();
    runJobs();
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        clearInterval(jobs);
        await new Promise(resolve => server.close(resolve));
        if (activeJob) await activeJob;
        await mongoose.disconnect();
    }
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { app, server, shutdown };
}
if (require.main === module) start().catch(async error => {
    console.error('Start fehlgeschlagen:', error.message);
    await require('mongoose').disconnect().catch(() => {});
    process.exitCode = 1;
});
module.exports = { start };
