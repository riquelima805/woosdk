import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PrivateKey, Address, Signature } from '@aleohq/sdk';
import axios from 'axios';
import './App.css';


const getEnv = (viteKey: string, craKey: string, fallback: string) => {
  try { if (typeof import.meta !== 'undefined' && import.meta.env?.[viteKey]) return import.meta.env[viteKey]; } catch {}
  try { if (typeof process !== 'undefined' && process.env?.[craKey]) return process.env[craKey]; } catch {}
  return fallback;
};

const GAS_SYMBOL         = getEnv('VITE_GAS_SYMBOL',          'REACT_APP_GAS_SYMBOL',          'gas_adla');
const GAS_DECIMALS       = parseInt(getEnv('VITE_GAS_DECIMALS', 'REACT_APP_GAS_DECIMALS',       '0'), 10);
const BRIDGE_TOKEN_ID    = getEnv('VITE_BRIDGE_TOKEN_ID',     'REACT_APP_BRIDGE_TOKEN_ID',     'wanpedleo.aleo');
const BRIDGE_TOKEN_SYM   = getEnv('VITE_BRIDGE_TOKEN_SYMBOL', 'REACT_APP_BRIDGE_TOKEN_SYMBOL', 'wALEO');
const BRIDGE_TOKEN_DEC   = parseInt(getEnv('VITE_BRIDGE_TOKEN_DECIMALS','REACT_APP_BRIDGE_TOKEN_DECIMALS','0'),10);


interface Token { address: string; symbol: string; decimals: number; balance?: string; }
interface NFT   { id: string; name: string; contractId: string; metadata?: string; image?: string; }
interface TxHistory {
  txId: string; type: string; from?: string; to?: string;
  amount?: number | string; contract?: string; timestamp: number;
  status: 'confirmed' | 'pending';
}
interface Pool {
  tokenX: string; tokenY: string; symbolX: string; symbolY: string;
  reserveX: number; reserveY: number; fee: number;
}
interface StoredData {
  rpcUrl: string; privateKey: string; tokens: Token[];
  simulationMode: boolean; txHistory: TxHistory[];
}


const NATIVE_TOKEN: Token = { address: 'native', symbol: GAS_SYMBOL, decimals: GAS_DECIMALS };
const DEFAULT_RPC         = 'http://localhost:8545';
const DEFAULT_PRIVATE_KEY = 'APrivateKey000';
const AMM_CONTRACT        = 'woo_dex.aleo';


const loadStoredData = (): StoredData => {
  const stored = localStorage.getItem('adla_wallet_v13');
  const defaultTokens = [
    NATIVE_TOKEN,
    { address: BRIDGE_TOKEN_ID, symbol: BRIDGE_TOKEN_SYM, decimals: BRIDGE_TOKEN_DEC }
  ];
  if (stored) {
    try {
      const p = JSON.parse(stored);
      if (!p.tokens?.length) p.tokens = defaultTokens;
      else if (!p.tokens.find((t: Token) => t.address === BRIDGE_TOKEN_ID)) p.tokens.push(defaultTokens[1]);
      if (!p.txHistory) p.txHistory = [];
      return p;
    } catch {}
  }
  return { rpcUrl: DEFAULT_RPC, privateKey: DEFAULT_PRIVATE_KEY, tokens: defaultTokens, simulationMode: false, txHistory: [] };
};

const saveStoredData = (data: StoredData) =>
  localStorage.setItem('adla_wallet_v13', JSON.stringify(data));


const formatBalance = (token?: Token): string => {
  if (!token?.balance || token.balance === 'Erro') return '0';
  try {
    const raw = token.balance.toString().trim();
    const val = BigInt(raw.split('.')[0]);
    if (val === 0n) return '0';
    const dec = token.decimals ?? 0;
    if (dec === 0) return val.toString();
    const div = 10n ** BigInt(dec);
    const int = val / div;
    const frac = val % div;
    if (frac === 0n) return int.toString();
    const fs = frac.toString().padStart(dec, '0').replace(/0+$/, '');
    return `${int}.${fs}`;
  } catch { return '0'; }
};

const shortAddr = (addr: string) =>
  addr?.length > 12 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

const timeAgo = (ts: number) => {
  const d = Date.now() - ts;
  if (d < 60000) return 'agora';
  if (d < 3600000) return `${Math.floor(d/60000)}m atrás`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h atrás`;
  return `${Math.floor(d/86400000)}d atrás`;
};

const toU64 = (val: string, decimals: number) =>
  Math.floor(parseFloat(val.replace(',', '.')) * (10 ** decimals));


async function contractNameToFieldAsync(name: string, rpcUrlBase?: string): Promise<string> {
    if (!name || name === 'native') return '0field';
    if (/^\d+field$/.test(name)) return name; 

    const rustUrl = rpcUrlBase 
        ? rpcUrlBase.replace(':8545', ':3030') 
        : 'http://localhost:3030';

    try {
        
        const res = await fetch(`${rustUrl}/hash/bhp256`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                input1: name,    
                input2: '0field' 
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`[FIELD] ${name} → ${data.hash}`);
        return data.hash as string;
    } catch (e) {
        
        console.warn(`[FIELD FALLBACK] Rust offline para "${name}":`, e);
        const msgUint8 = new TextEncoder().encode(name);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        return BigInt('0x' + hashHex.substring(0, 16)).toString() + 'field';
    }
}


const autoSign = (privateKey: string, message: Uint8Array): string => {
  const pk = PrivateKey.from_string(privateKey);
  return pk.sign(message).to_string();
};

const buildMessage = (...parts: (string | number)[]) =>
  new TextEncoder().encode(parts.join(':'));


const App: React.FC = () => {
  const init = loadStoredData();

  
  const [rpcUrl,         setRpcUrl]         = useState(init.rpcUrl);
  const [privateKey,     setPrivateKey]     = useState(init.privateKey);
  const [tokens,         setTokens]         = useState<Token[]>(init.tokens);
  const [simulationMode, setSimulationMode] = useState(init.simulationMode);
  const [txHistory,      setTxHistory]      = useState<TxHistory[]>(init.txHistory);

  const [address,      setAddress]      = useState('');
  const [status,       setStatus]       = useState('✓ Pronto');
  const [statusType,   setStatusType]   = useState<'ok'|'err'|'loading'>('ok');
  const [activeView,   setActiveView]   = useState<'wallet'|'swap'|'pool'|'nft'|'labs'>('wallet');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddToken, setShowAddToken] = useState(false);
  const [showPhrase,   setShowPhrase]   = useState(false);
  const [masterPhrase, setMasterPhrase] = useState('');
  const [showReceive,  setShowReceive]  = useState(false);
  const [copied,       setCopied]       = useState(false);

  
  const [newTokenAddress,  setNewTokenAddress]  = useState('');
  const [newTokenSymbol,   setNewTokenSymbol]   = useState('');
  const [newTokenDecimals, setNewTokenDecimals] = useState('0');

  
  const [selectedToken, setSelectedToken] = useState<Token>(tokens[0] || NATIVE_TOKEN);
  const [toAddress,     setToAddress]     = useState('');
  const [amount,        setAmount]        = useState('');
  const [sendConfirm,   setSendConfirm]   = useState(false);

 
  const [bridgeAmount, setBridgeAmount] = useState('');

  
  const [swapTokenIn,   setSwapTokenIn]   = useState<Token | null>(null);
  const [swapTokenOut,  setSwapTokenOut]  = useState<Token | null>(null);
  const [swapAmountIn,  setSwapAmountIn]  = useState('');
  const [swapAmountOut, setSwapAmountOut] = useState('');
  const [swapImpact,    setSwapImpact]    = useState('');
  const [swapRoute,     setSwapRoute]     = useState('');
  const [slippage,      setSlippage]      = useState('0.5');
  const [showSlippage,  setShowSlippage]  = useState(false);
  const [pools,         setPools]         = useState<Pool[]>([]);
  const [swapConfirm,   setSwapConfirm]   = useState(false);

  
  const [dexBalances, setDexBalances] = useState<Record<string, number>>({});
  
  const [fieldToSymbol, setFieldToSymbol] = useState<Record<string, string>>({});

  
  const [poolView,      setPoolView]      = useState<'list'|'add'|'remove'>('list');
  const [poolTokenX,    setPoolTokenX]    = useState('');
  const [poolTokenY,    setPoolTokenY]    = useState('');
  const [poolAmountX,   setPoolAmountX]   = useState('');
  const [poolAmountY,   setPoolAmountY]   = useState('');
  const [myLPShares,    setMyLPShares]    = useState<Record<string,number>>({});
  const [removeShares,  setRemoveShares]  = useState('');

  
const [vaultTokenId, setVaultTokenId] = useState(BRIDGE_TOKEN_ID);
const [vaultAmount, setVaultAmount]   = useState('');

  
  const [nfts,          setNfts]          = useState<NFT[]>([]);
  const [nftContractId, setNftContractId] = useState('');
  const [nftLoading,    setNftLoading]    = useState(false);

  
  const [programName,   setProgramName]   = useState('token11');
  const [contractCode,  setContractCode]  = useState(`program token11.aleo {
    mapping account: address => u64;
    transition mint_public(receiver: address, amount: u64) {
        return then finalize(receiver, amount);
    }
    finalize mint_public(receiver: address, amount: u64) {
        let current: u64 = Mapping::get_or_use(account, receiver, 0u64);
        Mapping::set(account, receiver, current + amount);
    }
    transition transfer_public(receiver: address, amount: u64) {
        return then finalize(self.caller, receiver, amount);
    }
    finalize transfer_public(sender: address, receiver: address, amount: u64) {
        let sender_balance: u64 = Mapping::get_or_use(account, sender, 0u64);
        assert(sender_balance >= amount);
        Mapping::set(account, sender, sender_balance - amount);
        let receiver_balance: u64 = Mapping::get_or_use(account, receiver, 0u64);
        Mapping::set(account, receiver, receiver_balance + amount);
    }
}`);
  const [callFunction,  setCallFunction]  = useState('mint_public');
  const [callParams,    setCallParams]    = useState('');
  const [mappingName,   setMappingName]   = useState('account');
  const [mappingKey,    setMappingKey]    = useState('');
  const [mappingValue,  setMappingValue]  = useState('');

  const isFetchingRef     = useRef(false);
  const lastFetchTimeRef  = useRef(0);

  
  useEffect(() => {
    try {
      const pk = PrivateKey.from_string(privateKey);
      setAddress(pk.to_address().to_string());
    } catch { setAddress('Chave inválida'); }
  }, [privateKey]);

  useEffect(() => {
    saveStoredData({ rpcUrl, privateKey, tokens, simulationMode, txHistory });
  }, [rpcUrl, privateKey, tokens, simulationMode, txHistory]);

  const setMsg = (msg: string, type: 'ok'|'err'|'loading' = 'ok') => {
    setStatus(msg); setStatusType(type);
  };

  
  const fetchAllBalances = useCallback(async (force = false, currentTokens = tokens) => {
    if (!address || isFetchingRef.current) return;
    const now = Date.now();
    if (!force && now - lastFetchTimeRef.current < 3000) return;
    isFetchingRef.current = true;
    setMsg(' Atualizando saldos...', 'loading');
    try {
      if (simulationMode) {
        setTokens(currentTokens.map(t => ({
          ...t, balance: (Math.random() * 1000 * (10 ** t.decimals)).toFixed(0)
        })));
        setMsg(' Modo simulação ativo');
      } else {
        const updated = await Promise.all(currentTokens.map(async (token) => {
          try {
            const res = await axios.post(rpcUrl, {
              jsonrpc: '2.0',
              method: token.address === 'native' ? 'woo_getBalance' : 'woo_getTokenBalance',
              params: token.address === 'native' ? [address] : [address, token.address],
              id: 1,
            });
            return { ...token, balance: String(res.data.result ?? '0') };
          } catch { return { ...token, balance: 'Erro' }; }
        }));
        setTokens(updated);
        setMsg(' Saldos atualizados');
      }
      lastFetchTimeRef.current = Date.now();
    } catch { setMsg(' Falha ao buscar saldos', 'err'); }
    finally { isFetchingRef.current = false; }
  }, [address, rpcUrl, simulationMode, tokens]);

  useEffect(() => {
    if (address && address !== 'Chave inválida') fetchAllBalances(true);
  }, [address, rpcUrl, simulationMode]);

  
  useEffect(() => {
    if ((activeView === 'pool' || activeView === 'swap') && address && address !== 'Chave inválida') {
      fetchPools();
      fetchDexBalances();
    }
  }, [activeView, address]);


const fetchPools = useCallback(async () => {
    if (simulationMode) { /* ... */ return; }
    try {
        const res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_getPools', params:[], id:1 });
        if (res.data.result) {
            setPools(res.data.result);

            
            
            const fts: Record<string, string> = {};
            for (const pool of res.data.result) {
                for (const field of [pool.tokenX, pool.tokenY]) {
                    if (!field || fts[field]) continue;
                    
                    if (pool.tokenX === field && pool.symbolX) { fts[field] = pool.symbolX; continue; }
                    if (pool.tokenY === field && pool.symbolY) { fts[field] = pool.symbolY; continue; }
                    
                    const matched = tokens.find(t => {
                        if (t.address === 'native') return false;
                        return false; 
                    });
                    if (matched) fts[field] = matched.symbol;
                }
                
                if (pool.symbolX && pool.tokenX) fts[pool.tokenX] = pool.symbolX;
                if (pool.symbolY && pool.tokenY) fts[pool.tokenY] = pool.symbolY;
            }
            
            for (const t of tokens) {
                if (t.address === 'native') continue;
                
                for (const [field, sym] of Object.entries(fts)) {
                    if (sym === t.address) fts[field] = t.symbol;
                }
            }
            setFieldToSymbol(fts);

            
            const shares: Record<string, number> = {};
            for (const pool of res.data.result) {
                if (!pool.tokenX || !pool.tokenY) continue;
                const pairKey = `${pool.tokenX}:${pool.tokenY}`;
                try {
                    const lpRes = await axios.post(rpcUrl, {
                        jsonrpc: '2.0', method: 'woo_getMappingValue',
                        params: ['woo_dex.aleo', 'lp_shares_simple', pairKey, address],
                        id: 1
                    });
                    shares[pairKey] = lpRes.data.result || 0;
                } catch {}
            }
            setMyLPShares(shares);
        }
    } catch {}
}, [rpcUrl, simulationMode, address, tokens]);


const fetchDexBalances = useCallback(async () => {
    if (simulationMode || !address) return;
    try {
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0', method: 'woo_getDexBalances', params: [address], id: 1
        });
        if (res.data.result) setDexBalances(res.data.result);
    } catch {}
}, [rpcUrl, simulationMode, address]);

  
  useEffect(() => {
    const estimate = async () => {
      
      if (!swapTokenIn || !swapTokenOut || !swapAmountIn) { 
        setSwapAmountOut(''); 
        setSwapImpact(''); 
        return; 
      }

      try {
        
        const fieldIn = await contractNameToFieldAsync(swapTokenIn.address, rpcUrl);
        const fieldOut = await contractNameToFieldAsync(swapTokenOut.address, rpcUrl);

        
        const pool = pools.find(p =>
          (p.tokenX === fieldIn && p.tokenY === fieldOut) ||
          (p.tokenY === fieldIn && p.tokenX === fieldOut)
        );

        if (!pool) { 
          setSwapAmountOut(''); 
          setSwapRoute('Pool não encontrada'); 
          return; 
        }

        
        const amtIn = parseFloat(swapAmountIn.replace(',', '.'));
        if (isNaN(amtIn) || amtIn <= 0) { 
          setSwapAmountOut(''); 
          return; 
        }

        
        const isXtoY = pool.tokenX === fieldIn;
        const rIn  = isXtoY ? pool.reserveX : pool.reserveY;
        const rOut = isXtoY ? pool.reserveY : pool.reserveX;

        
        const fee = 1 - (pool.fee / 100);
        const amtInFee = amtIn * fee;
        
        
        const amtOut = (amtInFee * rOut) / (rIn + amtInFee);
        
        
        const impact = ((amtIn / rIn) * 100).toFixed(2);

        
        setSwapAmountOut(amtOut.toFixed(6));
        setSwapImpact(impact);
        setSwapRoute(`${swapTokenIn.symbol} → ${swapTokenOut.symbol}`);

      } catch (err) {
        console.error("Erro ao estimar swap:", err);
        setSwapRoute("Erro ao calcular rota");
      }
    };

    estimate();
  }, [swapAmountIn, swapTokenIn, swapTokenOut, pools, rpcUrl]); 

 
  const getNonce = async (addr: string): Promise<number> => {
    if (simulationMode) return 0;
    const res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_getNonce', params:[addr], id:1 });
    return res.data.result ?? 0;
  };

 
  const handleAddToken = async () => {
    if (!newTokenAddress || !newTokenSymbol) { setMsg('✗ Preencha endereço e símbolo', 'err'); return; }
    if (tokens.find(t => t.address === newTokenAddress)) { setMsg('✗ Token já adicionado', 'err'); return; }
    const nt: Token = { address: newTokenAddress, symbol: newTokenSymbol, decimals: parseInt(newTokenDecimals)||0 };
    const nts = [...tokens, nt];
    setTokens(nts);
    setNewTokenAddress(''); setNewTokenSymbol(''); setNewTokenDecimals('0');
    setShowAddToken(false);
    setMsg(` ${newTokenSymbol} adicionado`);
    setTimeout(() => fetchAllBalances(true, nts), 100);
  };

  const copyAddress = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  
  const handleSend = async () => {
    if (!toAddress || !amount) { setMsg('✗ Preencha todos os campos', 'err'); return; }
    if (!sendConfirm) { setSendConfirm(true); return; }
    setSendConfirm(false);
    if (simulationMode) {
      setTxHistory(p => [{ txId:`0x${Math.random().toString(16).slice(2)}`, type:'TRANSFER', from:address, to:toAddress, amount, timestamp:Date.now(), status:'confirmed' }, ...p.slice(0,49)]);
      setMsg(' Simulação: enviado!'); setToAddress(''); setAmount('');
      setTimeout(() => fetchAllBalances(true), 1500); return;
    }
    setMsg(' Assinando e enviando...', 'loading');
    try {
      const nonce = await getNonce(address);
      const mult  = 10 ** selectedToken.decimals;
      const numAmt = Math.floor(parseFloat(amount.replace(',','.')) * mult);
      let res;
      if (selectedToken.address === 'native') {
        const sig = autoSign(privateKey, buildMessage(address, toAddress, numAmt, nonce));
        res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_sendTransaction', params:[{from:address,to:toAddress,amount:numAmt,signature:sig,nonce}], id:1 });
      } else {
        const sig = autoSign(privateKey, buildMessage(address, selectedToken.address, toAddress, numAmt, nonce));
        res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_sendTokenTransaction', params:[{from:address,tokenId:selectedToken.address,to:toAddress,amount:`${numAmt}u64`,signature:sig,nonce}], id:1 });
      }
      if (res?.data.error) { setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err'); return; }
      const txId = res?.data.result?.txId || res?.data.result || 'ok';
      setTxHistory(p => [{ txId, type:'TRANSFER', from:address, to:toAddress, amount, timestamp:Date.now(), status:'confirmed' }, ...p.slice(0,49)]);
      setMsg(` Enviado! TX: ${String(txId).slice(0,18)}...`);
      setToAddress(''); setAmount('');
      setTimeout(() => fetchAllBalances(true), 2000);
    } catch { setMsg(' Transação falhou', 'err'); }
  };

  const handleSwap = async () => {
    if (!swapTokenIn || !swapTokenOut || !swapAmountIn) { setMsg('✗ Preencha os campos do swap', 'err'); return; }
    if (!swapConfirm) { setSwapConfirm(true); return; }
    setSwapConfirm(false);
    if (simulationMode) { /* ... */ return; }

    setMsg(' Executando swap...', 'loading');
    try {
        const nonce = await getNonce(address);

        
        const fieldIn  = await contractNameToFieldAsync(swapTokenIn.address, rpcUrl);
        const fieldOut = await contractNameToFieldAsync(swapTokenOut.address, rpcUrl);

        const pool = pools.find(p =>
            (p.tokenX === fieldIn  && p.tokenY === fieldOut) ||
            (p.tokenY === fieldIn  && p.tokenX === fieldOut)
        );
        if (!pool) { setMsg(' Pool não encontrada', 'err'); return; }

        const isXtoY = pool.tokenX === fieldIn;
        const fnName = isXtoY ? 'swap_x_for_y' : 'swap_y_for_x';
        const numAmt = toU64(swapAmountIn, swapTokenIn.decimals);
        const deadline = 4000000;
        const minOut = Math.floor(
            parseFloat(swapAmountOut) * (1 - parseFloat(slippage) / 100) * (10 ** swapTokenOut.decimals)
        );

        
        const inputs = [
            pool.tokenX,       
            pool.tokenY,       
            `${numAmt}u64`,
            `${minOut}u64`,
            `${deadline}u32`
        ];

        const sig = autoSign(privateKey, buildMessage(address, AMM_CONTRACT, fnName, 'EXECUTE', nonce));
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0', method: 'woo_executeContract',
            params: [{ from: address, contractName: AMM_CONTRACT, functionName: fnName, inputs, signature: sig, nonce }],
            id: 1
        });

        if (res.data.error) { setMsg(`✗ ${res.data.error}`, 'err'); return; }
        setTxHistory(p => [{ txId: res.data.result?.txId || 'ok', type: 'SWAP', from: address, amount: swapAmountIn, timestamp: Date.now(), status: 'confirmed' }, ...p.slice(0, 49)]);
        setMsg(' Swap executado!');
        setSwapAmountIn(''); setSwapAmountOut('');
        setTimeout(() => { fetchAllBalances(true); fetchDexBalances(); }, 2000);
    } catch { setMsg(' Swap falhou', 'err'); }
};


  const handleAddLiquidity = async () => {
    if (!poolTokenX || !poolTokenY || !poolAmountX || !poolAmountY) { 
        setMsg('✗ Preencha todos os campos', 'err'); 
        return; 
    }

    setMsg(' Convertendo IDs e Gerando Prova...', 'loading');

    try {
        const nonce = await getNonce(address);
        
        const tokenXField = await contractNameToFieldAsync(poolTokenX, rpcUrl);
        const tokenYField = await contractNameToFieldAsync(poolTokenY, rpcUrl);

        const tObjX = tokens.find(t => t.address === poolTokenX) || { decimals: 0 };
        const tObjY = tokens.find(t => t.address === poolTokenY) || { decimals: 0 };

        const numX = toU64(poolAmountX, tObjX.decimals);
        const numY = toU64(poolAmountY, tObjY.decimals);

        
        const minX = Math.floor(numX * 0.99);
        const minY = Math.floor(numY * 0.99);
        const lpMin = 100; 

        
        const inputs = [
            tokenXField,      
            tokenYField,      
            `${numX}u64`,     
            `${numY}u64`,     
            `${minX}u64`,     
            `${minY}u64`,     
            `${lpMin}u64`     
        ];

        const sig = autoSign(privateKey, buildMessage(address, AMM_CONTRACT, 'add_liquidity', 'EXECUTE', nonce));

        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            method: 'woo_executeContract',
            params: [{ 
                from: address, 
                contractName: AMM_CONTRACT, 
                functionName: 'add_liquidity', 
                inputs, 
                signature: sig, 
                nonce 
            }],
            id: 1
        });

        if (res.data.error) { setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err'); return; }
        
        setMsg(' Liquidez adicionada com sucesso!');
        setPoolAmountX(''); setPoolAmountY('');
        fetchPools();
        setTimeout(() => fetchAllBalances(true), 2000);

    } catch (err) {
        console.error(err);
        setMsg(' Falha ao processar liquidez', 'err');
    }
};

  const handleRemoveLiquidity = async (pool: Pool) => {
    if (!removeShares) { setMsg('✗ Informe shares', 'err'); return; }
    setMsg(' Removendo liquidez...', 'loading');
    try {
        const nonce = await getNonce(address);

        
        const inputs = [
            pool.tokenX,          
            pool.tokenY,          
            `${removeShares}u64`,
            `1u64`,               
            `1u64`                
        ];

        const sig = autoSign(privateKey, buildMessage(address, AMM_CONTRACT, 'remove_liquidity', 'EXECUTE', nonce));
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0', method: 'woo_executeContract',
            params: [{ from: address, contractName: AMM_CONTRACT, functionName: 'remove_liquidity', inputs, signature: sig, nonce }],
            id: 1
        });

        if (res.data.error) { setMsg(`✗ ${res.data.error}`, 'err'); return; }
        setMsg('✓ Liquidez removida!');
        setRemoveShares('');
        fetchPools();
        setTimeout(() => fetchAllBalances(true), 2000);
    } catch { setMsg('✗ Falha ao remover liquidez', 'err'); }
};

  
const handleDexVault = async (action: 'deposit'|'withdraw') => {
  if (!vaultAmount) { setMsg('✗ Informe a quantidade', 'err'); return; }
  if (simulationMode) { setMsg(`✓ Simulação: ${action} executado!`); return; }
  
  setMsg(` Processando ${action}...`, 'loading');
  
  try {
    const nonce = await getNonce(address);
    const tObj = tokens.find(t => t.address === vaultTokenId) || { decimals: 0 };
    const numAmt = toU64(vaultAmount, tObj.decimals);

    
    const fnName = action; 

    
    const tokenIdField = await contractNameToFieldAsync(vaultTokenId, rpcUrl);

    
    const inputs = [tokenIdField, `${numAmt}u64`, vaultTokenId];

    const sig = autoSign(privateKey, buildMessage(address, AMM_CONTRACT, fnName, 'EXECUTE', nonce));

    const res = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'woo_executeContract',
      params: [{ from: address, contractName: AMM_CONTRACT, functionName: fnName, inputs, signature: sig, nonce }],
      id: 1
    });

    if (res.data.error) { setMsg(`✗ ${res.data.error}`, 'err'); return; }

    setMsg(` ${action === 'deposit' ? 'Depósito' : 'Saque'} realizado!`);
    setVaultAmount('');
    setTimeout(() => { fetchAllBalances(true); fetchDexBalances(); }, 2000);
  } catch (err) { 
    setMsg(' Erro na conexão', 'err'); 
  }
};

  
  const handleBridgeOut = async () => {
    if (!bridgeAmount || parseFloat(bridgeAmount) <= 0) { setMsg('✗ Valor inválido', 'err'); return; }
    if (simulationMode) { setMsg(' Simulação: saque solicitado!'); setBridgeAmount(''); return; }
    setMsg(' Solicitando saque...', 'loading');
    try {
      const nonce  = await getNonce(address);
      const bToken = tokens.find(t => t.address === BRIDGE_TOKEN_ID) || { decimals: BRIDGE_TOKEN_DEC };
      const numAmt = toU64(bridgeAmount, bToken.decimals);
      const sig = autoSign(privateKey, buildMessage(address, numAmt, 'WITHDRAW', nonce));
      const res = await axios.post(rpcUrl, {
        jsonrpc:'2.0', method:'woo_requestWithdraw',
        params:[{ address, amount:numAmt, tokenId:BRIDGE_TOKEN_ID, signature:sig, nonce }], id:1
      });
      if (res.data.error) { setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err'); return; }
      setMsg(' Saque solicitado! Processando na L1...'); setBridgeAmount('');
      setTimeout(() => fetchAllBalances(true), 2500);
    } catch { setMsg(' Saque falhou', 'err'); }
  };

  
  const fetchNFTs = async () => {
    if (!nftContractId) { setMsg('✗ Informe o contrato', 'err'); return; }
    setNftLoading(true); setMsg(' Buscando NFTs...', 'loading');
    try {
      const res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_getNFTs', params:[address,nftContractId], id:1 });
      setNfts(Array.isArray(res.data.result) ? res.data.result : []);
      setMsg(` ${(res.data.result||[]).length} NFT(s) encontrado(s)`);
    } catch { setMsg(' Erro ao buscar NFTs', 'err'); setNfts([]); }
    finally { setNftLoading(false); }
  };

  const handleInitializePool = async () => {
    if (!poolTokenX || !poolTokenY || !poolAmountX || !poolAmountY) {
        setMsg(' Preencha os valores iniciais', 'err');
        return;
    }
    setMsg(' Inicializando Pool (Gênese do Par)...', 'loading');

    try {
        const nonce = await getNonce(address);
        const fieldX = await contractNameToFieldAsync(poolTokenX, rpcUrl);
        const fieldY = await contractNameToFieldAsync(poolTokenY, rpcUrl);

        
        const valX = BigInt(fieldX.replace('field', ''));
        const valY = BigInt(fieldY.replace('field', ''));
        
        let tokenA, tokenB, amountA, amountB;

        if (valX < valY) {
            tokenA = fieldX; tokenB = fieldY;
            amountA = toU64(poolAmountX, tokens.find(t=>t.address===poolTokenX)?.decimals || 0);
            amountB = toU64(poolAmountY, tokens.find(t=>t.address===poolTokenY)?.decimals || 0);
        } else {
            tokenA = fieldY; tokenB = fieldX;
            amountA = toU64(poolAmountY, tokens.find(t=>t.address===poolTokenY)?.decimals || 0);
            amountB = toU64(poolAmountX, tokens.find(t=>t.address===poolTokenX)?.decimals || 0);
        }

        
        const inputs = [tokenA, tokenB, `${amountA}u64`, `${amountB}u64` ];

        const sig = autoSign(privateKey, buildMessage(address, AMM_CONTRACT, 'initialize_pool', 'EXECUTE', nonce));

        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            method: 'woo_executeContract',
            params: [{ from: address, contractName: AMM_CONTRACT, functionName: 'initialize_pool', inputs, signature: sig, nonce }],
            id: 1
        });

        if (res.data.error) { setMsg(` ${JSON.stringify(res.data.error)}`, 'err'); return; }

        setMsg(' Pool Criada com Sucesso!');
        fetchPools();
        setPoolView('list');
    } catch (err) {
        setMsg(' Erro ao criar pool', 'err');
    }
};

  
  const handleDeploy = async () => {
    if (simulationMode) { setMsg('✓ Simulação: implantado!'); return; }
    setMsg(' Implantando...', 'loading');
    try {
      const nonce = await getNonce(address);
      const sig = autoSign(privateKey, buildMessage(address, `${programName}.aleo`, 'DEPLOY', nonce));
      const res = await axios.post(rpcUrl, {
        jsonrpc:'2.0', method:'woo_deployContract',
        params:[{ from:address, contractName:`${programName}.aleo`, leoCode:contractCode, signature:sig, nonce }], id:1
      });
      if (res.data.error) setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err');
      else setMsg(`✓ ${programName}.aleo implantado!`);
    } catch { setMsg('✗ Implantação falhou', 'err'); }
  };

  const handleCallContract = async () => {
    if (simulationMode) { setMsg('✓ Simulação: função executada!'); setTimeout(()=>fetchAllBalances(true),1500); return; }
    setMsg(' Executando...', 'loading');
    try {
      const nonce     = await getNonce(address);
      const fullName  = `${programName}.aleo`;
      const cleanInps = callParams.split(',').map(s=>s.trim()).filter(Boolean);
      const sig = autoSign(privateKey, buildMessage(address, fullName, callFunction, 'EXECUTE', nonce));
      const res = await axios.post(rpcUrl, {
        jsonrpc:'2.0', method:'woo_executeContract',
        params:[{ from:address, contractName:fullName, functionName:callFunction, inputs:cleanInps, signature:sig, nonce }], id:1
      });
      if (res.data.error) setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err');
      else { setMsg(`✓ ${callFunction} executada!`); setTimeout(()=>fetchAllBalances(true),2000); }
    } catch { setMsg('✗ Execução falhou', 'err'); }
  };

  const handleQueryMapping = async () => {
    if (!mappingKey) return;
    if (simulationMode) { setMappingValue('999u64 (simulado)'); setMsg('✓ Simulado'); return; }
    setMsg(' Consultando...', 'loading');
    try {
      const res = await axios.post(rpcUrl, { jsonrpc:'2.0', method:'woo_getMappingValue', params:[`${programName}.aleo`,mappingName,mappingKey], id:1 });
      if (res.data.error) { setMsg(`✗ ${JSON.stringify(res.data.error)}`, 'err'); setMappingValue(''); }
      else { setMappingValue(res.data.result??'null'); setMsg('✓ Valor obtido'); }
    } catch { setMsg('✗ Falha', 'err'); }
  };

  
  const getTokenBalance = (addr: string) => {
    const t = tokens.find(t => t.address === addr);
    return t ? formatBalance(t) : '—';
  };

  
  const getDexBalance = (addr: string): string => {
    if (!addr || addr === 'native') return '0';
    const t = tokens.find(t => t.address === addr);
    const dec = t?.decimals ?? 0;
    
    const raw = dexBalances[addr] ?? 0;
    if (!raw) return '0';
    if (dec === 0) return raw.toString();
    const val = BigInt(Math.round(raw));
    const div = 10n ** BigInt(dec);
    const int = val / div;
    const frac = val % div;
    if (frac === 0n) return int.toString();
    return `${int}.${frac.toString().padStart(dec, '0').replace(/0+$/, '')}`;
  };

  
  const resolveTokenName = (field: string): string => {
    if (!field) return '?';
    
    if (fieldToSymbol[field]) return fieldToSymbol[field];
    
    const t = tokens.find(t => t.address === field);
    if (t) return t.symbol;
    
    return field.length > 12 ? field.slice(0, 8) + '…' : field;
  };

  const selectedTokenBalance = selectedToken ? formatBalance(selectedToken) : '0';

  
  const flipSwap = () => {
    const tin  = swapTokenIn;
    const tout = swapTokenOut;
    setSwapTokenIn(tout);
    setSwapTokenOut(tin);
    setSwapAmountIn(swapAmountOut);
    setSwapAmountOut('');
  };

  
  return (
    <div className="app-container">
      <div className="wrapper">

        {/* Header */}
        <header className="header">
          <div className="logo-group">
            <div className="logo-icon"><img src="/wallet.png" alt="wallet" /></div>
            <div>
              <div className="logo-title">WOOsdk</div>
              <div className="logo-sub">WALLET</div>
            </div>
          </div>

          <nav className="nav-tabs">
            {(['wallet','swap','pool','nft','labs'] as const).map(view => (
              <button
                key={view}
                className={`nav-btn ${activeView === view ? 'active' : ''}`}
                onClick={() => setActiveView(view)}
              >
                {view === 'wallet' && <img src="/icons/wallet-tab.png" className="nav-icon" width={22} height={22} alt="wallet" />}
              {view === 'swap'   && <img src="/icons/swap.png"       className="nav-icon" width={22} height={22} alt="swap" />}
              {view === 'pool'   && <img src="/icons/pool.png"       className="nav-icon" width={22} height={22} alt="pool" />}
              {view === 'nft'    && <img src="/icons/nft.png"        className="nav-icon" width={22} height={22} alt="nft" />}
              {view === 'labs'   && <img src="/icons/labs.png"       className="nav-icon" width={22} height={22} alt="labs" />}
                <span>{view === 'wallet' ? 'Carteira' : view === 'swap' ? 'Swap' : view === 'pool' ? 'Pools' : view === 'nft' ? 'NFTs' : 'Labs'}</span>
              </button>
            ))}
          </nav>

          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
  <img src="/icons/settings.png" width={24} height={24} alt="configurações" />
</button>
        </header>

        {/* ── Settings Panel ── */}
        {showSettings && (
          <div className="settings-panel card">
            <div className="settings-row">
              <span className="settings-icon"></span>
              <div className="settings-field">
                <label>URL do RPC</label>
                <input type="text" value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} placeholder="http://localhost:8545" />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-icon"></span>
              <div className="settings-field">
                <label>Chave Privada (auto-assina tudo)</label>
                <input type="password" value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="APrivateKey..." />
              </div>
            </div>
            <div className="address-display" onClick={copyAddress} title="Clique para copiar">
               {shortAddr(address)}
            </div>
            <div className="auto-sign-badge"><img src="/icons/lightning.png" width={16} height={16} alt="auto" /> Auto-Assinatura Ativa</div>
            <label className="sim-toggle">
              <input type="checkbox" checked={simulationMode} onChange={e => setSimulationMode(e.target.checked)} />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              Modo Simulação
            </label>
          </div>
        )}

        {/*  WALLET  */}
        {activeView === 'wallet' && (
          <div className="wallet-mode">

            <div className="balance-card card">
              <div className="balance-label">Saldo de Gás L3</div>
              <div className="balance-value">
                {formatBalance(tokens[0] || NATIVE_TOKEN)}
                <small>{tokens[0]?.symbol || GAS_SYMBOL}</small>
              </div>
              <div className="addr-chip" onClick={copyAddress}>
                {copied ? '✓ Copiado!' : shortAddr(address)}
              </div>
              <div className="action-buttons">
                <button className="action-btn" onClick={() => setShowReceive(false)}>
                  ↗ Enviar
                </button>
                <button className="action-btn primary-action" onClick={() => setShowReceive(!showReceive)}>
                  ↙ Receber
                </button>
              </div>
            </div>

            {showReceive && (
              <div className="receive-card card">
                <h3>Seu Endereço</h3>
                <div className="qr-placeholder">
  <img src="/icons/qr.png" width={80} height={80} alt="QR Code" />
</div>
                <div className="receive-addr">{address}</div>
                <button className="btn-secondary" onClick={copyAddress}>
                  {copied ? ' Copiado!' : ' Copiar Endereço'}
                </button>
              </div>
            )}

            <div className="master-phrase-card">
              <div className="master-phrase-title">Frase de Segurança</div>
              <div className="phrase-input-wrapper">
                <input
                  type={showPhrase ? 'text' : 'password'}
                  className="master-phrase-input"
                  placeholder="Frase mestra para proteger a wallet"
                  value={masterPhrase}
                  onChange={e => setMasterPhrase(e.target.value)}
                />
                <button className="phrase-eye" onClick={() => setShowPhrase(!showPhrase)}>
                  {showPhrase ? '' : ''}
                </button>
              </div>
            </div>

            <div className="tokens-card card">
              <div className="card-header">
                <h3>Seus Ativos</h3>
                <button className="add-token-btn" onClick={() => setShowAddToken(!showAddToken)}>+ Token</button>
              </div>
              {showAddToken && (
                <div className="add-token-form">
                  <input placeholder="Endereço (ex: token11.aleo)" value={newTokenAddress} onChange={e => setNewTokenAddress(e.target.value)} />
                  <input placeholder="Símbolo (ex: TK11)" value={newTokenSymbol} onChange={e => setNewTokenSymbol(e.target.value)} />
                  <div className="add-token-row">
                    <input placeholder="Decimais" type="number" value={newTokenDecimals} onChange={e => setNewTokenDecimals(e.target.value)} style={{width:'100px'}} />
                    <button onClick={handleAddToken} className="btn-primary small">Adicionar</button>
                  </div>
                </div>
              )}
              <div className="token-list">
                {tokens.map(token => (
                  <div key={token.address} className={`token-item ${selectedToken.address === token.address ? 'selected' : ''}`} onClick={() => setSelectedToken(token)}>
                    <div className="token-left">
                      <div className="token-icon"><img src="/coin.png" alt="token" /></div>
                      <div className="token-info">
                        <span className="token-symbol">{token.symbol}</span>
                        <span className="token-name">{token.address === 'native' ? 'Gás da Rede' : shortAddr(token.address)}</span>
                      </div>
                    </div>
                    <div className="token-right">
                      <div className="token-balance">{formatBalance(token)}</div>
                      <div className="token-fiat">≈ $0.00</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => fetchAllBalances(true)} className="btn-secondary refresh-btn">↻ Atualizar Saldos</button>
            </div>

            {/* Send */}
            <div className="send-card card" id="send-section">
              <h3>Enviar {selectedToken.symbol}</h3>
              <div className="auto-sign-pill"><img src="/icons/lightning.png" width={16} height={16} alt="auto" /> Auto-assinado</div>
              <div className="send-form-group">
                <label>Destinatário</label>
                <input className="send-input" placeholder="aleo1..." value={toAddress} onChange={e => setToAddress(e.target.value)} />
              </div>
              <div className="send-form-group">
                <label>Quantidade</label>
                <input className="send-input" type="text" placeholder="Ex: 50" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div className="available-balance">
                <span>Disponível</span>
                <span>{selectedTokenBalance} {selectedToken.symbol}</span>
              </div>
              {sendConfirm ? (
                <div className="confirm-box">
                  <p> Confirmar envio de <strong>{amount} {selectedToken.symbol}</strong> para <strong>{shortAddr(toAddress)}</strong>?</p>
                  <div className="confirm-btns">
                    <button className="btn-secondary small" onClick={() => setSendConfirm(false)}>Cancelar</button>
                    <button className="btn-sign-teleport confirm" onClick={handleSend}>Confirmar</button>
                  </div>
                </div>
              ) : (
                <button onClick={handleSend} className="btn-sign-teleport"><img src="/icons/lightning.png" width={16} height={16} alt="auto" /> Assinar e Enviar</button>
              )}
            </div>

            {/* Bridge Out */}
            <div className="bridge-card card">
              <img src="/icons/bridge.png" width={18} height={18} alt="bridge" /> Bridge Out — Sacar para L1
              <p className="bridge-hint">Retire seus <strong>{BRIDGE_TOKEN_SYM}</strong> de volta para a rede Aleo principal.</p>
              <div className="send-form-group">
                <label>Quantidade ({BRIDGE_TOKEN_SYM})</label>
                <input className="send-input" type="text" placeholder="Ex: 500" value={bridgeAmount} onChange={e => setBridgeAmount(e.target.value)} />
              </div>
              <button onClick={handleBridgeOut} className="btn-sign-teleport bridge-btn"><img src="/icons/bridge.png" width={18} height={18} alt="bridge" /> Solicitar Saque</button>
            </div>

            {/* Tx History */}
            {txHistory.length > 0 && (
              <div className="history-card card">
                <h3> Histórico</h3>
                <div className="history-list">
                  {txHistory.slice(0,10).map(tx => (
                    <div key={tx.txId} className="history-item">
                      <div className="history-type">{tx.type==='TRANSFER' && <img src="/icons/send.png"      width={16} height={16} alt="transfer" />}
{tx.type==='SWAP'     && <img src="/icons/swap.png"      width={16} height={16} alt="swap" />}
{tx.type==='DEPLOY'   && <img src="/icons/deploy.png"    width={16} height={16} alt="deploy" />}
{!['TRANSFER','SWAP','DEPLOY'].includes(tx.type) && <img src="/icons/lightning.png" width={16} height={16} alt="tx" />}</div>
                      <div className="history-info">
                        <div className="history-desc">
                          {tx.type==='TRANSFER'?`Envio de ${tx.amount}`:tx.type==='SWAP'?`Swap ${tx.amount}`:tx.type}
                          {tx.to && <span className="history-addr"> → {shortAddr(tx.to)}</span>}
                        </div>
                        <div className="history-time">{timeAgo(tx.timestamp)}</div>
                      </div>
                      <div className={`history-status ${tx.status}`}>{tx.status==='confirmed'?'✓':'⏳'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/*  SWAP  */}
        {activeView === 'swap' && (
          <div className="swap-mode">
            <div className="card uniswap-card">
              <div className="uniswap-header">
                <h3>Swap</h3>
                <div className="swap-header-actions">
                  <button className="slippage-btn" onClick={() => setShowSlippage(!showSlippage)}>
                    <img src="/icons/settings.png" width={14} height={14} alt="slippage" /> {slippage}%
                  </button>
                </div>
              </div>

              {showSlippage && (
                <div className="slippage-panel">
                  <label>Tolerância de Slippage</label>
                  <div className="slippage-options">
                    {['0.1','0.5','1.0'].map(v => (
                      <button key={v} className={`slippage-opt ${slippage===v?'active':''}`} onClick={() => setSlippage(v)}>{v}%</button>
                    ))}
                    <input type="text" value={slippage} onChange={e => setSlippage(e.target.value)} className="slippage-custom" placeholder="Personalizado" />
                  </div>
                </div>
              )}

              {/* Token In */}
              <div className="swap-box">
                <div className="swap-box-label">De</div>
                <div className="swap-box-inner">
                  <input
                    className="swap-amount-input"
                    type="text"
                    placeholder="0.0"
                    value={swapAmountIn}
                    onChange={e => setSwapAmountIn(e.target.value)}
                  />
                  <select
                    className="token-select"
                    value={swapTokenIn?.address || ''}
                    onChange={e => setSwapTokenIn(tokens.find(t => t.address === e.target.value) || null)}
                  >
                    <option value="">Selecionar</option>
                    {tokens.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                  </select>
                </div>
                {swapTokenIn && (
                  <div className="swap-balance-hint">
                     {getTokenBalance(swapTokenIn.address)} {swapTokenIn.symbol}
                    {' · '} DEX: {getDexBalance(swapTokenIn.address)}
                    <button className="max-btn" onClick={() => setSwapAmountIn(getDexBalance(swapTokenIn.address) !== '0' ? getDexBalance(swapTokenIn.address) : formatBalance(tokens.find(t=>t.address===swapTokenIn.address)))}>MAX</button>
                  </div>
                )}
              </div>

              {/* Flip */}
              <div className="swap-flip-row">
                <button className="flip-btn" onClick={flipSwap}>⇅</button>
              </div>

              {/* Token Out */}
              <div className="swap-box">
                <div className="swap-box-label">Para</div>
                <div className="swap-box-inner">
                  <input
                    className="swap-amount-input"
                    type="text"
                    placeholder="0.0"
                    value={swapAmountOut}
                    readOnly
                  />
                  <select
                    className="token-select"
                    value={swapTokenOut?.address || ''}
                    onChange={e => setSwapTokenOut(tokens.find(t => t.address === e.target.value) || null)}
                  >
                    <option value="">Selecionar</option>
                    {tokens.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                  </select>
                </div>
                {swapTokenOut && (
                  <div className="swap-balance-hint">
                     {getTokenBalance(swapTokenOut.address)} {swapTokenOut.symbol}
                    {' · '} DEX: {getDexBalance(swapTokenOut.address)}
                  </div>
                )}
              </div>

              {/* Route & Impact */}
              {swapRoute && (
                <div className="swap-details">
                  <div className="swap-detail-row">
                    <span>Rota</span><span>{swapRoute}</span>
                  </div>
                  <div className="swap-detail-row">
                    <span>Impacto de Preço</span>
                    <span className={parseFloat(swapImpact) > 5 ? 'impact-high' : parseFloat(swapImpact) > 2 ? 'impact-med' : 'impact-low'}>
                      {swapImpact}%
                    </span>
                  </div>
                  <div className="swap-detail-row">
                    <span>Slippage Máx.</span><span>{slippage}%</span>
                  </div>
                  <div className="swap-detail-row">
                    <span>Fee</span><span>0.3%</span>
                  </div>
                </div>
              )}

              {swapConfirm ? (
                <div className="confirm-box">
                  <p> Confirmar swap de <strong>{swapAmountIn} {swapTokenIn?.symbol}</strong> por <strong>≈{swapAmountOut} {swapTokenOut?.symbol}</strong>?</p>
                  <div className="confirm-btns">
                    <button className="btn-secondary small" onClick={() => setSwapConfirm(false)}>Cancelar</button>
                    <button className="btn-sign-teleport confirm" onClick={handleSwap}>Confirmar Swap</button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-sign-teleport"
                  onClick={handleSwap}
                  disabled={!swapTokenIn || !swapTokenOut || !swapAmountIn}
                >
                   {!swapTokenIn || !swapTokenOut ? 'Selecione os tokens' : !swapAmountIn ? 'Informe a quantidade' : 'Swap'}
                </button>
              )}
            </div>

                       {/*  Cofre */}
<div className="card vault-card-unified">
  <div className="vault-header">
    <h3>Gerenciar Saldo DEX</h3>
    <div className="vault-badge">V4</div>
  </div>
  
  <p className="bridge-hint">Deposite para negociar ou saque para sua carteira.</p>
  
  <div className="vault-main-box">
    <div className="vault-input-row">
      <div className="vault-field">
        <label>Token</label>
        <select 
          className="token-select-vault"
          value={vaultTokenId}
          onChange={e => setVaultTokenId(e.target.value)}
        >
          {tokens.map(t => (
            <option key={t.address} value={t.address}>{t.symbol} ({shortAddr(t.address)})</option>
          ))}
        </select>
      </div>

      <div className="vault-field">
        <label>Quantidade</label>
        <input 
          className="send-input" 
          type="text" 
          placeholder="0.0" 
          value={vaultAmount} 
          onChange={e => setVaultAmount(e.target.value)} 
        />
      </div>
    </div>

    <div className="vault-info-row">
      <span> Carteira L3: <strong>{getTokenBalance(vaultTokenId)}</strong></span>
      <span> Saldo na DEX: <strong>{getDexBalance(vaultTokenId)}</strong></span>
    </div>
    
    <div className="vault-actions-unified">
      <button className="btn-vault-deposit" onClick={() => handleDexVault('deposit')}>
        ↓ DEPOSITAR NA DEX
      </button>
      <button className="btn-vault-withdraw" onClick={() => handleDexVault('withdraw')}>
        ↑ SACAR PARA WALLET
      </button>
    </div>
  </div>
</div>
</div> 
)} 

        {/*  POOLS  */}
        {activeView === 'pool' && (
          <div className="pool-mode">

            <div className="pool-view-tabs">
              <button className={`pool-tab ${poolView==='list'?'active':''}`} onClick={() => setPoolView('list')}> Pools</button>
              <button className={`pool-tab ${poolView==='add'?'active':''}`}  onClick={() => setPoolView('add')}> Adicionar Liquidez</button>
            </div>

            {poolView === 'list' && (
              <div className="pools-list">
                <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
                  <button className="btn-secondary" style={{fontSize:'0.8rem', padding:'4px 12px'}} onClick={() => { fetchPools(); fetchDexBalances(); }}>↻ Atualizar</button>
                </div>
                {pools.length === 0 && (
                  <div className="card empty-pool">
                    <img src="/icons/pool-empty.png" width={40} height={40} alt="sem pools" />
                    <p>Nenhuma pool encontrada.<br/>Adicione liquidez para criar uma!</p>
                  </div>
                )}
                {pools.map((pool, i) => {
                  const pairKey = `${pool.tokenX}:${pool.tokenY}`;
                  const ratio   = pool.reserveX > 0 ? (pool.reserveY / pool.reserveX).toFixed(4) : '—';
                  const tvl     = pool.reserveX + pool.reserveY;
                  return (
                    <div key={i} className="card pool-card">
                      <div className="pool-pair">
                        <div className="pool-icons">
                          <img src="/icons/coin.png" className="pool-icon" width={28} height={28} alt="token" />
                         <img src="/icons/coin.png" className="pool-icon" width={28} height={28} alt="token" />
                        </div>
                        <div className="pool-pair-info">
                          <div className="pool-pair-name">{resolveTokenName(pool.tokenX)} / {resolveTokenName(pool.tokenY)}</div>
                          <div className="pool-fee-badge">{pool.fee}% fee</div>
                        </div>
                      </div>
                      <div className="pool-stats">
                        <div className="pool-stat">
                          <span>{resolveTokenName(pool.tokenX)}</span>
                          <strong>{pool.reserveX.toLocaleString()}</strong>
                        </div>
                        <div className="pool-stat">
                          <span>{resolveTokenName(pool.tokenY)}</span>
                          <strong>{pool.reserveY.toLocaleString()}</strong>
                        </div>
                        <div className="pool-stat">
                          <span>Ratio</span>
                          <strong>1 : {ratio}</strong>
                        </div>
                        <div className="pool-stat">
                          <span>TVL</span>
                          <strong>{tvl.toLocaleString()}</strong>
                        </div>
                      </div>
                      {/* lps*/}
      <div className="my-lp-section">
    <div className="my-lp-title">
        Sua Posição: <strong>{myLPShares[`${pool.tokenX}:${pool.tokenY}`] || 0} LP</strong>
    </div>
    <div className="remove-liq-input-group">
        <input 
            type="number" 
            placeholder={`Shares (máx: ${myLPShares[`${pool.tokenX}:${pool.tokenY}`] || 0})`}
            value={removeShares} 
            onChange={e => setRemoveShares(e.target.value)}
        />
        <button className="btn-remove-liq" onClick={() => handleRemoveLiquidity(pool)}>
            RETIRAR
        </button>
    </div>
</div>

      <button className="btn-pool-add" onClick={() => { setPoolTokenX(pool.tokenX); setPoolTokenY(pool.tokenY); setPoolView('add'); }}>
        + Adicionar Liquidez
      </button>
    </div>
  );
})}
              </div>
            )}

            {poolView === 'add' && (
              <div className="card add-liquidity-card">
                <h3> Adicionar Liquidez</h3>
                <div className="auto-sign-pill"><img src="/icons/lightning.png" width={16} height={16} alt="auto" /> Auto-assinado</div>

                <div className="liq-token-box">
                  <div className="liq-token-header">
                    <label>Token X</label>
                    <span className="liq-balance"> {getTokenBalance(poolTokenX)} ·  DEX: {getDexBalance(poolTokenX)}</span>
                  </div>
                  <div className="liq-input-row">
                    <input className="send-input" value={poolTokenX} onChange={e => setPoolTokenX(e.target.value)} placeholder="ID do Token X (ex: wanpedleo.aleo)" />
                  </div>
                  <input className="send-input" style={{marginTop:8}} type="text" placeholder="Quantidade" value={poolAmountX} onChange={e => setPoolAmountX(e.target.value)} />
                </div>
                <div className="liq-plus">+</div>

                <div className="liq-token-box">
                  <div className="liq-token-header">
                    <label>Token Y</label>
                    <span className="liq-balance"> {getTokenBalance(poolTokenY)} ·  DEX: {getDexBalance(poolTokenY)}</span>
                  </div>
                  <div className="liq-input-row">
                    <input className="send-input" value={poolTokenY} onChange={e => setPoolTokenY(e.target.value)} placeholder="ID do Token Y (ex: token11.aleo)" />
                  </div>
                  <input className="send-input" style={{marginTop:8}} type="text" placeholder="Quantidade" value={poolAmountY} onChange={e => setPoolAmountY(e.target.value)} />
                </div>

               {poolTokenX && poolTokenY && poolAmountX && poolAmountY && (
                  <div className="swap-details">
                    <div className="swap-detail-row">
                      <span>Par</span><span>{shortAddr(poolTokenX)} / {shortAddr(poolTokenY)}</span>
                    </div>
                    <div className="swap-detail-row">
                      <span>Ratio inicial</span>
                      <span>1 : {(parseFloat(poolAmountY||'1') / parseFloat(poolAmountX||'1')).toFixed(4)}</span>
                    </div>
                  </div>
                )}

                {/* ---  */}
                {pools.find(p => 
                  (p.tokenX === poolTokenX && p.tokenY === poolTokenY) || 
                  (p.tokenX === poolTokenY && p.tokenY === poolTokenX)
                ) ? (
                  
                  <button className="btn-sign-teleport" onClick={handleAddLiquidity}>
                     Adicionar Liquidez
                  </button>
                ) : (
                  
                  <button 
                    className="btn-sign-teleport" 
                    style={{background: '#15ff00', boxShadow: '4px 4px 0 #0033aa'}} 
                    onClick={handleInitializePool}
                  >
                     Criar Nova Pool (Gênese)
                  </button>
                )}

                <button className="btn-secondary" style={{marginTop:10}} onClick={() => setPoolView('list')}>
                  ← Voltar
                </button>
              </div> 
            )} 
          </div> 
        )} 

        {/* NFT  */}
        {activeView === 'nft' && (
          <div className="nft-mode">
            <div className="card nft-search-card">
              <h3> Seus NFTs</h3>
              <p className="bridge-hint">Digite o endereço do contrato para visualizar.</p>
              <div className="send-form-group">
                <label>Contrato NFT</label>
                <input className="send-input" placeholder="ex: mynft.aleo" value={nftContractId} onChange={e => setNftContractId(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={fetchNFTs} disabled={nftLoading}>
                {nftLoading ? ' Buscando...' : ' Buscar NFTs'}
              </button>
            </div>
            {nfts.length > 0 && (
              <div className="card">
                <h3>Coleção ({nfts.length})</h3>
                <div className="nft-grid">
                  {nfts.map(nft => (
                    <div key={nft.id} className="nft-card">
                      <div className="nft-img">{nft.image ? <img src={nft.image} alt={nft.name} /> : <img src="/icons/nft-placeholder.png" width={48} height={48} alt="nft" />}</div>
                      <div className="nft-info">
                        <div className="nft-name">{nft.name || `NFT #${nft.id}`}</div>
                        <div className="nft-id">{shortAddr(nft.id)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {nfts.length === 0 && !nftLoading && nftContractId && (
              <div className="card empty-nft"><span></span><p>Nenhum NFT encontrado.</p></div>
            )}
          </div>
        )}

        {/*  LABS  */}
        {activeView === 'labs' && (
          <div className="dev-mode card">
            <h3> Dev Tools</h3>
            <p className="labs-hint">Ferramenta para testar contratos na L3.</p>
            <div className="auto-sign-pill"> Auto-assinatura ativa</div>

            <div className="dev-section">
              <h4> Implantar Programa</h4>
              <input value={programName} onChange={e => setProgramName(e.target.value)} placeholder="Nome do programa" style={{marginBottom:12}} />
              <div className="code-area">
                <textarea value={contractCode} onChange={e => setContractCode(e.target.value)} rows={8} />
              </div>
              <button onClick={handleDeploy} className="btn-secondary" style={{marginTop:12}}>
                 Implantar
              </button>
            </div>

            <div className="dev-section">
              <h4>Executar Função</h4>
              <div className="function-input-group">
                <input value={callFunction} onChange={e => setCallFunction(e.target.value)} placeholder="Nome da função" />
                <input value={callParams} onChange={e => setCallParams(e.target.value)} placeholder="Parâmetros (separados por vírgula)" />
                <button onClick={handleCallContract} className="btn-run-contract">▶ Rodar Contrato</button>
              </div>
            </div>

            <div className="dev-section">
              <h4> Consultar Mapping</h4>
              <input value={mappingName} onChange={e => setMappingName(e.target.value)} placeholder="Nome do mapping" />
              <input value={mappingKey} onChange={e => setMappingKey(e.target.value)} placeholder="Chave (endereço)" style={{marginTop:10}} />
              <button onClick={handleQueryMapping} className="btn-secondary" style={{marginTop:10}}> Consultar</button>
              {mappingValue && <div className="mapping-result">Valor: {mappingValue}</div>}
            </div>
          </div>
        )}

        {/* ── Status Bar ── */}
        <div className={`status-bar status-${statusType}`}>
          {statusType === 'loading' && <span className="status-spinner" />}
          {status}
        </div>

      </div>
    </div>
  );
};

export default App;