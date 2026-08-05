const express = require('express');
const passport = require('passport');
const router = express.Router();

router.post('/login', passport.authenticate('local'), (req, res) => {
    res.json({ message: 'Login successful' });
});

router.post('/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Logout successful.' });
    });
});

router.get('/status', (req, res) => {
    res.json({ authenticated: req.isAuthenticated() });
});

module.exports = router;