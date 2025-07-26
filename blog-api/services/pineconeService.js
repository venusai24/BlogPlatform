// pineconeService.js

const { Pinecone } = require('@pinecone-database/pinecone');

let pineconeClient = null;
let pineconeIndex = null;
let isInitialized = false; // Add a flag

const getPineconeClient = () => {
    if (!pineconeClient) {
        pineconeClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    }
    return pineconeClient;
};

const getPineconeIndex = () => {
    if (!pineconeIndex) {
        // THIS IS THE DEBUGGING CODE. It will run only once.
        if (!isInitialized) {
            console.log('!!! PINEONE INDEX IS BEING INITIALIZED FOR THE FIRST TIME !!!');
            console.trace('INITIALIZATION STACK TRACE'); // This will show us the file that called it.
            isInitialized = true;
        }

        const client = getPineconeClient();
        // Use lowercase 'index' to get the modern index object
        pineconeIndex = client.index(process.env.PINECONE_INDEX_NAME);
    }
    return pineconeIndex;
};

const initPinecone = async () => {
    try {
        const client = getPineconeClient();
        const indexName = process.env.PINECONE_INDEX_NAME;

        const { indexes } = await client.listIndexes();
        if (!indexes || !indexes.some(index => index.name === indexName)) {
            console.log(`Creating Pinecone index "${indexName}"...`);
            await client.createIndex({
                name: indexName,
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1',
                        model: 'text-embedding-3-small',
                        dimension: 1536,
                        metric: 'cosine'
                    }
                },
                waitUntilReady: true,
            });
            console.log(`Pinecone index "${indexName}" created successfully.`);
        } else {
            console.log(`Pinecone index "${indexName}" already exists.`);
        }
        
        // This will now get the correctly initialized index
        getPineconeIndex(); 
        console.log('Pinecone initialized successfully');

    } catch (error) {
        console.error("Error initializing Pinecone:", error);
    }
};

module.exports = {
    getPineconeIndex,
    initPinecone,
};
