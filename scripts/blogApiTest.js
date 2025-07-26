const axios = require('axios');

const API_BASE = 'http://localhost:5000/blogs'; // Change port if needed

const blogsToCreate = [
  {
    title: 'Exploring the Cosmos ' + Date.now(),
    content: `The universe is vast and full of mysteries. From the swirling galaxies to the enigmatic black holes, every corner of space offers something new to discover. Astronomers have long gazed at the stars, wondering what lies beyond our own solar system.

Recent advancements in telescope technology have allowed us to peer deeper into the cosmos than ever before. With each new discovery, we come closer to understanding our place in the universe and the origins of everything we see around us.`,
    author: 'Carl Sagan',
  },
  {
    title: 'The Art of Mindful Living ' + Date.now(),
    content: `Mindfulness is more than just a buzzword; it is a way of life. By paying attention to the present moment, we can reduce stress and improve our overall well-being. Simple practices like deep breathing and meditation can make a significant difference in our daily lives.

Incorporating mindfulness into your routine doesn't require drastic changes. Start by taking a few minutes each day to focus on your breath and observe your thoughts without judgment. Over time, you'll notice a greater sense of calm and clarity.`,
    author: 'Thich Nhat Hanh',
  },
  {
    title: 'A Journey Through the Rainforest ' + Date.now(),
    content: `The rainforest is a vibrant ecosystem teeming with life. From the colorful birds that soar above the canopy to the insects that crawl along the forest floor, every organism plays a crucial role in maintaining the delicate balance of nature.

Despite their importance, rainforests around the world are under threat from deforestation and climate change. Conservation efforts are essential to preserve these vital habitats for future generations and the countless species that call them home.`,
    author: 'Jane Goodall',
  },
  {
    title: 'The Evolution of Technology ' + Date.now(),
    content: `Technology has transformed the way we live, work, and communicate. From the invention of the wheel to the rise of artificial intelligence, each breakthrough has brought new opportunities and challenges.

As we look to the future, it's important to consider the ethical implications of emerging technologies. By fostering innovation while remaining mindful of potential risks, we can ensure that technology continues to benefit society as a whole.`,
    author: 'Elon Musk',
  },
  {
    title: 'Culinary Adventures: Tastes of the World ' + Date.now(),
    content: `Food is a universal language that brings people together. Exploring different cuisines allows us to experience new flavors and learn about diverse cultures. Whether it's the spicy dishes of Thailand or the rich pastries of France, every meal tells a story.

Cooking at home can be a rewarding way to experiment with global recipes. Gather your favorite ingredients, invite friends or family, and embark on a culinary adventure from the comfort of your own kitchen.`,
    author: 'Julia Child',
  },
  {
    title: 'The Power of Creative Writing ' + Date.now(),
    content: `Creative writing is a powerful tool for self-expression and exploration. Through stories, poems, and essays, writers can share their unique perspectives and connect with readers on a deep emotional level.

Developing a writing habit takes time and dedication. Set aside a few minutes each day to jot down your thoughts, experiment with different styles, and let your imagination run wild. The more you write, the more your voice will shine through.`,
    author: 'Stephen King',
  },
];

const updatedBlog = {
  title: 'Updated Blog Title',
  content: 'This is updated content for the test blog.',
  author: 'Test Author',
};

async function runTests() {
  let blogIds = [];
  let token = '';
  let blogIdTitlePairs = []; // Store pairs of { id, title }

  // 1. Post multiple new blogs
  console.log(`Posting ${blogsToCreate.length} new blogs...`);
  for (let i = 0; i < blogsToCreate.length; i++) {
    try {
      const blogData = blogsToCreate[i];
      const postRes = await axios.post(API_BASE + '/', blogData);
      const blogId = postRes.data.blog?._id || postRes.data._id || postRes.data.id;
      blogIds.push(blogId);
      blogIdTitlePairs.push({ id: blogId, title: blogData.title }); // Store the pair
      console.log(`Posted blog "${blogData.title}"...`);
    } catch (err) {
      console.error(`Failed to post blog #${i + 1}:`, err.response?.data || err.message);
    }
  }
  console.log('All blogs posted:', blogIds.length);

  // 2. Search by title (using the first blog's title)
  try {
    console.log('Searching by title...');
    // Fix: use 'query' instead of 'titleQuery'
    const searchTitleRes = await axios.post(API_BASE + '/semanticSearchbyTitle', {
      query: blogsToCreate[0].title,
    });
    console.log('Title search results:', searchTitleRes.data);
  } catch (err) {
    console.error('Failed to search by title:', err.response?.data || err.message);
  }

  // 3. Search by content (using the last blog's content)
  try {
    console.log('Searching by content...');
    const searchContentRes = await axios.get(API_BASE + '/search', {
      params: { query: "Writing as a form of expression", searchType: 'content' },
    });
    console.log('Content search results:', searchContentRes.data);
  } catch (err) {
    console.error('Failed to search by content:', err.response?.data || err.message);
  }

  // 4. Update the first blog
  if (blogIds.length > 0) {
    try {
      console.log('Updating the first blog...');
      const updateRes = await axios.put(`${API_BASE}/${blogIds[0]}`, updatedBlog);
      console.log('Blog updated:', updateRes.data);
    } catch (err) {
      console.error('Failed to update blog:', err.response?.data || err.message);
    }
  }

  // 5. Delete all blogs
  console.log('Deleting all blogs...');
  for (let i = 0; i < blogIdTitlePairs.length; i++) {
    const { id: blogId, title: blogTitle } = blogIdTitlePairs[i];
    try {
      await axios.delete(`${API_BASE}/${blogId}`);
      console.log(`Deleted blog "${blogTitle}" (ID: ${blogId})`);
    } catch (err) {
      console.error(`Failed to delete blog "${blogTitle}" (ID: ${blogId}):`, err.response?.data || err.message);
    }
  }
  console.log('All blogs deleted.');
}


runTests();
