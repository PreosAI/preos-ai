const { app } = require('@azure/functions');

app.http('resales-health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'resales/health',
    handler: async (request, context) => {
        return {
            status: 200,
            jsonBody: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                configured: !!(process.env.RESALES_P1 && process.env.RESALES_P2)
            }
        };
    }
});
