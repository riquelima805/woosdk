# woosdk

![Banner WooSDK](./assets/logo.png)

PT - BR

WooSDK é uma solução para desenvolvedores criarem Layer 3 de forma simplificada sobre a rede Aleo.

Estrutura do SDK

Contrato Gênesis (L1): Responsável por ancorar os lotes, gerenciar o staking e realizar a ponte.

Nó L3: Mantém o estado local da Layer 3 e atua como o sequenciador da rede.

ZK Prover: Gera e verifica as provas de conhecimento zero (Zero-Knowledge Proofs) para as transações.

CLI: Ferramenta de linha de comando para gerenciar e criar novas chains.

Wallet: Interface para interagir com a L3, com suporte a RPC customizado, transferências, DEX e deploy de contratos.


requisitos

Node.js: v18+ (nodejs.org)

Rust: v1.70+ (rustup.rs)

Leo: ≥ v2.0.0 (developer.aleo.org/leo)

Nota: adicione o executável do Leo ao seu PATH.



instalar

```bash
git clone https://github.com/riquelima805/woosdk.git
cd woosdk
npm install
```

Instale as dependências. 

em woosdk:

```bash
npm install
```

Instale as dependências da Wallet

```bash
cd woo-wallet
npm install
```

Prepare o ZK-Prover:

```bash
cd ../zk-prover
cargo build
```

Configuração de Ambiente:
Retorne à pasta raiz (woosdk) e adicione sua chave privada no arquivo .env.
Você precisa de créditos na Testnet. Obtenha-os aqui: faucet.aleo.org


Implementar a Rede via CLI:
Este comando irá implementar o sistema, realizar o mint da moeda de gas inicial e ativar a rede.

```bash
node cli.mjs full --chain-id 888 --gas-token-id 1 --sequencer <ENDEREÇO_DO_SEQUENCER>
```

Importante: Mude o chain-id e o endereço do sequencer. O endereço do sequencer será o mesmo utilizado como Vault da ponte.


Rodar os Serviços:


RPC: Em um terminal na raiz: npx tsx src/rpc.ts

ZK-Prover: No terminal em woosdk/zk-prover: cargo run --release

Wallet: No terminal em woo-wallet: npm run dev


Testando as Funcionalidades

Tokens e DeFi: Na wallet, você pode fazer deploy de tokens de teste e chamar a função mint. Na seção DeFi, é possível adicionar dois tokens (X e Y), depositar e chamar a função de liquidez do contrato. Atualmente, o Vault suporta dois tokens.

Bridge (L1 → L3):
Para enviar Aleo Testnet para a L3 (gerando Wrapped Aleo), utilize o comando na pasta templates do seu contrato gênesis:

```bash
leo execute bridge_in 2011u64 1u64 5000000u64 <ENDEREÇO_L1_RECEBER> <ENDEREÇO_VAULT> --broadcast --network testnet --endpoint "https://api.explorer.aleo.org/v1/testnet3" --private-key "SUA_CHAVE"
```

Observações de Desenvolvimento

Atualmente, a bridge aceita qualquer endereço como Vault; isso será restrito em atualizações futuras.

O RPC, por enquanto, contabiliza apenas os dados passados pelo proprietário  como Vault.

A implementação de autenticação (Auth) na L3 ainda está em desenvolvimento.

 



