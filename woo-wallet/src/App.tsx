import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PrivateKey } from '@aleohq/sdk';
import axios from 'axios';
import './App.css';


interface Token {
  address: string;
  symbol: string;
  decimals: number;
  balance?: string;
}

interface StoredData {
  rpcUrl: string;
  privateKey: string;
  tokens: Token[];
  simulationMode: boolean;
}


const NATIVE_TOKEN: Token = {
  address: 'native',
  symbol: 'WOO',
  decimals: 1,
};

const DEFAULT_RPC = 'http://localhost:8545';
const DEFAULT_PRIVATE_KEY = 'APrivateKey000';
const AMM_CONTRACT = 'amm_pair.aleo';

const loadStoredData = (): StoredData => {
  const stored = localStorage.getItem('adla_wallet_v10');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (!parsed.tokens || parsed.tokens.length === 0) {
        parsed.tokens = [NATIVE_TOKEN];
      }
      return parsed;
    } catch {  }
  }
  return {
    rpcUrl: DEFAULT_RPC,
    privateKey: DEFAULT_PRIVATE_KEY,
    tokens: [NATIVE_TOKEN],
    simulationMode: false,
  };
};

const saveStoredData = (data: StoredData) => {
  localStorage.setItem('adla_wallet_v10', JSON.stringify(data));
};


const App: React.FC = () => {
  const initialData = loadStoredData();
  const [rpcUrl, setRpcUrl] = useState<string>(initialData.rpcUrl);
  const [privateKey, setPrivateKey] = useState<string>(initialData.privateKey);
  const [tokens, setTokens] = useState<Token[]>(initialData.tokens);
  const [simulationMode, setSimulationMode] = useState<boolean>(initialData.simulationMode);

  const [address, setAddress] = useState<string>('');
  const [status, setStatus] = useState<string>(' Pronto');
  const [activeView, setActiveView] = useState<'wallet' | 'dex' | 'labs'>('wallet');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showAddToken, setShowAddToken] = useState<boolean>(false);
  const [masterPhrase, setMasterPhrase] = useState<string>('');

  
  const [newTokenAddress, setNewTokenAddress] = useState<string>('');
  const [newTokenSymbol, setNewTokenSymbol] = useState<string>('');
  const [newTokenDecimals, setNewTokenDecimals] = useState<string>('6');

  
  const [selectedToken, setSelectedToken] = useState<Token>(NATIVE_TOKEN);
  const [toAddress, setToAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  
  const [dexTokenX, setDexTokenX] = useState<string>('token13.aleo');
  const [dexAmountX, setDexAmountX] = useState<string>('');
  const [dexTokenY, setDexTokenY] = useState<string>('token11.aleo');
  const [dexAmountY, setDexAmountY] = useState<string>('');
  const [dexSwapAmount, setDexSwapAmount] = useState<string>('');

const [dexReserveX, setDexReserveX] = useState<number>(0);
const [dexReserveY, setDexReserveY] = useState<number>(0);
const [estimatedSwapOut, setEstimatedSwapOut] = useState<string>('');

  
  const [programName, setProgramName] = useState<string>('token11');
  const [contractCode, setContractCode] = useState<string>(`program token11.aleo {
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
  const [callFunction, setCallFunction] = useState<string>('mint_public');
  const [callParams, setCallParams] = useState<string>('');
  const [mappingName, setMappingName] = useState<string>('account');
  const [mappingKey, setMappingKey] = useState<string>('');
  const [mappingValue, setMappingValue] = useState<string>('');

  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);

  
  useEffect(() => {
    try {
      const pk = PrivateKey.from_string(privateKey);
      setAddress(pk.to_address().to_string());
    } catch {
      setAddress('Chave inválida');
    }
  }, [privateKey]);



  
  useEffect(() => {
    saveStoredData({ rpcUrl, privateKey, tokens, simulationMode });
  }, [rpcUrl, privateKey, tokens, simulationMode]);

  
  const fetchAllBalances = useCallback(async (force = false, currentTokens = tokens) => {
    if (!address || isFetchingRef.current) return;
    const now = Date.now();
    if (!force && now - lastFetchTimeRef.current < 3000) return;

    isFetchingRef.current = true;
    setStatus(' Atualizando saldos...');

    try {
      if (simulationMode) {
        const updatedTokens = currentTokens.map(token => ({
          ...token,
          balance: (Math.random() * 1000).toFixed(token.decimals).toString()
        }));
        setTokens(updatedTokens);
        setStatus(' Saldos simulados atualizados');
      } else {
        const updatedTokens = await Promise.all(
          currentTokens.map(async (token) => {
            try {
              const res = await axios.post(rpcUrl, {
                jsonrpc: '2.0',
                method: token.address === 'native' ? 'woo_getBalance' : 'woo_getTokenBalance',
                params: token.address === 'native' ? [address] : [address, token.address],
                id: 1,
              });
              return { ...token, balance: String(res.data.result || '0') };
            } catch (err) {
              console.warn(`Erro ao buscar saldo de ${token.symbol}:`, err);
              return { ...token, balance: 'Erro' };
            }
          })
        );
        setTokens(updatedTokens);
        setStatus(' Saldos atualizados da rede');
      }
      lastFetchTimeRef.current = Date.now();
    } catch (e) {
      setStatus(' Falha ao buscar saldos');
      console.error(e);
    } finally {
      isFetchingRef.current = false;
    }
  }, [address, rpcUrl, simulationMode, tokens]);

  useEffect(() => {
    if (address) {
      fetchAllBalances(true);
    }
  }, [address, rpcUrl, simulationMode]);


  const fetchReserves = useCallback(async () => {
    if (!dexTokenX || !dexTokenY || simulationMode) return;
    try {
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            method: 'woo_getReserves',
            params: [dexTokenX, dexTokenY],
            id: 1,
        });
        if (res.data.result) {
            setDexReserveX(Number(res.data.result.reserveX));
            setDexReserveY(Number(res.data.result.reserveY));
        }
    } catch (e) {
        console.warn('Erro ao buscar reservas da DEX', e);
    }
}, [rpcUrl, dexTokenX, dexTokenY, simulationMode]);

useEffect(() => {
    fetchReserves();
}, [fetchReserves]);

  
  const formatBalance = (token: Token | undefined): string => {
    if (!token?.balance || token.balance === 'Erro') return '0.00';
    try {
      const val = BigInt(token.balance);
      const divisor = 10n ** BigInt(token.decimals);
      const integer = val / divisor;
      const fractional = val % divisor;
      const fracStr = fractional.toString().padStart(token.decimals, '0').slice(0, 6);
      return `${integer}.${fracStr}`;
    } catch {
      return token.balance;
    }
  };

  const getKnownTokenBalance = (addressId: string) => {
    const t = tokens.find(t => t.address === addressId);
    return t ? formatBalance(t) : 'Token não adicionado';
  };

  
  const handleAddToken = async () => {
    if (!newTokenAddress || !newTokenSymbol) {
      setStatus(' Preencha endereço e símbolo');
      return;
    }
    const existing = tokens.find(t => t.address === newTokenAddress);
    if (existing) {
      setStatus(' Token já adicionado');
      return;
    }
    const decimals = parseInt(newTokenDecimals) || 6;
    const newToken: Token = {
      address: newTokenAddress,
      symbol: newTokenSymbol,
      decimals,
    };
    const newTokens = [...tokens, newToken];
    setTokens(newTokens);
    setNewTokenAddress('');
    setNewTokenSymbol('');
    setNewTokenDecimals('6');
    setShowAddToken(false);
    setStatus(` ${newTokenSymbol} adicionado`);
    setTimeout(() => fetchAllBalances(true, newTokens), 100);
  };

  // ---------- Send Transaction ----------
  const handleSend = async () => {
    if (!toAddress || !amount) {
      setStatus(' Preencha todos os campos');
      return;
    }
    if (simulationMode) {
      setStatus(' Simulação: transação enviada!');
      setToAddress('');
      setAmount('');
      setTimeout(() => fetchAllBalances(true), 1500);
      return;
    }

    setStatus(' Assinando e enviando...');
    try {
      const nonceRes = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_getNonce',
        params: [address],
        id: 1,
      });
      const nonce = nonceRes.data.result ?? 0;
      const pk = PrivateKey.from_string(privateKey);

      const cleanAmount = amount.replace(',', '.');
      const numericAmount = Math.floor(parseFloat(cleanAmount) * (10 ** selectedToken.decimals));

      let res;
      if (selectedToken.address === 'native') {
        const message = new TextEncoder().encode(`${address}:${toAddress}:${numericAmount}:${nonce}`);
        const signature = pk.sign(message).to_string();
        res = await axios.post(rpcUrl, {
          jsonrpc: '2.0',
          method: 'woo_sendTransaction',
          params: [{
            from: address,
            to: toAddress,
            amount: numericAmount,
            signature,
            nonce,
          }],
          id: 1,
        });
      } else {
        const formattedAmount = `${numericAmount}u64`;
        const message = new TextEncoder().encode(`${address}:${selectedToken.address}:${toAddress}:${formattedAmount}:${nonce}`);
        const signature = pk.sign(message).to_string();
        res = await axios.post(rpcUrl, {
          jsonrpc: '2.0',
          method: 'woo_sendTokenTransaction',
          params: [{
            from: address,
            tokenId: selectedToken.address,
            to: toAddress,
            amount: formattedAmount,
            signature,
            nonce,
          }],
          id: 1,
        });
      }

      if (res?.data.error) {
        setStatus(` Erro: ${JSON.stringify(res.data.error)}`);
      } else {
        setStatus(` Enviado! TX: ${res.data.result?.txId || 'sucesso'}`);
        setToAddress('');
        setAmount('');
        setTimeout(() => fetchAllBalances(true), 2000);
      }
    } catch (e) {
      setStatus(' Transação falhou');
      console.error(e);
    }
  };

  
  const handleDexAction = async (action: 'deposit' | 'withdraw' | 'swap', side: 'x' | 'y') => {
    let rawAmount = '';
    if (action === 'swap') rawAmount = dexSwapAmount;
    else if (side === 'x') rawAmount = dexAmountX;
    else rawAmount = dexAmountY;

    if (!rawAmount || parseFloat(rawAmount.replace(',', '.')) <= 0) {
      setStatus(' Digite uma quantidade válida');
      return;
    }

    setStatus(` Processando ${action.toUpperCase()} na DEX...`);
    try {
      const nonceRes = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_getNonce',
        params: [address],
        id: 1,
      });
      const nonce = nonceRes.data.result ?? 0;

      const cleanAmount = rawAmount.replace(',', '.');
      const numericAmount = Math.floor(parseFloat(cleanAmount) * 1_000_000);
      const formattedAmount = `${numericAmount}u64`;

      let functionName = '';
      let inputs: string[] = [];

      if (action === 'deposit') {
        functionName = `deposit_${side}`;
        inputs = [side === 'x' ? dexTokenX : dexTokenY, formattedAmount];
      } else if (action === 'withdraw') {
        functionName = `withdraw_${side}`;
        inputs = [side === 'x' ? dexTokenX : dexTokenY, formattedAmount];
      } else if (action === 'swap') {
        functionName = side === 'x' ? 'swap_x_for_y' : 'swap_y_for_x';
        inputs = [dexTokenX, dexTokenY, formattedAmount, "0u64"];
      }

      const pk = PrivateKey.from_string(privateKey);
      const message = new TextEncoder().encode(`${address}:${AMM_CONTRACT}:${functionName}:EXECUTE:${nonce}`);

      const res = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_executeContract',
        params: [{
          from: address,
          contractName: AMM_CONTRACT,
          functionName,
          inputs,
          signature: pk.sign(message).to_string(),
          nonce,
        }],
        id: 1,
      });

      if (res.data.error) {
        setStatus(` Erro: ${res.data.error}`);
      } else {
        setStatus(` Sucesso!`);
        if (action === 'swap') setDexSwapAmount('');
        else if (side === 'x') setDexAmountX('');
        else setDexAmountY('');
        setTimeout(() => fetchAllBalances(true), 2000);
      }
    } catch (e) {
      setStatus(' Execução falhou');
      console.error(e);
    }
  };

  useEffect(() => {
    if (!dexSwapAmount || dexReserveX === 0 || dexReserveY === 0) {
        setEstimatedSwapOut('');
        return;
    }

    const amountIn = parseFloat(dexSwapAmount.replace(',', '.'));
    if (isNaN(amountIn) || amountIn <= 0) {
        setEstimatedSwapOut('');
        return;
    }

  

    const amountInWithFee = amountIn * 997;
    const numerator = amountInWithFee * dexReserveY;
    const denominator = dexReserveX * 1000 + amountInWithFee;
    const amountOut = numerator / denominator;

    setEstimatedSwapOut(amountOut.toFixed(6));
}, [dexSwapAmount, dexReserveX, dexReserveY]);

  
  const handleDeploy = async () => {
    if (simulationMode) {
      setStatus(' Simulação: programa implantado!');
      return;
    }
    setStatus(' Implantando programa...');
    try {
      const nonceRes = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_getNonce',
        params: [address],
        id: 1,
      });
      const nonce = nonceRes.data.result ?? 0;
      const pk = PrivateKey.from_string(privateKey);
      const message = new TextEncoder().encode(`${address}:${programName}.aleo:DEPLOY:${nonce}`);

      const res = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_deployContract',
        params: [{
          from: address,
          contractName: `${programName}.aleo`,
          leoCode: contractCode,
          signature: pk.sign(message).to_string(),
          nonce,
        }],
        id: 1,
      });

      if (res.data.error) {
        setStatus(` Erro: ${JSON.stringify(res.data.error)}`);
      } else {
        setStatus(` Programa ${programName}.aleo implantado!`);
      }
    } catch (e) {
      setStatus(' Implantação falhou');
      console.error(e);
    }
  };

  
  const handleCallContract = async () => {
    if (simulationMode) {
      setStatus(' Simulação: função executada!');
      setTimeout(() => fetchAllBalances(true), 1500);
      return;
    }
    setStatus(' Executando função...');
    try {
      const nonceRes = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_getNonce',
        params: [address],
        id: 1,
      });
      const nonce = nonceRes.data.result ?? 0;
      const fullProgramName = `${programName}.aleo`;
      const cleanInputs = callParams.split(',').map(s => s.trim()).filter(s => s !== '');
      const pk = PrivateKey.from_string(privateKey);
      const message = new TextEncoder().encode(`${address}:${fullProgramName}:${callFunction}:EXECUTE:${nonce}`);

      const res = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_executeContract',
        params: [{
          from: address,
          contractName: fullProgramName,
          functionName: callFunction,
          inputs: cleanInputs,
          signature: pk.sign(message).to_string(),
          nonce,
        }],
        id: 1,
      });

      if (res.data.error) {
        setStatus(` Erro: ${JSON.stringify(res.data.error)}`);
      } else {
        setStatus(` Função ${callFunction} executada!`);
        setTimeout(() => fetchAllBalances(true), 2000);
      }
    } catch (e) {
      setStatus(' Execução falhou');
      console.error(e);
    }
  };

  
  const handleQueryMapping = async () => {
    if (!mappingKey) return;
    if (simulationMode) {
      setMappingValue('999u64 (simulado)');
      setStatus(' Valor simulado obtido');
      return;
    }
    setStatus(' Consultando mapping...');
    try {
      const res = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'woo_getMappingValue',
        params: [`${programName}.aleo`, mappingName, mappingKey],
        id: 1,
      });
      if (res.data.error) {
        setStatus(` Erro: ${JSON.stringify(res.data.error)}`);
        setMappingValue('');
      } else {
        setMappingValue(res.data.result ?? 'null');
        setStatus(' Valor do mapping obtido');
      }
    } catch (e) {
      setStatus(' Consulta falhou');
      console.error(e);
    }
  };

  
  const selectedTokenBalance = selectedToken ? formatBalance(selectedToken) : '0.00';

  return (
    <div className="app-container">
      <div className="wrapper">
        {/* Header */}
        <header className="header">
          <h2 className="logo">
            <img src="/wallet.png" alt="wallet" style={{ width: '32px', height: '32px' }} />
            WOOsdk <span>WALLET</span>
          </h2>
          <div className="header-actions">
            <button className={`mode-btn ${activeView === 'wallet' ? 'active' : ''}`} onClick={() => setActiveView('wallet')}>
              <img src="/wallet.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> Carteira
            </button>
            <button className={`mode-btn ${activeView === 'dex' ? 'active' : ''}`} onClick={() => setActiveView('dex')}>
              <img src="/swap.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> DEX
            </button>
            <button className={`mode-btn ${activeView === 'labs' ? 'active' : ''}`} onClick={() => setActiveView('labs')}>
              <img src="/developer.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> LABS
            </button>
            <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
              <img src="/settings.png" alt="settings" style={{ width: '22px' }} />
            </button>
          </div>
        </header>

        {/* Settings */}
        {showSettings && (
          <div className="settings-panel card">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img src="/antena.png" alt="rpc" style={{ width: '24px' }} /> URL RPC Personalizada
            </label>
            <input type="text" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} placeholder="http://localhost:8545" />
            <label>Chave Privada</label>
            <input type="password" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
            <div className="address-display">Endereço: {address.slice(0, 15)}...{address.slice(-8)}</div>
            <label style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={simulationMode}
                onChange={(e) => setSimulationMode(e.target.checked)}
              />
              Modo Simulação
            </label>
          </div>
        )}

        {/* WALLET */}
        {activeView === 'wallet' && (
          <div className="wallet-mode">
            {/* Balance*/}
            <div className="balance-card card">
              <div className="balance-label">Saldo Total</div>
              <div className="balance-value">
                {formatBalance(tokens[0] || NATIVE_TOKEN)} <small>{tokens[0]?.symbol || 'WOO'}</small>
              </div>
              <div className="action-buttons">
                <button className="action-btn" onClick={() => document.querySelector<HTMLInputElement>('.send-card input')?.focus()}>
                  <img src="/enviar.png" alt="enviar" style={{ width: '20px', marginRight: '8px' }} /> Enviar
                </button>
                <button className="action-btn primary-action" onClick={() => navigator.clipboard?.writeText(address)}>
                  <img src="/receber.png" alt="receber" style={{ width: '20px', marginRight: '8px', filter: 'brightness(0) invert(1)' }} /> Receber
                </button>
              </div>
            </div>

            {/* Phrase */}
            <div className="master-phrase-card">
              <div className="master-phrase-title">
                <img src="/robo.png" alt="security" style={{ width: '24px' }} /> Proteja sua Wallet
              </div>
              <input
                type="password"
                className="master-phrase-input"
                placeholder="Digite sua Frase Mestra"
                value={masterPhrase}
                onChange={(e) => setMasterPhrase(e.target.value)}
              />
            </div>

            {/* List */}
            <div className="tokens-card card">
              <div className="card-header">
                <h3>Seus Ativos</h3>
                <button className="add-token-btn" onClick={() => setShowAddToken(!showAddToken)}>+ Adicionar Token</button>
              </div>
              {showAddToken && (
                <div className="add-token-form">
                  <input placeholder="Endereço do Token (ex: token11.aleo)" value={newTokenAddress} onChange={(e) => setNewTokenAddress(e.target.value)} />
                  <input placeholder="Símbolo (ex: TK11)" value={newTokenSymbol} onChange={(e) => setNewTokenSymbol(e.target.value)} />
                  <input placeholder="Decimais" type="number" value={newTokenDecimals} onChange={(e) => setNewTokenDecimals(e.target.value)} />
                  <button onClick={handleAddToken} className="btn-primary small">Adicionar</button>
                </div>
              )}
              <div className="token-list">
                {tokens.map((token) => (
                  <div
                    key={token.address}
                    className={`token-item ${selectedToken.address === token.address ? 'selected' : ''}`}
                    onClick={() => setSelectedToken(token)}
                  >
                    <div className="token-left">
                      <div className="token-icon">
                        <img src="/coin.png" alt="token" />
                      </div>
                      <div className="token-info">
                        <span className="token-symbol">{token.symbol}</span>
                        <span className="token-name">{token.address === 'native' ? 'Native' : token.address.slice(0, 12) + '...'}</span>
                      </div>
                    </div>
                    <div className="token-right">
                      <div className="token-balance">{formatBalance(token)}</div>
                      <div className="token-fiat">≈ $0.00</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => fetchAllBalances(true)} className="btn-secondary" style={{ marginTop: '16px' }}>
                <img src="/done.png" alt="refresh" style={{ width: '18px', marginRight: '8px' }} /> Atualizar Saldos
              </button>
            </div>

            {/* Send */}
            <div className="send-card card">
              <h3>Enviar {selectedToken.symbol}</h3>
              <div className="send-form-group">
                <label>Endereço do Destinatário</label>
                <input
                  className="send-input"
                  placeholder="aleo1..."
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                />
              </div>
              <div className="send-form-group">
                <label>Quantidade</label>
                <input
                  className="send-input"
                  type="text"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="available-balance">
                <span>Saldo Disponível</span>
                <span>{selectedTokenBalance} {selectedToken.symbol}</span>
              </div>
              <button onClick={handleSend} className="btn-sign-teleport">
                <img src="/assinar.png" alt="assinar" /> Assinar e Enviar
              </button>
            </div>
          </div>
        )}

        {/* DEX */}
        {activeView === 'dex' && (
          <div className="dex-mode">
            <div className="card dex-info-card">
              <div className="dex-header">
                <img src="/galaxy.png" alt="galaxy" />
                <h3> Cofre da DEX</h3>
              </div>
              <p style={{ fontSize: '14px', color: '#1e1e2a', marginBottom: '16px' }}>
                Mova fundos para a DEX antes de fazer swap.
              </p>

              <div className="dex-grid">
                <div className="dex-box">
                  <h4><img src="/coin.png" alt="" style={{ width: '20px' }} /> Token X</h4>
                  <input className="send-input" value={dexTokenX} onChange={(e) => setDexTokenX(e.target.value)} placeholder="ID do Token X" />
                  <div style={{ fontSize: '12px', color: '#5e6c7c', margin: '4px 0 8px' }}>Saldo Global: {getKnownTokenBalance(dexTokenX)}</div>
                  <input className="send-input" type="text" placeholder="Quantia (ex: 0.05)" value={dexAmountX} onChange={(e) => setDexAmountX(e.target.value)} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn-secondary" onClick={() => handleDexAction('deposit', 'x')}>
                      <img src="/depositarx.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> Depositar X
                    </button>
                    <button className="btn-secondary" onClick={() => handleDexAction('withdraw', 'x')}>
                      <img src="/sacarx.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> Sacar X
                    </button>
                  </div>
                </div>

                <div className="dex-box">
                  <h4><img src="/coin.png" alt="" style={{ width: '20px' }} /> Token Y</h4>
                  <input className="send-input" value={dexTokenY} onChange={(e) => setDexTokenY(e.target.value)} placeholder="ID do Token Y" />
                  <div style={{ fontSize: '12px', color: '#5e6c7c', margin: '4px 0 8px' }}>Saldo Global: {getKnownTokenBalance(dexTokenY)}</div>
                  <input className="send-input" type="text" placeholder="Quantia (ex: 50)" value={dexAmountY} onChange={(e) => setDexAmountY(e.target.value)} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn-secondary" onClick={() => handleDexAction('deposit', 'y')}>
                      <img src="/depositary.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> Depositar Y
                    </button>
                    <button className="btn-secondary" onClick={() => handleDexAction('withdraw', 'y')}>
                      <img src="/sacary.png" alt="" style={{ width: '18px', marginRight: '6px' }} /> Sacar Y
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card swap-card">
      <h3><img src="/swap.png" alt="swap" style={{ width: '24px', marginRight: '8px' }} /> Swap</h3>
      <div className="send-form-group">
        <label>Quantidade a Trocar</label>
        <input
          className="send-input swap-input"
          type="text"
          placeholder="Ex: 0.05"
          value={dexSwapAmount}
          onChange={(e) => setDexSwapAmount(e.target.value)}
        />
      </div>
      {estimatedSwapOut && (
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#1e1e2a', fontWeight: 500 }}>
           Estimativa: <strong>{estimatedSwapOut} {dexTokenY.split('.')[0]}</strong>
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button className="btn-sign-teleport" onClick={() => handleDexAction('swap', 'x')} style={{ background: '#1e1e2a' }}>
          <img src="/swapx-y.png" alt="" style={{ width: '20px', filter: 'brightness(0) invert(1)' }} /> X ➔ Y
        </button>
        <button className="btn-sign-teleport" onClick={() => handleDexAction('swap', 'y')} style={{ background: '#1e1e2a' }}>
          <img src="/swapy-x.png" alt="" style={{ width: '20px', filter: 'brightness(0) invert(1)' }} /> Y ➔ X
        </button>
      </div>
    </div>
  </div>
)}

        {}
        {activeView === 'labs' && (
          <div className="dev-mode card">
            <h3>
              <img src="/robo.png" alt="robo" /> Área de Desenvolvedor (LABS)
            </h3>


            <div className="dev-section">
              <h4>Implantar Programa</h4>
              <input value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="Nome do programa" style={{ marginBottom: '12px' }} />
              <div className="code-area">
                <textarea
                  value={contractCode}
                  onChange={(e) => setContractCode(e.target.value)}
                  rows={8}
                />
              </div>
              <button onClick={handleDeploy} className="btn-secondary" style={{ marginTop: '12px' }}>
                <img src="/implantar.png" alt="implantar" style={{ width: '20px', marginRight: '8px' }} /> Implantar Programa
              </button>
            </div>

            <div className="dev-section">
              <h4>Executar Função</h4>
              <div className="function-input-group">
                <input value={callFunction} onChange={(e) => setCallFunction(e.target.value)} placeholder="Nome da função" />
                <input value={callParams} onChange={(e) => setCallParams(e.target.value)} placeholder="Parâmetros (ex: aleo1abc..., 100u64)" />
                <button onClick={handleCallContract} className="btn-run-contract">
                  <img src="/rodar.png" alt="rodar" style={{ width: '20px', marginRight: '8px' }} /> Rodar contrato
                </button>
              </div>
            </div>

            <div className="dev-section">
              <h4>Consultar Mapping</h4>
              <input value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder="Nome do mapping" />
              <input value={mappingKey} onChange={(e) => setMappingKey(e.target.value)} placeholder="Chave (endereço)" style={{ marginTop: '10px' }} />
              <button onClick={handleQueryMapping} className="btn-secondary" style={{ marginTop: '10px' }}>
                <img src="/consultar.png" alt="consultar" style={{ width: '20px', marginRight: '8px' }} /> Consultar
              </button>
              {mappingValue && (
                <div className="mapping-result">
                  Valor: {mappingValue}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status Bar */}
        <div className="status-bar">{status}</div>
      </div>
    </div>
  );
};

export default App;