import express, { json } from "express";
import cors from "cors";
import notificationRoutes from "./routes/notificationRoutes.js";

const app = express ();

app.use (cors ());
app.use (express.json ());
app.use ("/notifications", notificationRoutes);


export default app;