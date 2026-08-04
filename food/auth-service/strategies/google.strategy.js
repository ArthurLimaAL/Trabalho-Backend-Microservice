const passport = require ("passport");
const GoogleStrategy = require ("passport-google-oauth20").Strategy;

passport.use(new GoogleStrategy({clientID: process.env.GOOGLE_CLIENT_ID,
    clienteSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: "/auth/google/callback"},
    async (acessToken, refreshToken, profile, done) => {
        const user = {
            id: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            role: "client"
        };

        return done (null, user);
}));