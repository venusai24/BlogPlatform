require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const BlogContent = require('../model/BlogContent');
const { faker } = require('@faker-js/faker');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/blogplatform';

const topics = [
    { title: "The Future of AI", tags: ["AI", "Technology"] },
    { title: "React vs Vue in 2026", tags: ["React", "Vue", "Frontend"] },
    { title: "Mastering Node.js Streams", tags: ["Node.js", "Backend"] },
    { title: "Deploying to AWS ECS", tags: ["AWS", "DevOps"] },
    { title: "Understanding Vector Databases", tags: ["Databases", "AI"] }
];

async function seed() {
    try {
        await mongoose.connect(MONGODB_URI, {
            useUnifiedTopology: true,
            useNewUrlParser: true
        });
        console.log("Connected to MongoDB.");

        const existingCount = await BlogContent.countDocuments();
        if (existingCount > 0) {
            console.log(`Database already has ${existingCount} posts. Being idempotent, skipping seed...`);
            process.exit(0);
        }

        const posts = [];
        for (let i = 0; i < 50; i++) {
            const topic = faker.helpers.arrayElement(topics);
            const title = `${topic.title}: ${faker.lorem.words(3)}`;
            const content = faker.lorem.paragraphs(5, '\n\n');
            const author = faker.person.fullName();
            const summary = faker.lorem.paragraph();
            const tags = topic.tags.concat(faker.lorem.words(2).split(' '));

            posts.push({
                title,
                content,
                author,
                summary,
                tags,
                likes: faker.number.int({ min: 0, max: 100 }),
                comments: []
            });
        }

        await BlogContent.insertMany(posts);
        console.log(`Successfully seeded 50 blog posts.`);
        
        process.exit(0);
    } catch (err) {
        console.error("Seed error:", err);
        process.exit(1);
    }
}

seed();
