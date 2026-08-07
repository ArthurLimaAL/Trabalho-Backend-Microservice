import { generateToken } from "../utils/jwt.js";

export const loginWithGoogle = (user) => {
    // Aqui voce salvaria no banco (ex: MongoDB)

    const token = generateToken(user);

    return {
        user,
        token
    };
};
