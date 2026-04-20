
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { Address, Signature } from '@aleohq/sdk';

const peers: WebSocket[] = [];
export const nodeId = uuid();


let currentNonces: Record<string, number> = {};


export function updateNonces(nonces: Record<string, number>) {
    currentNonces = { ...nonces };
}


const seenTxCache = new Set<string>();
const MAX_CACHE_SIZE = 10000;

function markAsSeen(txId: string) {
    seenTxCache.add(txId);
    if (seenTxCache.size > MAX_CACHE_SIZE) {
        const firstItem = seenTxCache.values().next().value;
        seenTxCache.delete(firstItem);
    }
}


function isValidTx(tx: any): boolean {
    
    if (!tx || !tx.txId || !tx.type || !tx.from || !tx.signature || tx.nonce === undefined) {
        console.warn(`rejeitada: Formato inválido ou sem assinatura.`);
        return false;
    }

    
    if (seenTxCache.has(tx.txId)) {
        return false;
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
        } else {
            console.warn(`rejeitada: Tipo desconhecido (${tx.type}).`);
            return false;
        }

        
        if (!aleoSignature.verify(senderAddress, message)) {
            console.warn(`Assinatura inválida.`);
            return false;
        }

        
        const expectedNonce = currentNonces[tx.from] || 0;
        if (tx.nonce !== expectedNonce) {
            console.warn(` Nonce inválido para ${tx.from}: esperado ${expectedNonce}, recebido ${tx.nonce}`);
            return false;
        }

        return true;
    } catch (err) {
        console.warn(`Erro ao validar a  ${tx.from}:`, err);
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
            if (msg.length > 50000) {
                console.warn(` Desconectando peer malicioso.`);
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
                        console.log(`📡 [P2P] TX Segura recebida da rede: ${tx.txId.substring(0, 10)}...`);
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
                console.log(`Desconectando peer inativo ...`);
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
        console.log(`Validador ${url} caiu. Tentando reconectar...`);
        setTimeout(() => connectPeer(url), 5000);
    });

    ws.on('error', () => {});
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