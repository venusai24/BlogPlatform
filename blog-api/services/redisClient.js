const Redis = require('redis');

const client = Redis.createClient({
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD,
    socket: {
        tls: process.env.REDIS_TLS_ENABLED === 'true',
        ca: process.env.REDIS_TLS_CA_CERTS || undefined,
        key: process.env.REDIS_TLS_KEY || undefined,
        cert: process.env.REDIS_TLS_CERT || undefined,
    }
});

client.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
    if (!client.isOpen) {
        await client.connect();
    }
})();

module.exports = client;
