const express = require('express');
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});


const JWT_SECRET = "my_secret_key"; // Replace with a strong, secure key in production

// Register Route
router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    const checkUserQuery = "SELECT COUNT(*) AS count FROM users WHERE username = ?";
    const insertUserQuery = "INSERT INTO users (username, password) VALUES (?, ?)";

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        db.connect((err) => {
            if (err) {
                console.error("Database connection error:", err);
                res.status(500).send({ message: "Database connection error" });
                return;
            }

            // Check if user already exists
            db.query(checkUserQuery, [username], (err, results) => {
                if (err) {
                    console.error('Error executing the query:', err);
                    res.status(500).send({ message: "Error checking username" });
                    return;
                }

                if (results[0].count > 0) {
                    res.status(400).send({ message: "User already exists" });
                    db.end();
                } else {
                    // Insert new user with hashed password
                    db.query(insertUserQuery, [username, hashedPassword], (err) => {
                        if (err) {
                            console.error('Error inserting user:', err);
                            res.status(500).send({ message: "Error registering user" });
                            return;
                        }

                        res.status(201).send({ message: "User registered successfully" });
                    });
                }
                db.end();
            });
        });
    } catch (error) {
        console.error("Error during registration:", error);
        res.status(500).send({ message: "Error registering user" });
    }
});

// Login Route
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const query = "SELECT * FROM users WHERE username = ?";

    db.connect((err) => {
        if (err) {
            console.error("Database connection error:", err);
            res.status(500).send({ message: "Database connection error" });
            return;
        }

        // Fetch user data
        db.query(query, [username], async (err, results) => {
            if (err) {
                console.error("Error executing query:", err);
                res.status(500).send({ message: "Error checking username" });
                db.end();
                return;
            }

            if (results.length === 0) {
                res.status(404).send({ message: "Invalid username or password" });
                db.end();
                return;
            }

            const user = results[0];

            // Validate the password
            const passwordIsValid = await bcrypt.compare(password, user.password);

            if (!passwordIsValid) {
                res.status(401).send({ message: "Invalid username or password" });
            } else {
                // Generate a JWT token
                const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
                    expiresIn: '1h', // Token expires in 1 hour
                });

                res.status(200).send({
                    message: "Login successful",
                    token, // Return the JWT token to the client
                });
            }

            db.end();
        });
    });
});

modules.exports = router;