const axios = require('axios');

const API_BASE = 'http://localhost:5000/blogs';

const blogsToCreate = [
  {
    title: 'Exploring the Cosmos',
    content: `The universe is vast and full of mysteries. From the swirling galaxies to the enigmatic black holes, every corner of space offers something new to discover. Astronomers have long gazed at the stars, wondering what lies beyond our own solar system.

Recent advancements in telescope technology have allowed us to peer deeper into the cosmos than ever before. With each new discovery, we come closer to understanding our place in the universe and the origins of everything we see around us.`,
    author: 'Carl Sagan',
  },
  {
    title: 'The Art of Mindful Living',
    content: `Mindfulness is more than just a buzzword; it is a way of life. By paying attention to the present moment, we can reduce stress and improve our overall well-being. Simple practices like deep breathing and meditation can make a significant difference in our daily lives.

Incorporating mindfulness into your routine doesn't require drastic changes. Start by taking a few minutes each day to focus on your breath and observe your thoughts without judgment. Over time, you'll notice a greater sense of calm and clarity.`,
    author: 'Thich Nhat Hanh',
  }
];

async function seed() {
  try {
    // 1. Register a test user
    const username = 'seed_user_' + Date.now();
    const password = 'password123';
    
    await axios.post('http://localhost:5000/auth/register', { username, password });
    console.log(`Registered seed user: ${username}`);

    // 2. Login to get token
    const loginRes = await axios.post('http://localhost:5000/auth/login', { username, password });
    const token = loginRes.data.token;
    console.log('Successfully logged in. Token acquired.');

    // 3. Post blogs
    console.log(`Seeding ${blogsToCreate.length} blogs...`);
    for (let i = 0; i < blogsToCreate.length; i++) {
      try {
        const blogData = blogsToCreate[i];
        await axios.post(API_BASE + '/', blogData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`Posted blog "${blogData.title}"...`);
      } catch (err) {
        console.error(`Failed to post blog #${i + 1}:`, err.response?.data || err.message);
      }
    }
    console.log('Seeding complete.');
  } catch (err) {
    console.error('Initialization failed:', err.response?.data || err.message);
  }
}

seed();
