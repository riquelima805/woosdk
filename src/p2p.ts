import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { Address, Signature } from '@aleohq/sdk';
import fs from 'fs';

const peers: WebSocket[] = [];
export const nodeId = uuid();

export function getPeerCount(): number {
    return peers.length;
}

let currentNonces: Record<string, number> = {};

export function updateNonces(nonces: Record<string, number>) {
    currentNonces = { ...nonces };
}

const CACHE_FILE = './seen_txs.json';
let seenTxCache = new Set<string>();
const MAX_CACHE_SIZE = 10000;


try {
    if (fs.existsSync(CACHE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        seenTxCache = new Set(saved);
    }
} catch (e) { 
    console.warn("Cache vazio, um novo será criado."); 
}


let isWritingCache = false;
setInterval(async () => {
    if (isWritingCache) return; 
    isWritingCache = true;
    try {
        await fs.promises.writeFile(CACHE_FILE, JSON.stringify(Array.from(seenTxCache)));
    } catch (e: any) {
       
        if (e.code !== 'EBUSY') {
            console.warn(`[P2P] Aviso: Não foi possível salvar o cache de TXs: ${e.message}`);
        }
    } finally {
        isWritingCache = false;
    }
}, 5000);

function markAsSeen(txId: string) {
    seenTxCache.add(txId);
    if (seenTxCache.size > MAX_CACHE_SIZE) {
        const firstItem = seenTxCache.values().next().value;
        seenTxCache.delete(firstItem);
    }
}

function isValidTx(tx: any): boolean {
    
    if (!tx || !tx.txId || !tx.type || !tx.from || !tx.signature || tx.nonce === undefined) {
        console.warn(`TX rejeitada: Formato inválido ou sem assinatura.`);
        return false;
    }

    if (seenTxCache.has(tx.txId)) {
        return false; // Já processamos essa
    }

    try {
        const senderAddress = Address.from_string(tx.from);
        const aleoSignature = Signature.from_string(tx.signature);
        let message: Uint8Array;
        
        if (tx.type === 'TRANSFER') {
            if (tx.amount === undefined || !tx.to) return false;
            message = new TextEncoder().encode(`${tx.from}:${tx.to}:${tx.amount}:${tx.nonce}`);
        } else if (tx.type === 'DEPLOY') {
            if (!tx.contract) return false;
            message = new TextEncoder().encode(`${tx.from}:${tx.contract}:DEPLOY:${tx.nonce}`);
        } else if (tx.type === 'EXECUTE') {
            if (!tx.contract || !tx.function) return false;
            message = new TextEncoder().encode(`${tx.from}:${tx.contract}:${tx.function}:EXECUTE:${tx.nonce}`);
        } else if (tx.type === 'TOKEN_TRANSFER') {
            if (!tx.contract || !tx.inputs || tx.inputs.length < 2) return false;
            const to = tx.inputs[0];
            const amount = parseInt(tx.inputs[1].replace('u64', ''));
            if (isNaN(amount) || amount <= 0) return false;
            message = new TextEncoder().encode(`${tx.from}:${tx.contract}:${to}:${amount}:${tx.nonce}`);
        } else {
            console.warn(`TX rejeitada: Tipo desconhecido (${tx.type}).`);
            return false;
        }
        
        if (!aleoSignature.verify(senderAddress, message)) {
            console.warn(`Assinatura inválida detectada.`);
            return false;
        }

        const mempoolTxs = (global as any).mempool || [];
        const pendingTxsCount = mempoolTxs.filter((m: any) => m.from === tx.from).length;
        
        const expectedNonce = (currentNonces[tx.from] || 0) + pendingTxsCount;
        
        if (tx.nonce < expectedNonce) {
            console.warn(` Nonce velho para ${tx.from}: esperado >= ${expectedNonce}, recebido ${tx.nonce}`);
            return false;
        }

        return true;
    } catch (err) {
        console.warn(`Erro ao validar a TX de ${tx.from}:`, err);
        return false;
    }
}

export function startP2P(serverPort: number) {
    const wss = new WebSocketServer({ port: serverPort });
    const alivePeers = new WeakSet<WebSocket>();

    wss.on('connection', (ws) => {
        peers.push(ws);
        alivePeers.add(ws);

        ws.on('pong', () => alivePeers.add(ws));

        ws.on('message', (msg) => {
            // Dropa se a mensagem for bizarramente grande (anti-DDoS)
            if (msg.length > 15000) {
                console.warn(` Desconectando peer malicioso (payload muito grande).`);
                ws.terminate();
                return;
            }

            try {
                const data = JSON.parse(msg.toString());

                if (data.type === 'TX') {
                    const tx = data.tx;

                    if (!isValidTx(tx)) {
                        return;
                    }

                    markAsSeen(tx.txId);
                    const existsInMempool = (global as any).mempool?.find((m: any) => m.txId === tx.txId);
                    if (!existsInMempool) {
                        (global as any).mempool?.push(tx);
                        console.log(`  TX  recebida da rede: ${tx.txId.substring(0, 10)}...`);
                        broadcast(data);
                    }
                }
            } catch (e) {
                
            }
        });

        ws.on('close', () => {
            const index = peers.indexOf(ws);
            if (index !== -1) peers.splice(index, 1);
        });
    });

    
    setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!alivePeers.has(ws)) {
                console.log(`Desconectando peer inativo...`);
                return ws.terminate();
            }
            alivePeers.delete(ws);
            ws.ping();
        });
    }, 30000);

    console.log(` P2P online na porta: ${serverPort}`);
}

export function connectPeer(url: string) {
    const ws = new WebSocket(url);

    ws.on('open', () => {
        peers.push(ws);
        console.log(`Conectado com sucesso ao validador: ${url}`);
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'TX') {
                const tx = data.tx;
                if (!isValidTx(tx)) return;

                markAsSeen(tx.txId);
                const existsInMempool = (global as any).mempool?.find((m: any) => m.txId === tx.txId);
                if (!existsInMempool) {
                    (global as any).mempool?.push(tx);
                    console.log(`TX Recebida do Validador: ${tx.txId.substring(0, 10)}...`);
                    broadcast(data);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        const index = peers.indexOf(ws);
        if (index !== -1) peers.splice(index, 1);
        console.log(`Validador ${url} caiu. Tentando reconectar em 5s...`);
        setTimeout(() => connectPeer(url), 5000);
    });

    ws.on('error', () => {
       
    });
}

export function broadcast(data: any) {
    if (data.type === 'TX' && data.tx && data.tx.txId) {
        markAsSeen(data.tx.txId);
    }

    peers.forEach((p) => {
        if (p.readyState === WebSocket.OPEN) {
            p.send(JSON.stringify(data));
        }
    });
}