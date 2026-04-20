import express, { Request, Response } from 'express';
import cors from 'cors';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Level } from 'level';
import { MerkleTree } from 'merkletreejs';
import { Address, Signature } from '@aleohq/sdk';
import axios from 'axios';


import { buildMerkleTree, getProof } from './merkle';
import { startP2P, broadcast, updateNonces } from './p2p';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());


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

if (!PRIVATE_KEY || !L3_FOLDER_NAME || !MY_ID || !ZK_PROVER_URL) {
    throw new Error(" Faltam variáveis no .env");
}


const dbPath = `./db_${L3_FOLDER_NAME}`; 
const db = new Level(dbPath, { valueEncoding: 'json' })

const DEFAULT_SEQUENCER_ADDRESS = process.env.DEFAULT_SEQUENCER_ADDRESS!;

let currentNetworkStateRecord: string;


const INITIAL_GAS_SUPPLY = 1000000; 
const WALEO_CONTRACT_ID = "wanpedleo.aleo"; 

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
(global as any).mempool = mempool;


async function loadStateFromDB() {
    console.log("Carregando estado persistente...");

    try {
        const dbRecord = await db.get('network_record');
        currentNetworkStateRecord = dbRecord;
        console.log("NetworkState carregado.");
    } catch (e) {
        console.warn("Nenhum NetworkState encontrado");
        currentNetworkStateRecord = "";
    }

    try { const dbBalances = await db.get('balances'); if (dbBalances) L3_STATE.balances = dbBalances; } catch (e) { }
    try { const dbTokenBalances = await db.get('tokenBalances'); if (dbTokenBalances) L3_STATE.tokenBalances = dbTokenBalances; } catch (e) { }
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
    
    
    const cleanInputs = originalInputs.map(i => typeof i === 'string' ? i.replace(/u(8|16|32|64|128)/g, '').replace('.public', '').replace('.private', '').trim() : i);

    for (const change of stateChanges) {
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
                    
                    else if (change.contract === 'amm_pair.aleo') {
                        const c = change.contract;
                        const getMap = (map: string, key: string) => L3_STATE.contracts[c]?.storage?.[map]?.[key] || 0;
                        const setMap = (map: string, key: string, val: number) => {
                            ensureContractStorage(c, from);
                            if (!L3_STATE.contracts[c].storage[map]) L3_STATE.contracts[c].storage[map] = {};
                            L3_STATE.contracts[c].storage[map][key] = val;
                        };

                        
                        if (funcName === 'deposit_x' || funcName === 'deposit_y') {
                            const tokenId = cleanInputs[0]; // Pega exato do Input Original
                            const amount = Number(cleanInputs[1]);
                            const internalMap = funcName === 'deposit_x' ? 'balances_x' : 'balances_y';

                            if (!L3_STATE.tokenBalances[tokenId]) L3_STATE.tokenBalances[tokenId] = {};
                            L3_STATE.tokenBalances[tokenId][from] = (L3_STATE.tokenBalances[tokenId][from] || 0) - amount;
                            
                            setMap(internalMap, from, getMap(internalMap, from) + amount);
                            eventData = { action: funcName, token: tokenId, deposited: amount };
                        }
                        
                        
                        else if (funcName === 'withdraw_x' || funcName === 'withdraw_y') {
                            const tokenId = cleanInputs[0];
                            const amount = Number(cleanInputs[1]);
                            const internalMap = funcName === 'withdraw_x' ? 'balances_x' : 'balances_y';

                            const userBalanceInDex = getMap(internalMap, from);
                            if (userBalanceInDex < amount) {
                                console.log(` [DEX REJECTED] Fraude: Usuario tentou sacar sem ter saldo interno!`);
                                break; 
                            }

                            setMap(internalMap, from, userBalanceInDex - amount);
                            
                            if (!L3_STATE.tokenBalances[tokenId]) L3_STATE.tokenBalances[tokenId] = {};
                            L3_STATE.tokenBalances[tokenId][from] = (L3_STATE.tokenBalances[tokenId][from] || 0) + amount;
                            eventData = { action: funcName, token: tokenId, withdrawn: amount };
                        }

                        
                        else if (funcName === 'swap_x_for_y') {
                            const tokenX = cleanInputs[0];
                            const tokenY = cleanInputs[1];
                            const amountXIn = Number(cleanInputs[2]);

                            const userXBalance = getMap('balances_x', from);
                            if (userXBalance < amountXIn) {
                                console.log(` [DEX REJECTED] Fraude: Sem saldo na DEX para Swap!`);
                                break; 
                            }

                            const resX = getMap('reserves_x', tokenX);
                            const resY = getMap('reserves_y', tokenY);
                            const amountXInFee = amountXIn * 997;
                            const amountYOut = Math.floor((amountXInFee * resY) / ((resX * 1000) + amountXInFee));

                            setMap('reserves_x', tokenX, resX + amountXIn);
                            setMap('reserves_y', tokenY, resY - amountYOut);
                            setMap('balances_x', from, userXBalance - amountXIn);
                            setMap('balances_y', from, getMap('balances_y', from) + amountYOut);
                            
                            console.log(`Swap processado: Entrou ${amountXIn} ${tokenX} | Saiu ${amountYOut} ${tokenY}`);
                            eventData = { action: "swap", token_in: tokenX, token_out: tokenY, amount_in: amountXIn, amount_received: amountYOut };
                        }

                        
                        else if (funcName === 'swap_y_for_x') {
                            const tokenX = cleanInputs[0]; 
                            const tokenY = cleanInputs[1]; 
                            const amountYIn = Number(cleanInputs[2]); 
                            
                            const userYBalance = getMap('balances_y', from);
                            if (userYBalance < amountYIn) {
                                console.log(` [DEX REJECTED] Fraudee: Sem saldo na DEX para Swap!`);
                                break; 
                            }

                            const resX = getMap('reserves_x', tokenX);
                            const resY = getMap('reserves_y', tokenY);
                            const amountYInFee = amountYIn * 997;
                            const amountXOut = Math.floor((amountYInFee * resX) / ((resY * 1000) + amountYInFee));

                            setMap('reserves_y', tokenY, resY + amountYIn);
                            setMap('reserves_x', tokenX, resX - amountXOut);
                            setMap('balances_y', from, userYBalance - amountYIn);
                            setMap('balances_x', from, getMap('balances_x', from) + amountXOut);
                            
                            console.log(` processado: Entrou ${amountYIn} ${tokenY} | Saiu ${amountXOut} ${tokenX}`);
                            eventData = { action: "swap", token_in: tokenY, token_out: tokenX, amount_in: amountYIn, amount_received: amountXOut };
                        }

                        
                        else if (funcName === 'add_liquidity') {
                            const tokenX = cleanInputs[0]; 
                            const tokenY = cleanInputs[1]; 
                            const axDes = Number(cleanInputs[2]);
                            const ayDes = Number(cleanInputs[3]);
                            
                            const userXBalance = getMap('balances_x', from);
                            const userYBalance = getMap('balances_y', from);
                            if (userXBalance < axDes || userYBalance < ayDes) {
                                console.log(` Sem saldo para prover Liquidez!`);
                                break; 
                            }

                            const resX = getMap('reserves_x', tokenX);
                            const resY = getMap('reserves_y', tokenY);
                            const totalLp = getMap('total_supply', c);

                            const axOpt = resY === 0 ? 0 : Math.floor((ayDes * resX) / resY);
                            const ayOpt = resX === 0 ? 0 : Math.floor((axDes * resY) / resX);
                            const lpMintX = resX === 0 ? 0 : Math.floor((axOpt * totalLp) / resX);
                            const lpMintY = resY === 0 ? 0 : Math.floor((ayOpt * totalLp) / resY);
                            
                            const lpMintExist = (axOpt <= axDes) ? lpMintX : lpMintY;
                            const lpMinted = totalLp === 0 ? (axDes + ayDes) : lpMintExist;

                            setMap('balances_x', from, userXBalance - axDes);
                            setMap('balances_y', from, userYBalance - ayDes);
                            setMap('reserves_x', tokenX, resX + axDes);
                            setMap('reserves_y', tokenY, resY + ayDes);
                            setMap('total_supply', c, totalLp + lpMinted);
                            setMap('balance_lp', from, getMap('balance_lp', from) + lpMinted);
                            eventData = { action: "add_liquidity", lp_tokens_minted: lpMinted };
                        }
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

   
    if (method === 'defi_getUserPortfolio') {
        const userAddress = params[0];
        if (!userAddress) return res.json({ jsonrpc: "2.0", id, error: "Endereço não fornecido" });

        let portfolio: Record<string, number> = {};

        for (const tokenId in L3_STATE.tokenBalances) {
            const balance = L3_STATE.tokenBalances[tokenId][userAddress];
            if (balance && balance > 0) {
                portfolio[tokenId] = balance;
            }
        }

        const gasBalance = L3_STATE.balances[userAddress];
        if (gasBalance && gasBalance > 0) {
            portfolio["credits.aleo"] = gasBalance;
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
        if (!tokenInfo && tokenId !== "credits.aleo") {
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
        if (token.totalSupply + amount > token.maxSupply) {
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
        const [contractName, mappingName, key] = params;
        const contract = L3_STATE.contracts[contractName];

        if (!contract?.storage?.[mappingName]) {
            return res.json({ jsonrpc: '2.0', id, result: null });
        }

        return res.json({
            jsonrpc: '2.0',
            id,
            result: contract.storage[mappingName][key] ?? null
        });
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
            console.log(`❌ [REJEITADO] Fraude evitada! ${from.substring(0,8)} tentou enviar ${numericAmount}, mas tem ${currentBalance}`);
            return res.json({ jsonrpc: "2.0", id, error: "Saldo insuficiente ou valor inválido" });
        }

        
        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            
            
            const message = new TextEncoder().encode(`${from}:${tokenId}:${to}:${formattedAmount}:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida");

            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce inválido.` });
        } catch (err) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura  inválida!" });
        }

        
        const cleanName = tokenId.replace('.aleo', '').trim();
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
                execSync(`leo new ${cleanName}`, { cwd: chainSandboxRoot });
            }
            if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
            
            
            fs.writeFileSync(path.join(srcDir, 'main.leo'), L3_STATE.contracts[tokenId].code);
            
            if (!fs.existsSync(aleoFilePath)) {
                console.log(`Compilando token no sandbox da rede ${L3_FOLDER_NAME}...`);
                execSync(`leo build`, { cwd: sandboxDir, stdio: 'pipe' });
            }

            console.log(` Solicitando prova de TRANSFERÊNCIA para ${tokenId} via Worker Rust...`);
            const response = await fetch(`${ZK_PROVER_URL}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aleo_file_path: aleoFilePath,
                    function_name: "transfer_public",
                    private_key: PRIVATE_KEY,
                    inputs: inputs,
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
            updateNonces(L3_STATE.nonces);

            
            const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
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

            console.log(` [TRANSFERÊNCIA ] ${numericAmount} de ${from.substring(0,8)} para ${to.substring(0,8)} no token '${tokenId}'`);
            return res.json({ jsonrpc: "2.0", id, result: { txId } });

        } catch (error: any) {
            console.error(`Erro no Worker Rust HTTP (Transfer):`, error.message);
            return res.json({ jsonrpc: "2.0", id, error: "Falha na geração da ZK Proof da Transferência" });
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

        if (L3_STATE.contracts[contractName]) {
            return res.json({ jsonrpc: "2.0", id, error: "Contrato já existe" });
        }

        const senderBalance = L3_STATE.balances[from] ?? 0;
       if (senderBalance < DEPLOY_FEE)

        if (!L3_STATE.balances[from] || L3_STATE.balances[from] < DEPLOY_FEE) {
            return res.json({ jsonrpc: "2.0", id, error: "Gás insuficiente" });
        }

        L3_STATE.balances[from] -= DEPLOY_FEE;
        L3_STATE.contracts[contractName] = { owner: from, code: leoCode };
        await saveStateToDB(); 
        L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
        updateNonces(L3_STATE.nonces);

        const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
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

    
    if (method === 'woo_executeContract') {
        const { from, contractName, functionName, inputs, signature, nonce } = params[0];

        if (!signature || nonce === undefined) {
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura e nonce são obrigatórios." });
        }
        if (!L3_STATE.contracts[contractName]) {
            return res.json({ jsonrpc: "2.0", id, error: "Contrato não encontrado" });
        }

        try {
            const senderAddress = Address.from_string(from);
            const aleoSignature = Signature.from_string(signature);
            const message = new TextEncoder().encode(`${from}:${contractName}:${functionName}:EXECUTE:${nonce}`);
            if (!aleoSignature.verify(senderAddress, message)) throw new Error("Assinatura inválida.");
            const expectedNonce = L3_STATE.nonces[from] || 0;
            if (nonce !== expectedNonce) return res.json({ jsonrpc: "2.0", id, error: `Nonce inválido. Esperado: ${expectedNonce}` });
        } catch (err) {
            console.warn(` [SEGURANÇA] Tentativa de execução inválida de ${from}`);
            return res.json({ jsonrpc: "2.0", id, error: "Assinatura ou Nonce inválidos!" });
        }

        
        if (contractName === 'amm_pair.aleo') {
            const dynamicTokenId = inputs[0];
            const amountVal = parseInt(inputs[1].replace('u64', ''));

            if (functionName === 'deposit_x' || functionName === 'deposit_y') {
                const globalBalance = L3_STATE.tokenBalances[dynamicTokenId]?.[from] || 0;
                if (globalBalance < amountVal) {
                    return res.json({ jsonrpc: "2.0", id, error: `Fraude evitada: Saldo de ${dynamicTokenId} insuficiente na Carteira L3!` });
                }
                
            }
        }
        

        const cleanName = contractName.replace('.aleo', '').trim();
        
        
        const chainSandboxRoot = path.join(process.cwd(), 'sandbox', L3_FOLDER_NAME);
        const sandboxDir = path.join(chainSandboxRoot, cleanName);
        const srcDir = path.join(sandboxDir, 'src');
        const aleoFilePath = path.join(sandboxDir, 'build', 'main.aleo');

        
        if (!fs.existsSync(chainSandboxRoot)) {
            fs.mkdirSync(chainSandboxRoot, { recursive: true });
        }

        try {
            if (!fs.existsSync(sandboxDir)) {
                console.log(` Criando novo sandbox isolado para: ${cleanName} na rede ${L3_FOLDER_NAME}`);
                
                execSync(`leo new ${cleanName}`, { cwd: chainSandboxRoot });
            }
            if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
            
            fs.writeFileSync(path.join(srcDir, 'main.leo'), L3_STATE.contracts[contractName].code);
            
            if (!fs.existsSync(aleoFilePath)) {
                console.log(` Compilando contrato no sandbox da rede ${L3_FOLDER_NAME}...`);
                execSync(`leo build`, { cwd: sandboxDir, stdio: 'pipe' });
            }

            console.log(`[ZK-HTTP] Solicitando prova para ${functionName} via Worker Rust...`);
            const response = await fetch(`${ZK_PROVER_URL}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aleo_file_path: aleoFilePath,
                    function_name: functionName,
                    private_key: PRIVATE_KEY,
                    inputs: inputs,
                })
            });
            if (!response.ok) {
                const errorDetail = await response.text();
                throw new Error(`Worker Rust retornou erro (${response.status}): ${errorDetail}`);
            }
            const parsed = await response.json();

            
            const verifyResp = await fetch(`${ZK_PROVER_URL}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aleo_file_path: aleoFilePath,
                    function_name: functionName,
                    proof: parsed.proof,
                    inputs: inputs,
                })
            });
            const verifyData = await verifyResp.json() as any;
            if (!verifyData.valid) throw new Error("A prova gerada pelo Worker é  inválida!");

            
            let executionResults = {}; 
            if (parsed.state_changes && Array.isArray(parsed.state_changes)) {
                
                executionResults = await applyStateChanges(contractName, from, parsed.state_changes, inputs);
                await saveStateToDB();
            }

            

            const gasBalance = L3_STATE.balances[from] ?? 0;
            if (gasBalance < EXECUTION_FEE) {
                return res.json({ jsonrpc: "2.0", id, error: "Gás insuficiente" });
            }

            
            L3_STATE.balances[from] = (L3_STATE.balances[from] || 0) - EXECUTION_FEE;
            L3_STATE.nonces[from] = (L3_STATE.nonces[from] || 0) + 1;
            await saveStateToDB();
            updateNonces(L3_STATE.nonces);

            
            parsed.execution_results = executionResults;

            const txId = `0x${crypto.randomBytes(16).toString('hex')}`;
            const newTx = {
                txId,
                type: "EXECUTE",
                contract: contractName,
                function: functionName,
                inputs: inputs,
                nonce,
                signature,
                proof: parsed.proof,
                timestamp: Date.now()
            };
            mempool.push(newTx);
            broadcast({ type: "TX", tx: newTx });
            
            console.log(` [ZK-HTTP] Execução concluída. Nonce atualizado para ${L3_STATE.nonces[from]}`);
            
            // O frontend agora vai receber quanto ele tirou no SWAP!
            return res.json({ jsonrpc: "2.0", id, result: parsed });
            
        } catch (error: any) {
            console.error(` Erro no Worker HTTP:`, error.message);
            return res.json({ jsonrpc: "2.0", id, error: "Falha na geração da Prova ZK" });
        }
    }

    if (method === 'woo_getWithdrawProof') {
        const { address } = params[0];
        const { tree } = buildMerkleTree(L3_STATE.balances);
        const balance = L3_STATE.balances[address] || 0;
        const proof = getProof(tree, address, balance);
        console.log(` [MERKLE] Prova de saque  gerada para ${address.substring(0, 8)}...`);
        return res.json({ jsonrpc: "2.0", id, result: { balance, proof } });
    }

    return res.status(404).json({ jsonrpc: "2.0", id, error: "Method not found" });
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

                                    
                                    if (vaultAddress !== DEFAULT_SEQUENCER_ADDRESS) {
                                        console.log(`Depósito ignorado. O usuário enviou para o cofre errado: ${vaultAddress}`);
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
                                    
                                    l
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
        console.log(`\n⏭ [RODADA #${currentBatchId}] Líder: '${leader}'. Aguardando...`);
        isProcessingBatch = false; // Destranca se não for o líder
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
                    const verifyRes = await fetch(`${ZK_PROVER_URL}/verify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            aleo_file_path: path.join(process.cwd(), 'sandbox', L3_FOLDER_NAME, tx.contract?.replace('.aleo','') || '', 'build', 'main.aleo'),
                            function_name: tx.function || 'somar',
                            proof: tx.proof,
                            inputs: tx.inputs || []
                        })
                    });
                    const verifyData = await verifyRes.json() as any;
                    if (!verifyData.valid) throw new Error(`Prova inválida para TX: ${tx.txId}`);
                } catch (err: any) {
                    console.error(` [SEQUENCER] Fraude detectada. Limpando mempool.`);
                    mempool = [];
                    return;
                }
            }
        }
    }

    const projectDir = path.join(process.cwd(), 'templates', L3_FOLDER_NAME);

    try {
        console.log(` [SEQUENCER] Enviando Lote #${currentBatchId} para a L1...`);
        safeExec(`leo build`, projectDir);

        const cleanRecord = currentNetworkStateRecord.replace(/\s+/g, '');
        const command = `leo execute -y commit_rollup "${cleanRecord}" ${currentBatchId}u64 ${realStateRoot} ${txsHash} --broadcast --network ${NETWORK} --endpoint ${ENDPOINT} --private-key ${PRIVATE_KEY}`;

        const cliOutput = execSync(command, { cwd: projectDir, encoding: 'utf-8', shell: true });

        console.log(` [SEQUENCER] Lote #${currentBatchId} CONFIRMADO na Aleo!`);

        if (merkleRoot !== "0field" && proofsList.length > 0) {
            await db.put(`batch_proofs:${currentBatchId}`, JSON.stringify(proofsList));
        }

        const recordMatch = cliOutput.match(/{\s*owner:[\s\S]*?_version:[\s\S]*?}/);
        if (recordMatch) {
            let newRecord = recordMatch[0].replace(/\n/g, '').replace(/\s+/g, '');
            currentNetworkStateRecord = newRecord;
            await db.put('network_record', currentNetworkStateRecord);
        }

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


loadStateFromDB().then(() => {
    app.listen(HTTP_PORT, () => {
        console.log(`\n WOO  NODE (ID: ${MY_ID}) rodando na porta ${HTTP_PORT}`);
        startP2P(P2P_PORT);
        startL1Indexer();
    });
});