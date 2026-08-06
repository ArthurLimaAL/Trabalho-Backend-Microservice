require("dotenv").config();

const express = require("express");
const passport = require("passport");
const cors = require("cors");

require("./auth-service/config/passport");

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

const authRoutes = require("./auth-service/routes/auth-routes");

app.use("/auth", authRoutes);

app.listen(3000, () => {
    console.log("Auth Service rodando na porta 3000");
});