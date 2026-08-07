import { loginWithGoogle } from "../services/auth.service.js";

export const googleCallback = (req, res) => {
    const result = loginWithGoogle(req.user);

    res.json(result);
};
