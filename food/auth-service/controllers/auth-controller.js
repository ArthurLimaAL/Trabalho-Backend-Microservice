const authService = require("../services/auth.service");

exports.googleCallback = (req, res) => {
    const result = authService.loginWithGoogle(req.user);

    res.json(result);
};