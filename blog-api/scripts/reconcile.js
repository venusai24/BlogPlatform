// Usage:  node scripts/reconcile.js           dry run: count stale posts and orphaned vectors
//         node scripts/reconcile.js --apply   repair them (re-embeds stale posts: this costs money)
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../config/dbConn');
const redisClient = require('../services/redisClient');
const { initQdrant } = require('../services/qdrantService');
const { runSweep } = require('../services/indexing/reconciler');

async function main() {
    const dryRun = !process.argv.includes('--apply');
    await connectDB();
    await initQdrant();

    const result = await runSweep({ dryRun });
    console.log(JSON.stringify({ dryRun, ...result }, null, 2));

    await mongoose.connection.close();
    if (redisClient.isOpen) await redisClient.quit();
}

main().then(() => process.exit(0)).catch(err => {
    console.error('Reconcile error:', err);
    process.exit(1);
});
