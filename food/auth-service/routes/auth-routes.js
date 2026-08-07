import express from "express";
import passport from "passport";
import { googleCallback } from "../controllers/auth-controller.js";

const router = express.Router();

//botão de login
router.get("/google", passport.authenticate("google", {
    scope: ["profile", "email"]
})
);

// retorno do google
router.get("/google/callback", passport.authenticate("google", { session: false }),
    googleCallback
);

export default router;
