const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const config = require('../config');

passport.use(new LocalStrategy(
    (username, password, done) => {
        if (username === config.adminUsername && password === config.adminPassword) {
            return done(null, { username });
        }
        return done(null, false, { message: 'Invalid credentials' });
    }
));

passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => done(null, { username }));