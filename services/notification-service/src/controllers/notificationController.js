import notificationService from "../services/notificationService.js";

const createNotification = (req, res) => {
    const notification = notificationService.create (req.body);
     res.status (201).json (notification);
};

const getNotifications = (req, res) => {
    const notifications = notificationService.getAll ();
     res.json (notifications);
};

export default {
    createNotification,
    getNotifications
};