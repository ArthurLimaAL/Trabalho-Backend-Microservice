const express = require("express");
const passport = require("passport");
const router = express.Router();
const authController = require("../controllers/auth-controller");

//botão de login
router.get("/google", passport.authenticate("google", {
    scope: ["profile", "email"]
})
);

// retorno do google
router.get("/google/callback", passport.authenticate("google", { session: false }),
authController.googleCallback
);

module.exports = router;
