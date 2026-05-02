

import http from 'http';

const PORT = 3030;

const routes = {
    'GET /health': (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', mode: 'mock' }));
    },

    'POST /prove': (req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(body); } catch (_) {}

            console.log(`[ZK-MOCK] /prove chamado — função: ${payload.function_name || 'unknown'}`);

            // Proof fake determinística
            const mockProof = Buffer.from(
                `MOCK_PROOF:${payload.function_name || 'fn'}:${Date.now()}`
            ).toString('hex').substring(0, 64);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                proof: mockProof,
                outputs: payload.inputs || [],
                execution_ms: 42
            }));
        });
    },

    'POST /verify': (req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(body); } catch (_) {}

            console.log(`[ZK-MOCK] /verify chamado — proof: ${(payload.proof || '').substring(0, 20)}...`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: true, verified_at: Date.now() }));
        });
    }
};

const server = http.createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    const handler = routes[key];

    if (handler) {
        handler(req, res);
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', path: req.url }));
    }
});

server.listen(PORT, () => {
    console.log(`ZK Prover MOCK rodando na porta ${PORT}`);
    console.log(`   /prove  → prova fake`);
    console.log(`   /verify → sempre válido`);
    console.log(`   /health → status`);
});
