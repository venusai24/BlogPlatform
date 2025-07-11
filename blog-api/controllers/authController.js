const User = require('../model/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = "my_secret_key";

exports.register = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send({ message: "Username and password are required" });
    }
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).send({ message: "User already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.status(201).send({ message: "User registered successfully" });
    } catch (error) {
        console.error("Error during registration:", error);
        res.status(500).send({ message: "Error registering user" });
    }
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).send({ message: "Invalid username or password" });
        }
        const passwordIsValid = await bcrypt.compare(password, user.password);
        if (!passwordIsValid) {
            return res.status(401).send({ message: "Invalid username or password" });
        }
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, {
            expiresIn: '1h',
        });
        res.status(200).send({
            message: "Login successful",
            token,
        });
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).send({ message: "Error logging in" });
    }
};
