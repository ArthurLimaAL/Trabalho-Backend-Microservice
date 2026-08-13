require("dotenv").config();
const express = require("express");
const path = require("path");
const restaurantRoutes = require("./routes/restaurantRoutes");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.use("/api/restaurantes", restaurantRoutes);
app.use("/api/restaurants", restaurantRoutes);

module.exports = app;
