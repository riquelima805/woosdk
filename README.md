# woosdk

PT - BR

Woosdk e uma solução para devs criarem layer 3 facilmente sobre a Aleo. 

Estrutura de nosso sdk. 

Contrato Gênesis na L1: Âncora os lotes , staking e ponte.

Nó L3: Mantém o estado local da layer 3 , e atua como sequenciador.

Zk prover: gera e verifica provas zero-knowledge para as transações.

Cli: ferramenta para gerenciar e criar novas chains.


Wallet: Interage com a L3 , Rpc customizado, transferências , dex , deploy de contratos. 

requisitos

Node.js:	18+	 nodejs.org
Rust:	1.70+	 rustup.rs
Leo:	≥ 2.0.0	 developer.aleo.org/leo

adicione o leo no patch

instalar

git clone https://github.com/riquelima805/woosdk.git

cd woosdk

intale a dependecias. 

em woosdk:

npm install

intale da wallet

cd woo-wallet

npm install

intale do zk

cd ..
cd zk-prover
cargo run build

.. retorne a pasta woosdk adicione uma chave privada no .env precia ter creditos na tet net pegue aqui:
https://faucet.aleo.org/

ainda em woosdk de o comando para o cli ele ira imprementar mintar a moeda de gas inicial e ativar a rede.. 



