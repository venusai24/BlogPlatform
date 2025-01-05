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


router.post('/register', async (req,res) => { 
    const { username, password} = req.body;
    db.connect((err) => {
        if (err) {
            console.error("Database connection error:", err);
            process.exit(1);
        }
        db.query("SELECT name, address FROM customers", function (err, result, fields) {
            if (err) throw err;
            console.log(result);
          });
        console.log("Database connected successfully");
        var sql = "INSERT INTO customers (username, password) VALUES (?,?)";
        db.query(sql, [username, password], )

    });

});

modules.exports = router;