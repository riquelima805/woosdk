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

node cli.mjs full --chain-id 888 --gas-token-id 1 --sequencer aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3

mude a chin id. mude o endereço de sequencer esse sera o mesmo usado como valt da ponte tambem.. 

 rode o rpc pelo comando.. npx tsx src\rpc.ts. em outro terminal va em woosdk\zk-prover . de cargo run --release 

 em outro terminal va em woo-wallet de npm run dev. 

 voce pode ubir contato de tokens tete na wallet e chamar a funçao mint .. tabm pode adicionar 2 tokens na parte defi um x e um y depoitar e depoi chaamara a funçao de liuidez do ctt. por enuanto o valt o cerve para 2 tokens.. 

 



