import dotenv from 'dotenv';
dotenv.config();
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { execSync, spawnSync, execFile } from 'child_process';
import { promisify } from 'util';


const execFileAsync = promisify(execFile);
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Pool } from 'pg';
import { MerkleTree } from 'merkletreejs';
import { Address, Signature } from '@aleohq/sdk';
import * as provableSdk from '@provablehq/sdk';



import { 
    guardDeposit, 
    guardWithdraw, 
    applyWooDexStateChange,
    getAleoHash
} from './rpc_dex_patch';

import { buildMerkleTree, getProof } from './merkle';
import { startP2P, broadcast, updateNonces, getPeerCount } from './p2p'; 


const app = express();
app.use(cors());
app.use(express.json());


const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 120, 
    message: { error: "Muitas requisições." }
});
app.use('/', apiLimiter);


const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const L3_FOLDER_NAME = process.env.L3_FOLDER_NAME!;
const MY_ID = process.env.NODE_ID!;
const SEQUENCERS = process.env.SEQUENCERS_LIST!.split(',');
const ZK_PROVER_URL = process.env.ZK_PROVER_URL!;
const RPC_URL = process.env.RPC_URL!;
const NETWORK = process.env.NETWORK!;
const ENDPOINT = process.env.ENDPOINT!;
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8545');
const P2P_PORT = parseInt(process.env.P2P_PORT || '6000');
const SEQUENCER_INTERVAL_MS = parseInt(process.env.SEQUENCER_INTERVAL_MS || '15000');
const EXECUTION_FEE = parseInt(process.env.EXECUTION_FEE || '5');
const DEPLOY_FEE = parseInt(process.env.DEPLOY_FEE || '100'); 
const GAS_TOKEN_NAME = process.env.GAS_TOKEN_NAME || "GAS_L3";

if (!PRIVATE_KEY || !L3_FOLDER_NAME || !MY_ID || !ZK_PROVER_URL) {
    throw new Error(" Faltam variáveis no .env");
}


const pgClient = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, 
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pgClient.on('error', (err) => {
    console.error(" [PG POOL] Erro em conexão idle (ignorado):", err.message);
});

const db = {
    get: async (key: string) => {
        const res = await pgClient.query('SELECT value FROM kv_store WHERE key = $1', [key]);
        if (res.rows.length > 0) return res.rows[0].value;
        throw new Error('Not found');
    },
    put: async (key: string, value: any) => {
        await pgClient.query(`
            INSERT INTO kv_store (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, JSON.stringify(value)]);
    }
};


async function walLog(txId: string, txData: any, stateSnapshot: {
    balances?: Record<string, number>,
    tokenBalances?: Record<string, Record<string, number>>,
    nonces?: Record<string, number>
}): Promise<void> {
    await pgClient.query(
        `INSERT INTO wal_log (tx_id, tx_data, state_snapshot, applied)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (tx_id) DO NOTHING`,
        [txId, JSON.stringify(txData), JSON.stringify(stateSnapshot)]
    );
}

async function walComplete(txId: string): Promise<void> {
    await pgClient.query(`UPDATE wal_log SET applied = TRUE WHERE tx_id = $1`, [txId]);
}

const DEFAULT_SEQUENCER_ADDRESS = process.env.DEFAULT_SEQUENCER_ADDRESS!;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || DEFAULT_SEQUENCER_ADDRESS;
const WALEO_CONTRACT_ID = process.env.WALEO_CONTRACT_ID || "wanpedleo.aleo";

let currentNetworkStateRecord: string;

const INITIAL_GAS_SUPPLY = 1000000;

const L3_STATE = {
    balances: {
        [DEFAULT_SEQUENCER_ADDRESS]: INITIAL_GAS_SUPPLY
    } as Record<string, number>,
    tokenBalances: {} as Record<string, Record<string, number>>, 
    contracts: {} as Record<string, { owner: string, code: string, storage?: any, totalSupply?: number }>,
    nonces: {} as Record<string, number>
};

let mempool: any[] = [];
let currentBatchId = 1;
let lastCommitTimestamp: number = 0; 
(global as any).mempool = mempool;


async function loadStateFromDB() {
    console.log("Carregando estado persistente...");

    try {
        const dbRecord = await db.get('network_record');
        
        
        currentNetworkStateRecord = (typeof dbRecord === 'object' && dbRecord.record) 
            ? dbRecord.record 
            : dbRecord;
            
        console.log("NetworkState carregado.");
    } catch (e) {
        console.warn("Nenhum NetworkState encontrado");
        currentNetworkStateRecord = "";
    }

    
    const parseNumDict = (obj: any) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v) || 0]));
    const parseNestedNumDict = (obj: any) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, parseNumDict(v)]));

    try { const dbBalances = await db.get('balances'); if (dbBalances) L3_STATE.balances = parseNumDict(dbBalances); } catch (e) { }
    try { const dbTokenBalances = await db.get('tokenBalances'); if (dbTokenBalances) L3_STATE.tokenBalances = parseNestedNumDict(dbTokenBalances); } catch (e) { }
    try { const dbContracts = await db.get('contracts'); if (dbContracts) L3_STATE.contracts = dbContracts; } catch (e) { }
    try { const dbNonces = await db.get('nonces'); if (dbNonces) L3_STATE.nonces = dbNonces; } catch (e) { }

    updateNonces(L3_STATE.nonces);

    try { const dbBatchId = await db.get('batch_id'); if (dbBatchId) currentBatchId = Number(dbBatchId); } catch (e) { }

    if (!L3_STATE.contracts) L3_STATE.contracts = {};
    if (!L3_STATE.balances) L3_STATE.balances = {};
    if (!L3_STATE.tokenBalances) L3_STATE.tokenBalances = {};
    if (!L3_STATE.nonces) L3_STATE.nonces = {};
    if (!currentBatchId) currentBatchId = 1;

    
    if (!L3_STATE.contracts[WALEO_CONTRACT_ID]) {
        L3_STATE.contracts[WALEO_CONTRACT_ID] = {
            owner: DEFAULT_SEQUENCER_ADDRESS,
            code: "program wanpedleo.aleo { mapping account: address => u64; ... }",
            totalSupply: 0
        };
        L3_STATE.tokenBalances[WALEO_CONTRACT_ID] = {};
    }

    console.log(`✅ Estado carregado. Lote atual: #${currentBatchId}`);
}

async function saveStateToDB() {
    await db.put('balances', L3_STATE.balances);
    await db.put('tokenBalances', L3_STATE.tokenBalances);
    await db.put('contracts', L3_STATE.contracts);
    await db.put('nonces', L3_STATE.nonces);
}


function generateStateRoot(): string {
    const { root } = buildMerkleTree(L3_STATE.balances);
    if (root === '0') return '0field';
    const fieldNumber = BigInt('0x' + root.substring(0, 15)).toString();
    return `${fieldNumber}field`;
}


async function prepareSandbox(contractName: string, leoCode: string) {
    const cleanName = contractName.replace('.aleo', '').trim();
    const chainSandboxRoot = path.join(process.cwd(), 'sandbox', L3_FOLDER_NAME);
    const sandboxDir = path.join(chainSandboxRoot, cleanName);
    const srcDir = path.join(sandboxDir, 'src');

    // 1. Cria o projeto base se não existir
    if (!fs.existsSync(chainSandboxRoot)) fs.mkdirSync(chainSandboxRoot, { recursive: true });
    if (!fs.existsSync(sandboxDir)) {
        console.log(`[SANDBOX] Criando novo ambiente para: ${cleanName}`);
        // [FIX 1 - ASYNC] leo new pode demorar varios segundos; nao deve bloquear o event loop
        await execFileAsync('leo', ['new', cleanName], { cwd: chainSandboxRoot });
    }
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

    // 2. Escreve o código principal
    fs.writeFileSync(path.join(srcDir, 'main.leo'), leoCode);

    // 3. Verifica Imports no código
    const importRegex = /import\s+([a-zA-Z0-9_]+\.aleo);/g;
    let match;
    const dependencies: any = {};
    let hasDependencies = false;

    while ((match = importRegex.exec(leoCode)) !== null) {
        const importedContract = match[1];
        console.log(`[DEPENDENCIA] Detectado import: ${importedContract}`);
        
        
        const depState = L3_STATE.contracts[importedContract];
        if (!depState || !depState.code) {
            throw new Error(`Dependencia '${importedContract}' nao encontrada na rede L3. Faca o deploy dela primeiro!`);
        }

        const depCleanName = importedContract.replace('.aleo', '');
        const depDir = path.join(sandboxDir, 'dependencies', depCleanName);
        const depSrcDir = path.join(depDir, 'src');

        
        fs.mkdirSync(depSrcDir, { recursive: true });
        fs.writeFileSync(path.join(depSrcDir, 'main.leo'), depState.code);

        
        const depProgramJson = {
            program: importedContract,
            version: "0.0.0",
            description: "L3 Local Dependency"
        };
        fs.writeFileSync(path.join(depDir, 'program.json'), JSON.stringify(depProgramJson, null, 2));

        
        dependencies[importedContract] = { path: `./dependencies/${depCleanName}` };
        hasDependencies = true;
    }

    
    const mainProgramJsonPath = path.join(sandboxDir, 'program.json');
    if (fs.existsSync(mainProgramJsonPath)) {
        const mainProgramJson = JSON.parse(fs.readFileSync(mainProgramJsonPath, 'utf8'));
        if (hasDependencies) {
            mainProgramJson.dependencies = dependencies;
        } else {
            delete mainProgramJson.dependencies; 
        }
        fs.writeFileSync(mainProgramJsonPath, JSON.stringify(mainProgramJson, null, 2));
    }

    return { sandboxDir, aleoFilePath: path.join(sandboxDir, 'build', 'main.aleo') };
}


function aggregateProofsFromList(proofsList: string[]): { merkleRoot: string } {
    if (proofsList.length === 0) return { merkleRoot: "0field" };
    const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest();
    const leaves = proofsList.map(p => sha256(p));
    const tree = new MerkleTree(leaves, sha256, { sortPairs: true });
    const root = tree.getRoot().toString('hex');
    const fieldNumber = BigInt('0x' + root.substring(0, 15)).toString();
    return { merkleRoot: `${fieldNumber}field` };
}

function aggregateProofs(currentMempool: any[]) {
    const proofs = currentMempool.filter(tx => tx.proof && tx.proof !== "NO_PROOF").map(tx => tx.proof);
    if (proofs.length === 0) return { aggregatedProof: "0field", proofsList: [] };
    const hash = crypto.createHash('sha256').update(proofs.join('')).digest('hex');
    const fieldNumber = BigInt('0x' + hash.substring(0, 15)).toString();
    return { aggregatedProof: `${fieldNumber}field`, proofsList: proofs };
}

function getLeader(batchId: number) {
    return SEQUENCERS[batchId % SEQUENCERS.length];
}

function safeExec(cmd: string, cwd: string) {
    try {
        return execSync(cmd, { cwd, encoding: 'utf-8', shell: true, stdio: 'pipe' });
    } catch (err: any) {
        throw new Error((err.stdout?.toString() || "") + "\n" + (err.stderr?.toString() || ""));
    }
}



function normalizeAleoValue(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;

    const clean = value.replace('.public', '').replace('.private', '').trim();

    if (/^-?\d+u(8|16|32|64|128)$/.test(clean)) return Number(clean.replace(/u(8|16|32|64|128)/, ''));
    if (clean === 'true' || clean === 'false') return clean === 'true';
    if (/^\d+field$/.test(clean)) return clean;

    if (clean.startsWith('{') && clean.endsWith('}')) {
        try {
            const jsonLike = clean
                .replace(/([a-zA-Z0-9_]+):/g, '"$1":')
                .replace(/(\d+)u(8|16|32|64|128)/g, '$1')
                .replace(/'/g, '"');
            return JSON.parse(jsonLike);
        } catch {
            return clean;
        }
    }
    return clean;
}

function ensureContractStorage(contractName: string, from: string) {
    if (!L3_STATE.contracts[contractName]) {
        L3_STATE.contracts[contractName] = { owner: from, code: "", storage: {} };
    }
    if (!L3_STATE.contracts[contractName].storage) {
        L3_STATE.contracts[contractName].storage = {};
    }
    return L3_STATE.contracts[contractName].storage;
}

function setNestedMapping(contractName: string, mappingName: string, key: string, value: any, from: string) {
    const storage = ensureContractStorage(contractName, from);
    if (!storage[mappingName]) storage[mappingName] = {};
    storage[mappingName][key] = value;
}

function applyDefiTransfer(tokenContract: string, sender: string, receiver: string, amount: number) {
    if (!L3_STATE.tokenBalances[tokenContract]) L3_STATE.tokenBalances[tokenContract] = {};
    const senderBal = L3_STATE.tokenBalances[tokenContract][sender] || 0;

    if (senderBal >= amount) {
        L3_STATE.tokenBalances[tokenContract][sender] = senderBal - amount;
        L3_STATE.tokenBalances[tokenContract][receiver] = (L3_STATE.tokenBalances[tokenContract][receiver] || 0) + amount;
        console.log(`[FUTURE ENGINE] ${amount} transferidos para ${receiver.substring(0, 10)}`);
    }
}

async function applyStateChanges(contractName: string, from: string, stateChanges: any[], originalInputs: any[] = []) {
    console.log(` [STATE ENGINE V3] Aplicando ${stateChanges.length} mudanças (Rust Enhanced)...`);
    
    let eventData: any = {};
    
    
    const cleanInputs = originalInputs.map(i => {
    if (!i) return ""; 
    return typeof i === 'string' 
        ? i.replace(/u(8|16|32|64|128)/g, '').replace('.public', '').replace('.private', '').trim() 
        : i;
});

    for (const change of stateChanges) {
        if (!change || typeof change.kind !== 'string' || !change.contract) {
            console.warn("Schema inválido injetado.");
            continue;
        }
        try {
            switch (change.kind) {
                case 'future_execution':
                    const funcName = change.mapping.trim();
                    const args = JSON.parse(change.value);

                    
                    if (funcName.includes('transfer') && args.length >= 2) {
                        const receiver = args[0];
                        const amount = Number(args[1]);
                        applyDefiTransfer(change.contract, from, receiver, amount);
                    } 
                    
                    
                    else if (funcName === 'mint_public') {
                        
                        const strings = args.filter((a: any) => isNaN(Number(a)) && !String(a).includes('[') && !String(a).includes(']'));
                        const numbers = args.filter((a: any) => !isNaN(Number(a)) && String(a).trim() !== '' && !String(a).includes('[') && !String(a).includes(']'));

                        const receiver = strings[0]; 
                        const amount = Number(numbers[0]); 

                        
                        if (!L3_STATE.tokenBalances[change.contract]) {
                            L3_STATE.tokenBalances[change.contract] = {};
                        }
                        
                        
                        L3_STATE.tokenBalances[change.contract][receiver] = (L3_STATE.tokenBalances[change.contract][receiver] || 0) + amount;
                        
                        console.log(`🪙 [TOKEN ENGINE] Mint ZK processado: ${amount} tokens criados em ${change.contract} para ${receiver.substring(0,8)}`);
                        eventData = { action: "mint", contract: change.contract, receiver, amount };
                    }
                    
                    if (change.contract === 'woo_dex.aleo') {
                       eventData = await applyWooDexStateChange(change, from, cleanInputs, L3_STATE);
                   }
                   

                    else {
                        ensureContractStorage(change.contract, from);
                        if (!L3_STATE.contracts[change.contract].storage['futures']) L3_STATE.contracts[change.contract].storage['futures'] = {};
                        L3_STATE.contracts[change.contract].storage['futures'][`${funcName}_${Date.now()}`] = { sender: from, arguments: args };
                    }
                    break; 

                
                case 'transfer':
                    if (change.contract && change.sender && change.receiver && change.amount) {
                        applyDefiTransfer(change.contract, change.sender, change.receiver, change.amount);
                    }
                    break;
                case 'storage_set':
                    if (change.contract && change.mapping && change.key) {
                        if (change.mapping === 'account' || change.mapping === 'balances') {
                            if (!L3_STATE.tokenBalances[change.contract]) L3_STATE.tokenBalances[change.contract] = {};
                            L3_STATE.tokenBalances[change.contract][change.key] = Number(change.value);
                        } else {
                            ensureContractStorage(change.contract, from);
                            if (!L3_STATE.contracts[change.contract].storage[change.mapping]) L3_STATE.contracts[change.contract].storage[change.mapping] = {};
                            L3_STATE.contracts[change.contract].storage[change.mapping][change.key] = change.value;
                        }
                    }
                    break;
                case 'output':
                    break;
            }
        } catch (err: any) {
            console.log(`[STATE ENGINE ERROR] ${err.message}`);
        }
    }
    await saveStateToDB();
    return eventData;
}

app.post('/', async (req: Request, res: Response) => {
    const { jsonrpc, method, params, id } = req.body;
    if (jsonrpc !== '2.0') return res.status(400).json({ error: "Apenas JSON-RPC 2.0" });


    if (params && params[0] && params[0].from) {
        const txsPerAddress = mempool.filter((tx: any) => tx.from === params[0].from).length;
        if (txsPerAddress >= 10) {
            console.warn(`[ANTI-SPAM] Endereço ${params[0].from} bloqueado temporariamente (Mempool cheio).`);
            return res.json({ jsonrpc: "2.0", id, error: "Muitas TXs pendentes deste endereço. Aguarde o próximo lote." });
        }
    }

    if (method === 'woo_getPools') {
        const dexContract = L3_STATE.contracts['woo_dex.aleo'];
        const pools = dexContract?.storage?.pools || {};
        const registry = dexContract?.storage?.token_registry || {};

        // 1. MAPEAMENTO REVERSO MÁGICO
        const reverseMap: Record<string, string> = {};
        for (const tokenName of Object.keys(L3_STATE.tokenBalances)) {
            try {
                const field = await contractNameToFieldAsync(tokenName);
                reverseMap[field] = tokenName.replace('.aleo', '').toUpperCase();
            } catch(e) {}
        }

        // 2. Monta as pools formatando os nomes
        const poolsArray = Object.entries(pools).map(([pairKey, pool]: [string, any]) => {
            let sX = registry[pool.token_x] || reverseMap[pool.token_x] || pool.nameX || pool.token_x || '';
            let sY = registry[pool.token_y] || reverseMap[pool.token_y] || pool.nameY || pool.token_y || '';

            if (typeof sX === 'string') {
                sX = sX.replace('.aleo', '').toUpperCase();
                if (sX.endsWith('FIELD')) sX = sX.substring(0, 6) + '...';
            }
            if (typeof sY === 'string') {
                sY = sY.replace('.aleo', '').toUpperCase();
                if (sY.endsWith('FIELD')) sY = sY.substring(0, 6) + '...';
            }

            return {
                pairKey,
                tokenX: pool.token_x,
                tokenY: pool.token_y,
                symbolX: sX, 
                symbolY: sY,
                reserveX: pool.reserve_x || 0,
                reserveY: pool.reserve_y || 0,
                total_shares: pool.total_shares || 0,
                fee: 0.3
            };
        });

        return res.json({ jsonrpc: "2.0", id, result: poolsArray });
    }


    if (method === 'woo_getTransactionReceipt') {
        const txId = params[0];
        try {
            
            const resDb = await pgClient.query(`
                SELECT batch_id, transactions FROM batch_history 
                WHERE transactions @> $1
            `, [JSON.stringify([{ txId }])]);

            if (resDb.rows.length > 0) {
                const batch = resDb.rows[0];
                const tx = batch.transactions.find((t: any) => t.txId === txId);
                return res.json({ 
                    jsonrpc: "2.0", id, 
                    result: {
                        transactionHash: txId,
                        blockNumber: batch.batch_id,
                        from: tx.from,
                        to: tx.to,
                        status: 'confirmed',
                        gasUsed: EXECUTION_FEE,
                        logs: []
                    }
                });
            }
        } catch (e) {}
        return res.json({ jsonrpc: "2.0", id, result: null });
    }

    
    if (method === 'woo_getBatchInfo') {
        const batchId = params[0] || currentBatchId - 1;
        return res.json({
            jsonrpc: "2.0",
            id,
            result: {
                batchId: batchId,
                stateRoot: generateStateRoot(),
                transactionCount: mempool.length,
                timestamp: Date.now(),
                sequencer: DEFAULT_SEQUENCER_ADDRESS
            }
        });
    }

    
    
    if (method === 'woo_estimateFee') {
        const operation = params[0] || 'transfer';
        let fee = EXECUTION_FEE; 
        
        if (operation === 'deploy') fee = DEPLOY_FEE; 
        else if (operation === 'execute') fee = EXECUTION_FEE; 
        
        return res.json({
            jsonrpc: "2.0",
            id,
            result: { estimatedFee: fee, unit: "microcredits" }
        });
    }

   
    if (method === 'defi_getUserPortfolio') {
        const userAddress = params[0];
        if (!userAddress) return res.json({ jsonrpc: "2.0", id, error: "Endereço não fornecido" });

        let portfolio: Record<string, number> = {};

        // Pega os tokens normais (ex: wanpedleo.aleo)
        for (const tokenId in L3_STATE.tokenBalances) {
            const balance = L3_STATE.tokenBalances[tokenId][userAddress];
            if (balance && balance > 0) {
                portfolio[tokenId] = balance;
            }
        }

        // Pega o saldo de Gás e usa o nome do .env
        const gasBalance = L3_STATE.balances[userAddress];
        if (gasBalance && gasBalance > 0) {
            portfolio[GAS_TOKEN_NAME] = gasBalance; // <--- MUDANÇA AQUI
        }

        return res.json({ jsonrpc: "2.0", id, result: portfolio });
    }


    if (method === 'woo_getNonce') {
        const address = params[0];
        const nextNonce = L3_STATE.nonces[address] || 0;
        console.log(` Nonce solicitado para ${address.substring(0, 8)}: ${nextNonce}`);
        return res.json({ jsonrpc: "2.0", id, result: nextNonce });
    }

    if (method === 'defi_getTokenStats') {
        const tokenId = params[0];
        if (!tokenId) return res.json({ jsonrpc: "2.0", id, error: "Token ID não fornecido" });

        const tokenInfo = L3_STATE.contracts[tokenId];
        
        
        if (!tokenInfo && tokenId !== GAS_TOKEN_NAME) { 
             return res.json({ jsonrpc: "2.0", id, error: "Token não registrado na L3" });
        }


        const balances = L3_STATE.tokenBalances[tokenId] || {};
        let holdersCount = 0;
        for (const addr in balances) {
            if (balances[addr] > 0) holdersCount++;
        }
        
        return res.json({
            jsonrpc: "2.0",
            id,
            result: {
                tokenId: tokenId,
                name: tokenInfo?.name || tokenId,
                symbol: tokenInfo?.symbol || "N/A",
                totalSupply: tokenInfo?.totalSupply || 0,
                holdersCount: holdersCount,
                owner: tokenInfo?.owner || "L3_NATIVE"
            }
        });
    }

    if (method === 'woo_mintToken') {
        const { from, to, tokenId, amount, signature, nonce } = params[0];

        
        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(
                `${from}:${tokenId}:${to}:${amount}:${nonce}:MINT`
            );
            if (!aleoSignature.verify(senderAddress, message)) {
                throw new Error("Assinatura inválida");
            }
            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) {
                return res.json({ jsonrpc: "2.0", id, error: "Nonce inválido" });
            }
        } catch (err) {
            return res.json({ jsonrpc: "2.0", id, error: "Erro criptográfico" });
        }

        
        const token = L3_STATE.contracts[tokenId];
        if (!token) {
            return res.json({ jsonrpc: "2.0", id, error: "Token não encontrado" });
        }
        
        
        const trueMaxSupply = token.maxSupply || 0;
        if (token.totalSupply + amount > trueMaxSupply) {
            return res.json({ jsonrpc: "2.0", id, error: "Max supply excedido" });
        }

        
        if (!L3_STATE.tokenBalances[tokenId]) L3_STATE.tokenBalances[tokenId] = {};
        L3_STATE.tokenBalances[tokenId][to] = (L3_STATE.tokenBalances[tokenId][to] || 0) + amount;
        token.totalSupply += amount;

        
        L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;

        await saveStateToDB();

        return res.json({
            jsonrpc: "2.0",
            id,
            result: "Mint seguro executado"
        });
    }

    if (method === 'woo_getBalance') {
        const address = params[0];
        const saldoEncontrado = L3_STATE.balances[address] || 0;
        console.log(`\n[RPC DEBUG] Pediram saldo de: ${address}`);
        console.log(`[RPC DEBUG] Saldos l3?`, L3_STATE.balances);
        console.log(`[RPC DEBUG] Saldo: ${saldoEncontrado}`);
        return res.json({ jsonrpc: "2.0", id, result: saldoEncontrado });
    }

    
    if (method === 'woo_getTokenBalance') {
        const address = params[0];
        const tokenId = params[1];
        if (!L3_STATE.tokenBalances[tokenId]) return res.json({ jsonrpc: "2.0", id, result: 0 });
        return res.json({ jsonrpc: "2.0", id, result: L3_STATE.tokenBalances[tokenId][address] || 0 });
    }

    
    if (method === 'woo_getMappingValue') {
    let [contractName, mappingName, key] = params;
    const contract = L3_STATE.contracts[contractName];

    
    if (mappingName === 'lp_shares_simple') {
    const pairKey = key;       
    const userAddr = params[3]; 
    const simpleKey = `${pairKey}:${userAddr}`;
    const storage = L3_STATE.contracts['woo_dex.aleo']?.storage?.lp_shares || {};
    return res.json({ jsonrpc: '2.0', id, result: storage[simpleKey] || 0 });
    }

    
    if (contractName === 'woo_dex.aleo' && (mappingName === 'balances' || mappingName === 'lp_shares')) {
        
        const tokenIdField = params[3]; 
        const userAddress = key;
        
        
        key = await getAleoHash(tokenIdField, userAddress);
    }

    if (!contract?.storage?.[mappingName]) {
        return res.json({ jsonrpc: '2.0', id, result: null });
    }

    return res.json({
        jsonrpc: '2.0',
        id,
        result: contract.storage[mappingName][key] ?? null
    });
}

   
  
    if (method === 'woo_getDexBalances') {
        const userAddress = params[0];
        if (!userAddress) return res.json({ jsonrpc: "2.0", id, error: "Endereço não fornecido" });

        const dexBalances: Record<string, number> = {};
        
        
        const simpleBalances = L3_STATE.contracts['woo_dex.aleo']?.storage?.simple_balances || {};

        for (const [tokenStr, userBals] of Object.entries(simpleBalances)) {
            
            const bal = (userBals as Record<string, number>)[userAddress];
            if (bal && bal > 0) {
                dexBalances[tokenStr] = bal;
            }
        }

        return res.json({ jsonrpc: "2.0", id, result: dexBalances });
    }
    

    
if (method === 'woo_sendTransaction') {
    const { from, to, amount, signature, nonce } = params[0];
    if (!signature) return res.json({ jsonrpc: "2.0", id, error: "Transação rejeitada: Assinatura ausente." });
    if (nonce === undefined) return res.json({ jsonrpc: "2.0", id, error: "Nonce obrigatório." });

    try {
        const senderAddress = Address.from_string(from);
        const aleoSignature = Signature.from_string(signature);
        const message = new TextEncoder().encode(`${from}:${to}:${amount}:${nonce}`);
        if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura não corresponde ao endereço.");
        const expectedNonce = L3_STATE.nonces[from] || 0;
        if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce inválido. Esperado: ${expectedNonce}` });
    } catch (err) {
        console.warn(`[SEGURANÇA] Tentativa de fraude detectada ${from}!`);
        return res.json({ jsonrpc: "2.0", id, error: "Assinatura  inválida!" });
    }

        const senderBalance = L3_STATE.balances[from] ?? 0;

       if (senderBalance < amount) {
        return res.json({ jsonrpc: "2.0", id, error: "Saldo insuficiente" });
       }

    

    L3_STATE.balances[from] -= amount;
    L3_STATE.balances[to] = (L3_STATE.balances[to] || 0) + amount;

    
    L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;

    await saveStateToDB();
    updateNonces(L3_STATE.nonces);

    const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
    const newTx = {
        txId,
        type: "TRANSFER",
        from,
        to,
        amount,
        nonce,
        signature,
        proof: "NO_PROOF",
        timestamp: Date.now()
    };
    mempool.push(newTx);
    broadcast({ type: "TX", tx: newTx });
    console.log(`Transferência: ${amount} tokens de ${from.substring(0, 8)} para ${to.substring(0, 8)} (nonce ${nonce})`);
    return res.json({ jsonrpc: "2.0", id, result: txId });
}

  
    if (method === 'woo_sendTokenTransaction') {
        
        const { from, to, tokenId, signature, nonce } = params[0];
        const rawAmount = params[0].amount || (params[0].amounts ? params[0].amounts[0] : undefined);

        if (!signature || nonce === undefined || rawAmount === undefined) {
            return res.json({ jsonrpc: "2.0", id, error: "Dados incompletos." });
        }

        
        const numericAmount = typeof rawAmount === 'string' ? parseInt(rawAmount.replace('u64', '')) : Number(rawAmount);
        const formattedAmount = `${numericAmount}u64`;

        
        if (!L3_STATE.tokenBalances[tokenId]) {
            return res.json({ jsonrpc: "2.0", id, error: "Token não encontrado" });
        }
        
        const currentBalance = L3_STATE.tokenBalances[tokenId][from] || 0;
        
        if (numericAmount <= 0 || currentBalance < numericAmount) {
            console.log(`REJEITADO! ${from.substring(0,8)} tentou enviar ${numericAmount}, mas tem ${currentBalance}`);
            return res.json({ jsonrpc: "2.0", id, error: "Saldo insuficiente" });
        }

        
        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            
            const message = new TextEncoder().encode(`${from}:${tokenId}:${to}:${numericAmount}:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida");

            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce inválido.` });
        } catch (err) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura  inválida!" });
        }

        
        const cleanName = tokenId.replace('.aleo', '').trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(cleanName)) {
            return res.json({ jsonrpc: "2.0", id, error: "Nome de contrato inválido." });
        }
        const chainSandboxRoot = path.join(process.cwd(), 'sandbox', L3_FOLDER_NAME);
        const sandboxDir = path.join(chainSandboxRoot, cleanName);
        const srcDir = path.join(sandboxDir, 'src');
        const aleoFilePath = path.join(sandboxDir, 'build', 'main.aleo');
        const inputs = [to, formattedAmount];

        
        if (!fs.existsSync(chainSandboxRoot)) {
            fs.mkdirSync(chainSandboxRoot, { recursive: true });
        }

        try {
            
            if (!fs.existsSync(sandboxDir)) {
                console.log(` Criando sandbox isolado para token: ${cleanName} na rede ${L3_FOLDER_NAME}`);
                await execFileAsync('leo', ['new', cleanName], { cwd: chainSandboxRoot });
            }
            if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
            
            
            fs.writeFileSync(path.join(srcDir, 'main.leo'), L3_STATE.contracts[tokenId].code);
            
            if (!fs.existsSync(aleoFilePath)) {
                console.log(`Compilando token no sandbox da rede ${L3_FOLDER_NAME}...`);
                await execFileAsync('leo', ['build'], { cwd: sandboxDir });
            }

            console.log(` Solicitando prova de TRANSFERENCIA para ${tokenId} via Worker Rust...`);

            const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
            await walLog(txId, { type: "TOKEN_TRANSFER", from, to, tokenId, numericAmount, nonce }, {
                tokenBalances: {
                    [tokenId]: {
                        [from]: currentBalance - numericAmount,
                        [to]: (L3_STATE.tokenBalances[tokenId][to] || 0) + numericAmount
                    }
                },
                nonces: { [from]: (L3_STATE.nonces[from] || 0) + 1 }
            });

            const response = await fetch(`${ZK_PROVER_URL}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aleo_file_path: aleoFilePath,
                    function_name: "transfer_public",
                    private_key: PRIVATE_KEY,
                    inputs: inputs,
                    sender_address: from
                })
            });

            if (!response.ok) {
                const errorDetail = await response.text();
                throw new Error(`Worker Rust retornou erro: ${errorDetail}`);
            }
            const parsed = await response.json();

            
            L3_STATE.tokenBalances[tokenId][from] = currentBalance - numericAmount;
            L3_STATE.tokenBalances[tokenId][to] = (L3_STATE.tokenBalances[tokenId][to] || 0) + numericAmount;

            L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
            await saveStateToDB();
            await walComplete(txId);
            updateNonces(L3_STATE.nonces);

            
            const newTx = {
                txId,
                type: "TOKEN_TRANSFER",
                contract: tokenId,
                function: "transfer_public",
                inputs: inputs,
                nonce,
                signature,
                proof: parsed.proof, 
                timestamp: Date.now()
            };

            mempool.push(newTx);
            broadcast({ type: "TX", tx: newTx });

            console.log(` [TRANSFERENCIA] ${numericAmount} de ${from.substring(0,8)} para ${to.substring(0,8)} no token '${tokenId}'`);
            return res.json({ jsonrpc: "2.0", id, result: { txId } });

        } catch (error: any) {
            console.error(`Erro no Worker Rust HTTP (Transfer):`, error.message);
            return res.json({ jsonrpc: "2.0", id, error: "Falha na geracao da ZK Proof da Transferencia" });
        }
    }

    if (method === 'woo_createToken') {
        const { from, tokenId, name, symbol, maxSupply, signature, nonce } = params[0];

        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(`${from}:${tokenId}:CREATE:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida");
            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: "Nonce inválido" });
        } catch (err) {
            return res.json({ jsonrpc: "2.0", id, error: "Erro criptográfico" });
        }

        if (L3_STATE.contracts[tokenId]) {
            return res.json({ jsonrpc: "2.0", id, error: "Token já existe" });
        }

        L3_STATE.tokenBalances[tokenId] = {};
        L3_STATE.contracts[tokenId] = {
            owner: from,
            type: "TOKEN",
            name,
            symbol,
            decimals: 6,
            maxSupply,
            totalSupply: 0,
            mintable: true,
            burnable: true,
            pausable: false,
            storage: {}
        };
        L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
        await saveStateToDB();
        return res.json({ jsonrpc: "2.0", id, result: `Token ${tokenId} criado com sucesso` });
    }


    if (method === 'woo_executeContract') {
        
        const { from, contractName, functionName, inputs, signature, nonce, proof, state_changes } = params[0];

        if (!signature || nonce === undefined) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura e nonce são obrigatórios." });
        }
        if (!L3_STATE.contracts[contractName]) {
            return res.json({ jsonrpc: "2.0", id, error: "Contrato não encontrado" });
        }
        
        
        if (!proof || proof === "NO_PROOF") {
            return res.json({ jsonrpc: "2.0", id, error: "Prova ZK obrigatória. O cliente não gerou a prova." });
        }

        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(`${from}:${contractName}:${functionName}:EXECUTE:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura invalida.");
            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce invalido. Esperado: ${expectedNonce}` });
        } catch (err) {
            console.warn(` [SEGURANCA] Tentativa de execucao invalida de ${from}`);
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura ou Nonce invalidos!" });
        }

       
        if (!from || !/^aleo1[a-z0-9]{58}$/.test(from)) {
            return res.json({ jsonrpc: "2.0", id, error: "Endereco 'from' invalido." });
        }

        const cleanName = contractName.replace('.aleo', '').trim();

        if (contractName === 'woo_dex.aleo' && functionName === 'deposit') {
            const tokenContractName = inputs[2]; 
            const guard = guardDeposit(L3_STATE, from, inputs, tokenContractName);
            if (!guard.ok) return res.json({ jsonrpc: "2.0", id, error: guard.error });
        }

        try {
            const { sandboxDir, aleoFilePath } = await prepareSandbox(contractName, L3_STATE.contracts[contractName].code);

            if (!fs.existsSync(aleoFilePath)) {
                console.log(`[COMPILADOR] Compilando contrato e dependencias na rede ${L3_FOLDER_NAME}...`);
                
                await execFileAsync('leo', ['build'], { cwd: sandboxDir });
            }

            const gasBalance = L3_STATE.balances[from] ?? 0;
            if (gasBalance < EXECUTION_FEE) {
                return res.json({ jsonrpc: "2.0", id, error: "Gas insuficiente" });
            }

            
            console.log(`[ZK-HTTP] Verificando prova enviada pelo usuario via Browser...`);
            
            
            const safeAleoFilePath = aleoFilePath.replace(/\\/g, '/');

            const verifyResp = await fetch(`${ZK_PROVER_URL}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aleo_file_path: safeAleoFilePath, 
                    function_name: functionName,
                    proof: proof,  
                    inputs: inputs,
                })
            });
            
            
            if (!verifyResp.ok) {
                const errText = await verifyResp.text();
                throw new Error(`Worker Rust recusou a verificacao: ${errText}`);
            }

            const verifyData = await verifyResp.json() as any;
            if (!verifyData.valid) throw new Error("A prova gerada pelo Browser e matematicamente invalida!");

            
            if (contractName === 'woo_dex.aleo' && functionName === 'withdraw') {
                const tokenContractName = inputs[2];
                const guard = guardWithdraw(L3_STATE, from, inputs, tokenContractName);
                if (!guard.ok) console.error(`[CRÍTICO] ZK aprovou withdraw, mas RPC falhou: ${guard.error}`);
            }

            
            let safeStateChanges = state_changes || [];

            if (functionName === 'transfer_public') {
                const receiver = inputs[0]; 
                
                const amountStr = inputs[1].replace(/u(8|16|32|64|128)/g, '').replace('.public', '').replace('.private', '').trim();
                const safeAmount = Number(amountStr);

                console.log(`[SEGURANÇA] Interceptando transferência nativa: ${safeAmount} tokens.`);

                
                const tokenContract = contractName;
                const senderBalance = L3_STATE.tokenBalances[tokenContract]?.[from] || 0;
                
                if (senderBalance < safeAmount) {
                    return res.json({ jsonrpc: "2.0", id, error: "Saldo insuficiente no banco de dados da L3!" });
                }

                
                safeStateChanges = [{
                    kind: 'transfer',
                    contract: tokenContract,
                    sender: from,
                    receiver: receiver,
                    amount: safeAmount
                }];
            }

            
            let executionResults = {}; 
            if (safeStateChanges && Array.isArray(safeStateChanges)) {
                
                executionResults = await applyStateChanges(contractName, from, safeStateChanges, inputs);
                await saveStateToDB();
            }
            

            L3_STATE.balances[from] = (L3_STATE.balances[from] || 0) - EXECUTION_FEE;
            L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
            await saveStateToDB();
            updateNonces(L3_STATE.nonces);


            const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
            const newTx = {
                txId,
                type: "EXECUTE",
                contract: contractName,
                function: functionName,
                inputs: inputs,
                nonce,
                signature,
                proof: proof, 
                timestamp: Date.now()
            };
            
            mempool.push(newTx);
            broadcast({ type: "TX", tx: newTx });
            
            console.log(` [ZK-HTTP] Execução concluída. Nonce atualizado para ${L3_STATE.nonces[from]}`);
            
            return res.json({ 
                jsonrpc: "2.0", 
                id, 
                result: {
                    proof: proof,
                    execution_results: executionResults 
                } 
            });
            
        } catch (error: any) {
            console.error(` Erro na Verificação do Worker HTTP:`, error.message);
            return res.json({ jsonrpc: "2.0", id, error: `Falha ao verificar a Prova ZK: ${error.message}` });
        }
    }

    if (method === 'woo_deployContract') {
        const { from, contractName, leoCode, signature, nonce } = params[0];

        if (!signature || nonce === undefined) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura e nonce são obrigatórios." });
        }

        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(`${from}:${contractName}:DEPLOY:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida.");
            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce inválido. Esperado: ${expectedNonce}` });
        } catch (err) {
            console.warn(` Tentativa de deploy inválido de ${from}`);
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura criptográfica inválida!" });
        }

        const cleanName = contractName.replace('.aleo', '').trim();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(cleanName)) {
            return res.json({ jsonrpc: "2.0", id, error: "Nome de contrato inválido." });
        }

        if (L3_STATE.contracts[contractName]) {
            return res.json({ jsonrpc: "2.0", id, error: "Contrato já existe" });
        }

        const senderBalance = L3_STATE.balances[from] ?? 0;
        if (senderBalance < DEPLOY_FEE) {
            return res.json({ jsonrpc: "2.0", id, error: "Gás insuficiente" });
        }

        const txId = `0x${crypto.randomBytes(16).toString('hex')}`;

        
        await walLog(txId, { type: "DEPLOY", from, contractName, nonce }, {
            balances: { [from]: (L3_STATE.balances[from] || 0) - DEPLOY_FEE },
            nonces:   { [from]: (L3_STATE.nonces[from] || 0) + 1 }
        });

        L3_STATE.balances[from] -= DEPLOY_FEE;
        L3_STATE.contracts[contractName] = { owner: from, code: leoCode };
        await saveStateToDB();
        
        const { sandboxDir, aleoFilePath } = await prepareSandbox(contractName, leoCode);
        if (!fs.existsSync(aleoFilePath)) {
            console.log(`[COMPILADOR] Compilando contrato ${contractName} (async)...`);
        
            try {
                await execFileAsync('leo', ['build'], { cwd: sandboxDir });
            } catch (buildErr: any) {
                console.error(`[COMPILADOR] leo build falhou para ${contractName}:`, buildErr.stderr || buildErr.message);
                
                delete L3_STATE.contracts[contractName];
                L3_STATE.balances[from] = (L3_STATE.balances[from] || 0) + DEPLOY_FEE;
                await saveStateToDB();
                return res.json({ jsonrpc: "2.0", id, error: `Erro de compilacao Leo: ${(buildErr.stderr || buildErr.message).substring(0, 200)}` });
            }
        }

        L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
        updateNonces(L3_STATE.nonces);
        await walComplete(txId);

        const newTx = {
            txId,
            type: "DEPLOY",
            contract: contractName,
            nonce,
            signature,
            proof: "NO_PROOF",
            timestamp: Date.now()
        };
        mempool.push(newTx);
        broadcast({ type: "TX", tx: newTx });
        console.log(` Deploy de Contrato: '${contractName}' publicado na L3 (nonce ${nonce})`);
        return res.json({ jsonrpc: "2.0", id, result: txId });
    }


    if (method === 'woo_requestWithdraw') {
        const { address, amount, signature, nonce } = params[0];
        const fee = 15000; 
        
        
        try {
            const senderAddress = Address.from_string(address);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(`${address}:${amount}:WITHDRAW:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida");
            
            const expectedNonce = L3_STATE.nonces[address] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: "Nonce inválido." });
        } catch (err) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura inválida para saque!" });
        }

        
        const balance = L3_STATE.balances[address] || 0;
        if (balance < amount) {
            return res.json({ jsonrpc: "2.0", id, error: "Saldo L3 insuficiente para saque" });
        }
        if (amount <= fee) {
            return res.json({ jsonrpc: "2.0", id, error: `Valor de saque deve ser maior que a taxa (${fee})` });
        }

        
        L3_STATE.balances[address] -= amount;
        L3_STATE.nonces[address] = (L3_STATE.nonces[address] || 0) + 1;
        await saveStateToDB();
        updateNonces(L3_STATE.nonces);

        
        await pgClient.query(
            "INSERT INTO withdrawals (address, amount, fee, status) VALUES ($1, $2, $3, $4)",
            [address, amount, fee, 'READY_FOR_DISPATCH']
        );

        console.log(`FILA DE SAQUE ${amount} u64 adicionados à fila para ${address.substring(0,8)}`);
        
        return res.json({ 
            jsonrpc: "2.0", 
            id, 
            result: { 
                status: "processing", 
                message: "Seu saque entrou na fila de processamento",
                amount_requested: amount,
                fee_applied: fee,
                net_amount_to_receive: amount - fee
            } 
        });
    }
    return res.status(404).json({ jsonrpc: "2.0", id, error: "Method not found" });
});



app.get('/batch/:id', async (req: Request, res: Response) => {
    try {
        const batchId = parseInt(req.params.id);
        if (isNaN(batchId)) {
            return res.status(400).json({ error: "ID de lote inválido" });
        }

       
        const proofsJson = await db.get(`batch_proofs:${batchId}`).catch(() => null);
        
        if (!proofsJson) {
            return res.status(404).json({ error: "Lote não encontrado" });
        }

        const proofsList = JSON.parse(proofsJson);
        
        return res.json({
            batch_id: batchId,
            transactions_count: proofsList.length,
            proofs: proofsList,
            merkle_computation_hint: "Use aggregateProofsFromList(proofs) para verificar o txsHash submetido na L1"
        });

    } catch (error: any) {
        return res.status(500).json({ error: "Erro ao consultar Data Availability", details: error.message });
    }
});

app.get('/health', (req, res) => res.json({
    node_id: MY_ID,
    current_batch: currentBatchId,
    mempool_size: mempool.length,
    last_l1_commit: lastCommitTimestamp,
    peers_connected: getPeerCount(), 
    state_root: generateStateRoot()
}));

app.get('/explorer/recent-batches', async (req: Request, res: Response) => {
    try {
        
        const resDb = await pgClient.query(`SELECT * FROM batch_history ORDER BY batch_id DESC LIMIT 10`);
        const batches = resDb.rows.map(row => ({
            id: Number(row.batch_id),
            state_root: row.state_root,
            txs_hash: row.txs_hash,
            tx_count: row.tx_count,
            timestamp: Number(row.timestamp),
            transactions: row.transactions
        }));
        res.json(batches);
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar lotes" });
    }
});


app.get('/explorer/mempool', (req: Request, res: Response) => {
    
    const currentMempool = (global as any).mempool || [];
    res.json(currentMempool.slice(0, 20));
});


async function startL1Indexer() {
    console.log(`\n [INDEXER] Iniciando escuta da ponte no contrato ${L3_FOLDER_NAME}.aleo...`);

    setInterval(async () => {
        try {
            
            const callsUrl = `${ENDPOINT}/${NETWORK}/programs/${L3_FOLDER_NAME}.aleo/latest-calls`;
            
            const callsResp = await fetch(callsUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!callsResp.ok) return; 

            const callsData: any = await callsResp.json();
            
            
            const calls = Array.isArray(callsData) ? callsData : (callsData?.result || []);

            for (const call of calls) {
                
                const txId = call.transaction_id;
                const functionName = call.function_id;

                if (!txId) continue;

                
                if (functionName === "bridge_in" || functionName?.includes("bridge_in")) {
                    
                    
                    const isProcessed = await db.get(`processed_tx:${txId}`).catch(() => null);
                    if (isProcessed) continue;

                    
                    
                    const txUrl = `${ENDPOINT}/${NETWORK}/transaction/${txId}`;
                    const txResp = await fetch(txUrl, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' }
                    });

                    if (!txResp.ok) continue;

                    const txData: any = await txResp.json();
                    
                    
                    const execution = txData.execution || txData.transaction?.execution;

                    if (execution && execution.transitions) {
                        for (const transition of execution.transitions) {
                            
                            
                            if (transition.function === "bridge_in") {
                                
                                
                                const amountRaw = transition.inputs[2]?.value; 
                                const receiverRaw = transition.inputs[3]?.value;
                                const vaultRaw = transition.inputs[4]?.value;

                                if (amountRaw && receiverRaw && vaultRaw) {
                                    const vaultAddress = vaultRaw.toString().split('.')[0].trim();

                                    
                                    if (vaultAddress !== VAULT_ADDRESS) {
                                        console.log(`Depósito ignorado.: ${vaultAddress}`);
                                        continue; 
                                    }
                                    
                                    const amount = parseInt(
                                        amountRaw.toString()
                                            .replace('u64', '')
                                            .replace('.public', '')
                                            .replace('.private', '')
                                            .trim()
                                    );
                                    
                                    const receiver = receiverRaw.toString().split('.')[0].trim();

                                    console.log(`\n [BRIDGE IN] Depósito detectado na L1!`);
                                    console.log(` Tx: ${txId}`);
                                    console.log(` Valor: ${amount} | Para: ${receiver}`);
                                    
                                    
                                    if (!L3_STATE.tokenBalances[WALEO_CONTRACT_ID]) {
                                        L3_STATE.tokenBalances[WALEO_CONTRACT_ID] = {};
                                    }
                                    
                                    
                                    L3_STATE.tokenBalances[WALEO_CONTRACT_ID][receiver] = 
                                        (L3_STATE.tokenBalances[WALEO_CONTRACT_ID][receiver] || 0) + amount;
                                    
                                    
                                    if (L3_STATE.contracts[WALEO_CONTRACT_ID]) {
                                        L3_STATE.contracts[WALEO_CONTRACT_ID].totalSupply = 
                                            (L3_STATE.contracts[WALEO_CONTRACT_ID].totalSupply || 0) + amount;
                                    }

                                   
                                    await db.put(`processed_tx:${txId}`, "true");
                                    await saveStateToDB();

                                    console.log(`🪙  [MINT SUCESSO] +${amount} ${WALEO_CONTRACT_ID} para ${receiver.substring(0,10)}...`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            
            if (error.message !== 'fetch failed' && !error.message.includes('ECONNREFUSED')) {
                console.log(" [INDEXER ERROR]:", error.message);
            }
        }
    }, 15000); 
}



let isProcessingBatch = false; 

setInterval(async () => {
    if (mempool.length === 0) return;
    
    
    if (isProcessingBatch) {
        console.log(` [SEQUENCER] A L1 ainda está processando o lote anterior. Aguardando...`);
        return;
    }

    
    isProcessingBatch = true;

    
    if (!currentNetworkStateRecord) {
        console.error("[SEQUENCER] NetworkState não disponível. Execute spawn_chain primeiro.");
        isProcessingBatch = false; 
        return;
    }

    const leader = getLeader(currentBatchId);
    if (leader !== MY_ID) {
        console.log(`\n [RODADA #${currentBatchId}] Líder: '${leader}'. Aguardando...`);
        isProcessingBatch = false;
        return;
    }

    console.log(`\n [RODADA #${currentBatchId}] SOU O LÍDER! Processando ${mempool.length} transações...`);

    const realStateRoot = generateStateRoot();
    const { aggregatedProof, proofsList } = aggregateProofs(mempool);
    const { merkleRoot } = aggregateProofsFromList(proofsList);
    const txsHash = aggregatedProof;

    
    if (proofsList.length > 0) {
        for (const tx of mempool) {
            if (tx.proof && tx.proof !== "NO_PROOF") {
                try {
                   
                    const rawPath = path.join(process.cwd(), 'sandbox', L3_FOLDER_NAME, tx.contract?.replace('.aleo','') || '', 'build', 'main.aleo');
                    const safePath = rawPath.replace(/\\/g, '/');

                    const verifyRes = await fetch(`${ZK_PROVER_URL}/verify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            aleo_file_path: safePath,
                            function_name: tx.function || 'somar',
                            proof: tx.proof,
                            inputs: tx.inputs || []
                        })
                    });
                    
                    if (!verifyRes.ok) throw new Error("Falha na comunicação com o Rust");
                    
                    const verifyData = await verifyRes.json() as any;
                    if (!verifyData.valid) throw new Error(`Prova matemática inválida na TX: ${tx.txId}`);
                } catch (err: any) {
                    console.error(` [SEQUENCER] Fraude (ou erro de leitura) detectada. Limpando mempool. Erro: ${err.message}`);
                    mempool = [];
                    
                    isProcessingBatch = false; 
                    return;
                }
            }
        }
    }

    const projectDir = path.join(process.cwd(), 'templates', L3_FOLDER_NAME);

    try {
        console.log(` [SEQUENCER] Enviando Lote #${currentBatchId} para a L1...`);
    
        await execFileAsync('leo', ['build'], { cwd: projectDir });

        const cleanRecord = currentNetworkStateRecord.replace(/\s+/g, '');
        
       
        const chainId = `${process.env.DEFAULT_CHAIN_ID || '1988'}u64`;
        
       
        const leoArgs = [
            'execute', '-y', 'commit_rollup',
            cleanRecord, chainId, `${currentBatchId}u64`, realStateRoot, txsHash,
            '--broadcast', '--network', NETWORK, '--endpoint', ENDPOINT
        ];

        const { stdout: cliOutput } = await execFileAsync('leo', leoArgs, { 
            cwd: projectDir, 
            env: { ...process.env, PRIVATE_KEY: PRIVATE_KEY } 
        });

        console.log(` [SEQUENCER] Lote #${currentBatchId} CONFIRMADO na Aleo!`);

        if (merkleRoot !== "0field" && proofsList.length > 0) {
            await db.put(`batch_proofs:${currentBatchId}`, JSON.stringify(proofsList));
        }

        const recordMatch = cliOutput.match(/{\s*owner:[\s\S]*?_version:[\s\S]*?}/);
        if (recordMatch) {
            let newRecord = recordMatch[0].replace(/\n/g, '').replace(/\s+/g, '');
            currentNetworkStateRecord = newRecord;
            await db.put('network_record', currentNetworkStateRecord);
        } else {
            console.error(`Regex falhou ao parsear output do CLI. Output: ${cliOutput.substring(0, 300)}`);
            isProcessingBatch = false;
            return; 
        }

        
        const batchRecord = {
            state_root: realStateRoot,
            txs_hash: txsHash,
            tx_count: mempool.length,
            timestamp: Date.now(),
            transactions: mempool.map(tx => ({
                txId: tx.txId,
                type: tx.type,
                from: tx.from,
                to: tx.to || tx.contract
            }))
        };
        const history = await db.get('batch_history').catch(() => ({}));
        history[currentBatchId] = batchRecord;
        await db.put('batch_history', history);

        lastCommitTimestamp = Date.now();

        mempool = [];
        currentBatchId++;
        await db.put('batch_id', currentBatchId);
        console.log(`Estado local atualizado para Lote #${currentBatchId}`);

    } catch (error: any) {
        const cliError = error.stderr ? error.stderr.toString() : (error.stdout ? error.stdout.toString() : error.message);
        console.log(` [L1 REJECTED]: O lote #${currentBatchId} falhou na blockchain.`);
        console.log(` Motivo: ${cliError.substring(0, 200)}...`);
        console.log(`Tentaremos novamente no próximo ciclo com o MESMO ID.`);
    } finally {
        
        isProcessingBatch = false;
    }
}, SEQUENCER_INTERVAL_MS);


let isDispatching = false;

setInterval(async () => {
    
    if (MY_ID !== SEQUENCERS[0] || isDispatching) return; 
    isDispatching = true;

    try {
        
        const pendingWithdraws = await pgClient.query(`
            UPDATE withdrawals 
            SET status = 'PROCESSING' 
            WHERE id IN (
                SELECT id FROM withdrawals 
                WHERE status = 'READY_FOR_DISPATCH' 
                LIMIT 3 FOR UPDATE SKIP LOCKED
            )
            RETURNING *;
        `);

        if (pendingWithdraws.rows.length > 0) {
            console.log(`\n [DISPATCHER] Encontrou ${pendingWithdraws.rows.length} saques na fila. Iniciando envios...`);
        }

        const projectDir = path.join(process.cwd(), 'templates', L3_FOLDER_NAME);

        for (const tx of pendingWithdraws.rows) {
            console.log(`   Processando saque ID ${tx.id} para ${tx.address.substring(0,8)}...`);
            
            try {
                
                const chainId = `${process.env.DEFAULT_CHAIN_ID || '1988'}u64`;
                const tokenId = `0u64`; 
                const amountU64 = `${tx.amount}u64`;
                const feeU64 = `${tx.fee}u64`;
                const userAddress = tx.address;

                
                const leoArgs = [
                    'execute', '-y', 'bridge_out',
                    chainId, tokenId, amountU64, feeU64, userAddress,
                    '--broadcast', '--network', NETWORK, '--endpoint', ENDPOINT
                ];
                const { stdout: cliOutput } = await execFileAsync('leo', leoArgs, { 
                    cwd: projectDir, 
                    env: { ...process.env, PRIVATE_KEY: PRIVATE_KEY } 
                });
                
                
                const match = cliOutput.match(/at1[a-zA-Z0-9]{58}/); 
                const aleoTxId = match ? match[0] : "TX_CONFIRMADA_ID_DESCONHECIDO";

                
                await pgClient.query(
                    "UPDATE withdrawals SET status = 'COMPLETED', l1_tx_id = $1 WHERE id = $2",
                    [aleoTxId, tx.id]
                );
                console.log(`    Saque ID ${tx.id} CONCLUIDO! L1 TxID: ${aleoTxId}`);

            } catch (e: any) {
                const erroOutput = e.stderr ? e.stderr.toString() : e.message;
                console.error(`    Falha ao despachar saque ID ${tx.id}. Motivo:`, erroOutput.substring(0, 150));
                
                
                await pgClient.query("UPDATE withdrawals SET status = 'FAILED' WHERE id = $1", [tx.id]);
            }
        }
    } catch (err) {
        console.error("Erro no Loop do Dispatcher:", err);
    } finally {
        isDispatching = false;
    }
}, 70000); 



setInterval(async () => {
    if (MY_ID !== SEQUENCERS[0]) return; 
    try {
        const res = await pgClient.query(`
            UPDATE withdrawals 
            SET status = 'READY_FOR_DISPATCH' 
            WHERE status = 'PROCESSING' 
            AND created_at < NOW() - INTERVAL '5 minutes'
        `);
        if (res.rowCount && res.rowCount > 0) {
            console.log(` ${res.rowCount} saques travados foram devolvidos para a fila de envio.`);
        }
    } catch (e) {
        console.error("Erro na recuperação de saques:", e);
    }
}, 5 * 60 * 1000); 

async function startNode() {
    try {
        console.log(" Conectando e verificando tabelas do banco de dados...");
        
        
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB
            );
            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                address VARCHAR(255),
                amount BIGINT,
                fee BIGINT,
                status VARCHAR(50),
                l1_tx_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS batch_history (
                batch_id BIGINT PRIMARY KEY,
                state_root VARCHAR(255),
                txs_hash VARCHAR(255),
                tx_count INT,
                timestamp BIGINT,
                transactions JSONB
            );
            CREATE TABLE IF NOT EXISTS wal_log (
                id SERIAL PRIMARY KEY,
                tx_id VARCHAR(255) UNIQUE NOT NULL,
                tx_data JSONB NOT NULL,
                state_snapshot JSONB NOT NULL,
                applied BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log(" Tabelas de Dados e Fila de Saques prontas.");

        
        const res = await pgClient.query(`SELECT * FROM wal_log WHERE applied = FALSE ORDER BY id ASC`);
        if (res.rows.length > 0) {
            console.warn(`[WAL] Recuperando ${res.rows.length} TX(s) nao aplicadas apos crash...`);
            for (const row of res.rows) {
                try {
                    const snap = row.state_snapshot;
                    if (snap.balances)      Object.assign(L3_STATE.balances, snap.balances);
                    if (snap.tokenBalances) Object.assign(L3_STATE.tokenBalances, snap.tokenBalances);
                    if (snap.nonces)        Object.assign(L3_STATE.nonces, snap.nonces);
                    await pgClient.query(`UPDATE wal_log SET applied = TRUE WHERE id = $1`, [row.id]);
                    console.log(`[WAL] TX ${row.tx_id} reaplicada.`);
                } catch (e) {
                    console.error(`[WAL] Falha ao reaplicar TX ${row.tx_id}:`, e.message);
                }
            }
            await saveStateToDB();
            console.log(`[WAL] Recuperacao concluida.`);
        }

        
        await loadStateFromDB();

        
        app.listen(HTTP_PORT, () => {
            console.log(`\n WOO NODE (ID: ${MY_ID}) rodando na porta ${HTTP_PORT}`);
            startP2P(P2P_PORT);
            startL1Indexer();
        });

    } catch (e) {
        console.error("Erro fatal ao iniciar o nó:", e);
        process.exit(1); 
    }
}


startNode();
