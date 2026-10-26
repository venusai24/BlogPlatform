const User = require('../model/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const logger = require('../src/utils/logger');

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
        logger.error({ err: error }, 'Error during registration');
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
        const token = jwt.sign({ userId: user._id, username: user.username }, config.jwtSecret, {
            expiresIn: '1h',
            issuer: 'blogplatform-api',
            audience: 'blogplatform-web',
            algorithm: 'HS256',
        });
        res.status(200).send({
            message: "Login successful",
            token,
        });
    } catch (error) {
        logger.error({ err: error }, 'Error during login');
        res.status(500).send({ message: "Error logging in" });
    }
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) return res.status(404).send({ message: "User not found" });
        res.status(200).send(user);
    } catch (error) {
        logger.error({ err: error }, 'Error fetching user details');
        res.status(500).send({ message: "Error fetching user details" });
    }
};
