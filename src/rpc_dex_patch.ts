import http from 'http';
import crypto from 'crypto';

const ZK_WORKER = process.env.ZK_PROVER_URL || 'http://localhost:3030';


export async function getAleoHash(val1: string, val2: string): Promise<string> {
    const input1 = val1.replace(/field$/i, '').trim() + 'field';
    const input2 = val2.replace(/field$/i, '').replace(/u64$/i, '').trim();

    try {
        const body = JSON.stringify({ input1, input2 });
        const result = await new Promise<string>((resolve, reject) => {
            const req = http.request(
                `${ZK_WORKER}/hash/bhp256`,
                { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => {
                        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${data}`)); return; }
                        try { resolve(JSON.parse(data).hash as string); }
                        catch (e) { reject(new Error(`JSON inválido: ${data}`)); }
                    });
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        return result.endsWith('field') ? result : result + 'field';
    } catch (error: any) {
        console.error(`[HASH ERROR] ${error.message} — inputs: "${input1}" / "${input2}"`);
        
        const raw = crypto.createHash('sha256').update(input1 + ':' + input2).digest('hex');
        const PRIME = BigInt('8444461749428370424248824938781546531375899335154063827935233455917409239041');
        return (BigInt('0x' + raw) % PRIME).toString() + 'field';
    }
}




function bech32ToField(address: string): string {
    // Aleo usa bech32m — decodifica os 5-bit groups para bytes
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const data = address.slice(5); 
    
    const decoded: number[] = [];
    for (const char of data) {
        const val = CHARSET.indexOf(char);
        if (val === -1) throw new Error(`Char inválido: ${char}`);
        decoded.push(val);
    }

    
    let bits = 0, value = 0;
    const bytes: number[] = [];
    for (const d of decoded.slice(0, -6)) { 
        value = (value << 5) | d;
        bits += 5;
        while (bits >= 8) {
            bits -= 8;
            bytes.push((value >> bits) & 0xff);
        }
    }

    
    let result = BigInt(0);
    for (let i = bytes.length - 1; i >= 0; i--) {
        result = (result << BigInt(8)) | BigInt(bytes[i]);
    }

    return result.toString();
}






function fieldToBigInt(field: string): bigint {
    return BigInt(field.replace(/field$/i, '').trim());
}


function canonicalOrder(a: string, b: string): [string, string] {
    return fieldToBigInt(a) < fieldToBigInt(b) ? [a, b] : [b, a];
}

function validateCanonicalOrder(tokenXField: string, tokenYField: string): boolean {
    return fieldToBigInt(tokenXField) < fieldToBigInt(tokenYField);
}


async function getDexBalance(L3_STATE: any, tokenId: string, userAddress: string): Promise<number> {
    const storage = L3_STATE.contracts['woo_dex.aleo']?.storage;
    if (!storage?.balances) return 0;
    const key = await getAleoHash(tokenId, userAddress);
    return storage.balances[key] || 0;
}

async function setDexBalance(L3_STATE: any, from: string, tokenId: string, userAddress: string, value: number) {
    if (!L3_STATE.contracts['woo_dex.aleo']) L3_STATE.contracts['woo_dex.aleo'] = { owner: from, code: '', storage: {} };
    if (!L3_STATE.contracts['woo_dex.aleo'].storage) L3_STATE.contracts['woo_dex.aleo'].storage = {};
    if (!L3_STATE.contracts['woo_dex.aleo'].storage.balances) L3_STATE.contracts['woo_dex.aleo'].storage.balances = {};
    
    const key = await getAleoHash(tokenId, userAddress);
    L3_STATE.contracts['woo_dex.aleo'].storage.balances[key] = value;

    if (!L3_STATE.contracts['woo_dex.aleo'].storage.simple_balances) {
        L3_STATE.contracts['woo_dex.aleo'].storage.simple_balances = {};
    }
    
    
    const tokenStr = L3_STATE.contracts['woo_dex.aleo'].storage.token_registry?.[tokenId] || tokenId;

    if (!L3_STATE.contracts['woo_dex.aleo'].storage.simple_balances[tokenStr]) {
        L3_STATE.contracts['woo_dex.aleo'].storage.simple_balances[tokenStr] = {};
    }
    L3_STATE.contracts['woo_dex.aleo'].storage.simple_balances[tokenStr][userAddress] = value;
}


function getDexPool(L3_STATE: any, pairKey: string): any {
    return L3_STATE.contracts['woo_dex.aleo']?.storage?.pools?.[pairKey] || null;
}

async function setDexPool(L3_STATE: any, from: string, pairKey: string, pool: any) {
    if (!L3_STATE.contracts['woo_dex.aleo'].storage.pools) L3_STATE.contracts['woo_dex.aleo'].storage.pools = {};
    L3_STATE.contracts['woo_dex.aleo'].storage.pools[pairKey] = pool;
}

async function getDexLpShares(L3_STATE: any, pairKey: string, userAddress: string): Promise<number> {
    
    const storage = L3_STATE.contracts['woo_dex.aleo']?.storage;
    if (!storage?.lp_shares) return 0;
    
    const simpleKey = `${pairKey}:${userAddress}`;
    return storage.lp_shares[simpleKey] || 0;
}

async function setDexLpShares(L3_STATE: any, pairKey: string, userAddress: string, value: number) {
    if (!L3_STATE.contracts['woo_dex.aleo'].storage.lp_shares) {
        L3_STATE.contracts['woo_dex.aleo'].storage.lp_shares = {};
    }
    
    const simpleKey = `${pairKey}:${userAddress}`;
    L3_STATE.contracts['woo_dex.aleo'].storage.lp_shares[simpleKey] = value;
}


function ensureProcessedTxsMap(L3_STATE: any) {
    if (!L3_STATE.contracts['woo_dex.aleo']) L3_STATE.contracts['woo_dex.aleo'] = { owner: '', code: '', storage: {} };
    if (!L3_STATE.contracts['woo_dex.aleo'].storage) L3_STATE.contracts['woo_dex.aleo'].storage = {};
    if (!L3_STATE.contracts['woo_dex.aleo'].storage.processedTxs) L3_STATE.contracts['woo_dex.aleo'].storage.processedTxs = {};
}

function isTxProcessed(L3_STATE: any, txHash: string): boolean {
    ensureProcessedTxsMap(L3_STATE);
    return !!L3_STATE.contracts['woo_dex.aleo'].storage.processedTxs[txHash];
}

function markTxProcessed(L3_STATE: any, txHash: string) {
    ensureProcessedTxsMap(L3_STATE);
    L3_STATE.contracts['woo_dex.aleo'].storage.processedTxs[txHash] = Date.now();
}

function makeTxHash(from: string, inputs: string[], functionName: string): string {
    return crypto.createHash('sha256').update(from + functionName + inputs.join('')).digest('hex');
}


export function guardDeposit(L3_STATE: any, from: string, inputs: string[], tokenContractName: string): { ok: boolean; error?: string } {
    const amount = parseInt(inputs[1].replace('u64', '').trim());
    if (!amount || amount <= 0) return { ok: false, error: 'Valor de depósito inválido.' };

    const txHash = makeTxHash(from, inputs, 'deposit');
    if (isTxProcessed(L3_STATE, txHash)) return { ok: false, error: 'Replay detectado.' };

    const realBalance = L3_STATE.tokenBalances[tokenContractName]?.[from] || 0;
    if (realBalance < amount) return { ok: false, error: `Saldo real insuficiente. Tem ${realBalance}, pediu ${amount}.` };

    L3_STATE.tokenBalances[tokenContractName][from] = realBalance - amount;
    markTxProcessed(L3_STATE, txHash);
    return { ok: true };
}

export function guardWithdraw(L3_STATE: any, from: string, inputs: string[], tokenContractName: string): { ok: boolean; error?: string } {
    const amount = parseInt(inputs[1].replace('u64', '').trim());
    if (!amount || amount <= 0) return { ok: false, error: 'Valor de saque inválido.' };

    const txHash = makeTxHash(from, inputs, 'withdraw');
    if (isTxProcessed(L3_STATE, txHash)) {
        console.warn(`[DEX WITHDRAW] Replay detectado!`);
        return { ok: false, error: 'Replay detectado.' };
    }

    if (!L3_STATE.tokenBalances[tokenContractName]) L3_STATE.tokenBalances[tokenContractName] = {};
    L3_STATE.tokenBalances[tokenContractName][from] = (L3_STATE.tokenBalances[tokenContractName][from] || 0) + amount;
    markTxProcessed(L3_STATE, txHash);
    console.log(`[DEX WITHDRAW GUARD] ${from.substring(0, 8)} sacou ${amount} ${tokenContractName}`);
    return { ok: true };
}


export async function applyWooDexStateChange(change: any, from: string, cleanInputs: string[], L3_STATE: any): Promise<any> {
    const funcName: string = change.mapping?.trim() || '';
    const c = 'woo_dex.aleo';

    if (!L3_STATE.contracts[c]) L3_STATE.contracts[c] = { owner: from, code: '', storage: {} };
    if (!L3_STATE.contracts[c].storage) L3_STATE.contracts[c].storage = {};

    
    if (funcName === 'deposit') {
        const tokenIdField = cleanInputs[0];
        const amount = parseInt(cleanInputs[1]);
        const tokenContractName = cleanInputs[2] || '';
        if (tokenContractName) {
            if (!L3_STATE.contracts[c].storage.token_registry) L3_STATE.contracts[c].storage.token_registry = {};
            L3_STATE.contracts[c].storage.token_registry[tokenIdField] = tokenContractName;
        }
        const currentBal = await getDexBalance(L3_STATE, tokenIdField, from);
        await setDexBalance(L3_STATE, from, tokenIdField, from, currentBal + amount);
        console.log(`[DEX STATE] deposit REALIZADO: ${amount} de ${tokenContractName} para ${from.substring(0, 8)}`);
        return { action: 'deposit', token: tokenContractName || tokenIdField, amount, user: from };
    }

    
    if (funcName === 'withdraw') {
        const tokenIdField = cleanInputs[0];
        const amount = parseInt(cleanInputs[1]);
        const tokenContractName = cleanInputs[2] || '';
        const currentBal = await getDexBalance(L3_STATE, tokenIdField, from);
        if (currentBal < amount) { console.log(`[DEX REJECTED] saque: saldo insuficiente`); return {}; }
        await setDexBalance(L3_STATE, from, tokenIdField, from, currentBal - amount);
        console.log(`[DEX STATE] withdraw REALIZADO: ${amount} de ${tokenContractName} para ${from.substring(0, 8)}`);
        return { action: 'withdraw', token: tokenContractName || tokenIdField, amount, user: from };
    }

    /
    if (funcName === 'swap_x_for_y') {
        
        const rawIn  = cleanInputs[0];
        const rawOut = cleanInputs[1];
        const amountIn = parseInt(cleanInputs[2]);

        
        const [tokenXField, tokenYField] = canonicalOrder(rawIn, rawOut);
        const pairKey = `${tokenXField}:${tokenYField}`;

        const pool = getDexPool(L3_STATE, pairKey);
        if (!pool) {
            console.log(`[DEX REJECTED] swap_x_for_y: pool não encontrada. Procurado: ${pairKey}`);
            console.log(`[DEX DEBUG] Pools:`, Object.keys(L3_STATE.contracts[c]?.storage?.pools || {}));
            return {};
        }

        
        const inIsX   = rawIn === tokenXField;
        const resIn   = inIsX ? pool.reserve_x : pool.reserve_y;
        const resOut  = inIsX ? pool.reserve_y : pool.reserve_x;

        const userBalIn = await getDexBalance(L3_STATE, rawIn, from);
        if (userBalIn < amountIn) {
            console.log(`[DEX REJECTED] swap_x_for_y: saldo insuficiente (tem ${userBalIn}, pediu ${amountIn})`);
            return {};
        }

        const fee = 0.997;
        const amountOut = Math.floor((resOut * amountIn * fee) / (resIn + amountIn * fee));

        await setDexBalance(L3_STATE, from, rawIn,  from, userBalIn - amountIn);
        const userBalOut = await getDexBalance(L3_STATE, rawOut, from);
        await setDexBalance(L3_STATE, from, rawOut, from, userBalOut + amountOut);

        if (inIsX) { pool.reserve_x += amountIn; pool.reserve_y -= amountOut; }
        else        { pool.reserve_y += amountIn; pool.reserve_x -= amountOut; }
        await setDexPool(L3_STATE, from, pairKey, pool);

        console.log(`[DEX STATE] swap_x_for_y: ${amountIn} in → ${amountOut} out | pool ${pairKey.substring(0, 20)}...`);
        return { action: 'swap', direction: 'x_for_y', amount_in: amountIn, amount_out: amountOut };
    }

    
    if (funcName === 'swap_y_for_x') {
        const rawIn  = cleanInputs[1]; 
        const rawOut = cleanInputs[0];
        const amountIn = parseInt(cleanInputs[2]);

        const [tokenXField, tokenYField] = canonicalOrder(cleanInputs[0], cleanInputs[1]);
        const pairKey = `${tokenXField}:${tokenYField}`;

        const pool = getDexPool(L3_STATE, pairKey);
        if (!pool) {
            console.log(`[DEX REJECTED] swap_y_for_x: pool não encontrada. Procurado: ${pairKey}`);
            console.log(`[DEX DEBUG] Pools:`, Object.keys(L3_STATE.contracts[c]?.storage?.pools || {}));
            return {};
        }

        const inIsY   = rawIn === tokenYField;
        const resIn   = inIsY ? pool.reserve_y : pool.reserve_x;
        const resOut  = inIsY ? pool.reserve_x : pool.reserve_y;

        const userBalIn = await getDexBalance(L3_STATE, rawIn, from);
        if (userBalIn < amountIn) {
            console.log(`[DEX REJECTED] swap_y_for_x: saldo insuficiente (tem ${userBalIn}, pediu ${amountIn})`);
            return {};
        }

        const fee = 0.997;
        const amountOut = Math.floor((resOut * amountIn * fee) / (resIn + amountIn * fee));

        await setDexBalance(L3_STATE, from, rawIn,  from, userBalIn - amountIn);
        const userBalOut = await getDexBalance(L3_STATE, rawOut, from);
        await setDexBalance(L3_STATE, from, rawOut, from, userBalOut + amountOut);

        if (inIsY) { pool.reserve_y += amountIn; pool.reserve_x -= amountOut; }
        else        { pool.reserve_x += amountIn; pool.reserve_y -= amountOut; }
        await setDexPool(L3_STATE, from, pairKey, pool);

        console.log(`[DEX STATE] swap_y_for_x: ${amountIn} in → ${amountOut} out | pool ${pairKey.substring(0, 20)}...`);
        return { action: 'swap', direction: 'y_for_x', amount_in: amountIn, amount_out: amountOut };
    }

    
    if (funcName === 'add_liquidity') {
    const [tokenXField, tokenYField] = canonicalOrder(cleanInputs[0], cleanInputs[1]);
    const amountXDes = parseInt(cleanInputs[2]);
    const amountYDes = parseInt(cleanInputs[3]);
    const pairKey = `${tokenXField}:${tokenYField}`;

    console.log(`[ADD_LIQ DEBUG] tokenX: ${tokenXField.substring(0,10)}... tokenY: ${tokenYField.substring(0,10)}...`);
    console.log(`[ADD_LIQ DEBUG] pairKey: ${pairKey}`);
    console.log(`[ADD_LIQ DEBUG] amountX: ${amountXDes}, amountY: ${amountYDes}`);

    const pool = getDexPool(L3_STATE, pairKey);
    if (!pool) {
        console.log(`[DEX REJECTED] add_liquidity: pool não encontrada (${pairKey})`);
        console.log(`[ADD_LIQ DEBUG] Pools existentes:`, Object.keys(L3_STATE.contracts['woo_dex.aleo']?.storage?.pools || {}));
        return {};
    }

    
    const userBalX = await getDexBalance(L3_STATE, tokenXField, from);
    const userBalY = await getDexBalance(L3_STATE, tokenYField, from);

    console.log(`[ADD_LIQ DEBUG] saldoX DEX: ${userBalX}, saldoY DEX: ${userBalY}`);
    console.log(`[ADD_LIQ DEBUG] reserveX: ${pool.reserve_x}, reserveY: ${pool.reserve_y}, total_shares: ${pool.total_shares}`);

    if (userBalX < amountXDes || userBalY < amountYDes) {
        console.log(`[DEX REJECTED] add_liquidity: saldo DEX insuficiente`);
        return {};
    }

    
    const totalShares = pool.total_shares || 1;
    const lpFromX = Math.floor((amountXDes * totalShares) / pool.reserve_x);
    const lpFromY = Math.floor((amountYDes * totalShares) / pool.reserve_y);
    const lpMinted = Math.min(lpFromX, lpFromY);

    console.log(`[ADD_LIQ DEBUG] lpFromX: ${lpFromX}, lpFromY: ${lpFromY}, lpMinted: ${lpMinted}`);

    if (lpMinted <= 0) {
        console.log(`[DEX REJECTED] add_liquidity: LP calculado = 0 (amounts muito pequenos relativos à pool)`);
        return {};
    }

    await setDexBalance(L3_STATE, from, tokenXField, from, userBalX - amountXDes);
    await setDexBalance(L3_STATE, from, tokenYField, from, userBalY - amountYDes);

    pool.reserve_x    += amountXDes;
    pool.reserve_y    += amountYDes;
    pool.total_shares  = totalShares + lpMinted;
    await setDexPool(L3_STATE, from, pairKey, pool);

    const currentLp = await getDexLpShares(L3_STATE, pairKey, from);
    await setDexLpShares(L3_STATE, pairKey, from, currentLp + lpMinted);

    console.log(`[DEX STATE] add_liquidity OK: ${amountXDes} X + ${amountYDes} Y → ${lpMinted} LP`);
    return { action: 'add_liquidity', pool: pairKey, amount_x: amountXDes, amount_y: amountYDes, lp_minted: lpMinted };
}

    
    if (funcName === 'remove_liquidity') {
        const [tokenXField, tokenYField] = canonicalOrder(cleanInputs[0], cleanInputs[1]);
        const shares  = parseInt(cleanInputs[2]);
        const pairKey = `${tokenXField}:${tokenYField}`;

        const pool = getDexPool(L3_STATE, pairKey);
        if (!pool) {
            console.log(`[DEX REJECTED] remove_liquidity: pool não encontrada (${pairKey})`);
            console.log(`[DEX DEBUG] Pools:`, Object.keys(L3_STATE.contracts[c]?.storage?.pools || {}));
            return {};
        }

        const callerShares = await getDexLpShares(L3_STATE, pairKey, from);
        if (callerShares < shares) {
            console.log(`[DEX REJECTED] remove_liquidity: shares insuficientes (tem ${callerShares}, pediu ${shares})`);
            return {};
        }

        const totalShares = pool.total_shares || 1;
        const amountX = Math.floor((pool.reserve_x * shares) / totalShares);
        const amountY = Math.floor((pool.reserve_y * shares) / totalShares);

        const balX = await getDexBalance(L3_STATE, tokenXField, from);
        const balY = await getDexBalance(L3_STATE, tokenYField, from);
        await setDexBalance(L3_STATE, from, tokenXField, from, balX + amountX);
        await setDexBalance(L3_STATE, from, tokenYField, from, balY + amountY);

        pool.reserve_x    -= amountX;
        pool.reserve_y    -= amountY;
        pool.total_shares  = (pool.total_shares || 0) - shares;
        await setDexPool(L3_STATE, from, pairKey, pool);
        await setDexLpShares(L3_STATE, pairKey, from, callerShares - shares);

        console.log(`[DEX STATE] remove_liquidity OK: ${shares} LP → ${amountX} X + ${amountY} Y`);
        return { action: 'remove_liquidity', pool: pairKey, shares_burned: shares, amount_x: amountX, amount_y: amountY };
    }

    
    if (funcName === 'initialize_pool') {
        const [tokenXField, tokenYField] = canonicalOrder(cleanInputs[0], cleanInputs[1]);
        const amountX = parseInt(cleanInputs[2]);
        const amountY = parseInt(cleanInputs[3]);
        const pairKey = `${tokenXField}:${tokenYField}`;

        const allBalances = L3_STATE.contracts[c]?.storage?.balances || {};
        console.log('[POOL DEBUG] Keys de saldo:', Object.keys(allBalances).length, 'entradas');
        console.log('[POOL DEBUG] tokenX:', tokenXField, '| tokenY:', tokenYField);

        if (getDexPool(L3_STATE, pairKey)) {
            console.log(`[DEX REJECTED] initialize_pool: pool já existe (${pairKey})`);
            return {};
        }

        const userBalX = await getDexBalance(L3_STATE, tokenXField, from);
        const userBalY = await getDexBalance(L3_STATE, tokenYField, from);
        console.log(`[POOL DEBUG] saldoX: ${userBalX} (precisa ${amountX}) | saldoY: ${userBalY} (precisa ${amountY})`);

        if (userBalX < amountX || userBalY < amountY) {
            console.log(`[DEX REJECTED] initialize_pool: saldo insuficiente`);
            return {};
        }

        await setDexBalance(L3_STATE, from, tokenXField, from, userBalX - amountX);
        await setDexBalance(L3_STATE, from, tokenYField, from, userBalY - amountY);

        
        const lpTotal = Math.floor(Math.sqrt(amountX * amountY));
        const lpToCaller = Math.max(lpTotal - 1000, 0); 
        await setDexPool(L3_STATE, from, pairKey, {
            reserve_x:    amountX,
            reserve_y:    amountY,
            total_shares: lpTotal,
            token_x:      tokenXField,
            token_y:      tokenYField,
            nameX:        cleanInputs[4] || tokenXField,
            nameY:        cleanInputs[5] || tokenYField,
        });

        
        if (lpToCaller > 0) {
            await setDexLpShares(L3_STATE, pairKey, from, lpToCaller);
        }

        console.log(`[DEX STATE] initialize_pool: pool ${pairKey} criada | LP total: ${lpTotal} | LP caller: ${lpToCaller}`);
        return { action: 'initialize_pool', pair: pairKey, amount_x: amountX, amount_y: amountY, lp_total: lpTotal };
    }

    console.log(`[DEX STATE] funcName não reconhecida: "${funcName}"`);
    return {};
}