// Temporary production probe: no URL, headers, credentials or request bodies are logged.
export default {
    async fetch(request, env, ctx) {
        console.error('[edgetunnel2 diagnostic] fetch entered');
        try {
            const { default: worker } = await import('./_worker.js');
            return await worker.fetch(request, env, ctx);
        } catch (error) {
            console.error('[edgetunnel2 diagnostic] uncaught', error?.stack || error?.message || String(error));
            return new Response('Worker runtime failure; inspect execution logs.', {
                status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
            });
        }
    }
};
