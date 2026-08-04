const { generateToken } = require("../utils/jwt");

exports.loginWithGoogle = (user) => {
    // Aqui voce salvaria no banco (ex: MongoDB)

    const token = generateToken(user);

    return {
        user,
        token
    };
};