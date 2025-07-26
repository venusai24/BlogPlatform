// pinecone-test.js

require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');

async function main() {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
    console.error('Error: Please make sure PINECONE_API_KEY and PINECONE_INDEX_NAME are set in your .env file.');
    return;
  }

  console.log('--- Pinecone Standalone Test Script ---');
  console.log(`Using Index: ${process.env.PINECONE_INDEX_NAME}`);

  try {
    // 1. Initialize Client
    const pc = new Pinecone();
    console.log('Pinecone client initialized.');

    // 2. Get the modern index object using the correct lowercase 'i' method
    const index = pc.index(process.env.PINECONE_INDEX_NAME);
    console.log('Index object retrieved using client.index().');

    // 3. Test the .search() method
    console.log('\nTesting index.search()...');
    if (typeof index.search === 'function') {
      console.log('SUCCESS: index.search() method exists.');
    } else {
      console.error('FAILURE: index.search is NOT a function. This confirms the index object is the wrong type.');
    }

    // 4. Test the .deleteRecords() method
    console.log('\nTesting index.deleteRecords()...');
    if (typeof index.deleteRecords === 'function') {
      console.log('SUCCESS: index.deleteRecords() method exists.');
    } else {
      console.error('FAILURE: index.deleteRecords is NOT a function. This confirms the index object is the wrong type.');
    }

    // 5. Test the .upsertRecords() method with correct metadata
    console.log('\nTesting index.upsertRecords() with correct metadata...');
    if (typeof index.upsertRecords === 'function') {
        try {
            const testRecord = [{
                id: 'standalone-test-1',
                text: 'This is a test record from the standalone script.',
                metadata: {
                    source: 'test-script',
                    is_test: true,
                },
            }];
            await index.upsertRecords(testRecord);
            console.log('SUCCESS: index.upsertRecords() was called without a metadata error.');
            await index.deleteRecords({ ids: ['standalone-test-1'] });
            console.log('Cleaned up test record.');
        } catch (e) {
            console.error('FAILURE: index.upsertRecords() threw an error:', e.message);
        }
    } else {
        console.error('FAILURE: index.upsertRecords is NOT a function.');
    }

  } catch (error) {
    console.error('An unexpected error occurred during the test:', error);
  } finally {
    console.log('\n--- Test Complete ---');
  }
}

main();
