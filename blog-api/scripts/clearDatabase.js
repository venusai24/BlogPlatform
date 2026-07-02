const mongoose = require('mongoose');
require('dotenv').config();

const clearDB = async () => {
    try {
        if (!process.env.DATABASE_URI) {
            console.error("DATABASE_URI is not defined in .env");
            process.exit(1);
        }
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.DATABASE_URI);
        console.log("Connected. Dropping database...");
        await mongoose.connection.db.dropDatabase();
        console.log("Database dropped successfully.");
    } catch (err) {
        console.error("Error clearing database:", err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

clearDB();
