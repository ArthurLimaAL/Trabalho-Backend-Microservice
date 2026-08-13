function formatError(status, code, message, details) {
    const err = {
        success: false,
        error: {
            code: code || null,
            message: message || "Erro",
        }
    };

    if (details) err.error.details = details;

    return { status: status || 500, body: err };
}

module.exports = { formatError };
