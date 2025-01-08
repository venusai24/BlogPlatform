const express = require('express');
const authrouter = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10, 
    queueLimit: 0
});

const JWT_SECRET = "my_secret_key";


authrouter.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send({ message: "Username and password are required" });
    }

    const checkUserQuery = "SELECT COUNT(*) AS count FROM users WHERE username = ?";
    const insertUserQuery = "INSERT INTO users (username, password) VALUES (?, ?)";

    try {
        
        const hashedPassword = await bcrypt.hash(password, 10);

        
        db.query(checkUserQuery, [username], (err, results) => {
            if (err) {
                console.error('Error executing the query:', err);
                res.status(500).send({ message: "Error checking username" });
                return;
            }

            if (results[0].count > 0) {
                res.status(400).send({ message: "User already exists" });
            } else {
                db.query(insertUserQuery, [username, hashedPassword], (err) => {
                    if (err) {
                        console.error('Error inserting user:', err);
                        res.status(500).send({ message: "Error registering user" });
                        return;
                    }

                    res.status(201).send({ message: "User registered successfully" });
                });
            }
        });
    } catch (error) {
        console.error("Error during registration:", error);
        res.status(500).send({ message: "Error registering user" });
    }
});


authrouter.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const query = "SELECT * FROM users WHERE username = ?";

    
    db.query(query, [username], async (err, results) => {
        if (err) {
            console.error("Error executing query:", err);
            res.status(500).send({ message: "Error checking username" });
            return;
        }

        if (results.length === 0) {
            res.status(404).send({ message: "Invalid username or password" });
            return;
        }

        const user = results[0];

        
        const passwordIsValid = await bcrypt.compare(password, user.password);

        if (!passwordIsValid) {
            res.status(401).send({ message: "Invalid username or password" });
        } else {
            
            const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
                expiresIn: '1h', 
            });

            res.status(200).send({
                message: "Login successful",
                token, 
            });
        }
    });
});

module.exports = authrouter;
