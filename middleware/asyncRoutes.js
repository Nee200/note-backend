// Express 4 does not forward rejected handler promises automatically.
function installAsyncRoutes(app) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const original = app[method].bind(app);
        app[method] = (route, ...handlers) => {
            if (!handlers.length) return original(route);
            return original(route, ...handlers.flat(Infinity).map(handler => {
                if (typeof handler !== 'function' || handler.length === 4) return handler;
                return function asyncRoute(req, res, next) {
                    Promise.resolve().then(() => handler(req, res, next)).catch(next);
                };
            }));
        };
    }
}
module.exports = { installAsyncRoutes };
