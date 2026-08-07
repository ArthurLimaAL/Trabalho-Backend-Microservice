import express from "express";
import cors from "cors";
import notificationRoutes from "./routes/notificationRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/notifications", notificationRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok", servico: "notification-service", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.json({ status: "ok", servico: "notification-service" });
});

export default app;
