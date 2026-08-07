import "dotenv/config";

import express from "express";
import passport from "passport";
import cors from "cors";

import "./auth-service/config/passport.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

import authRoutes from "./auth-service/routes/auth-routes.js";

app.use("/auth", authRoutes);

app.listen(3000, () => {
    console.log("Auth Service rodando na porta 3000");
});
