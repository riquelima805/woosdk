import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as aleo from '@aleohq/sdk';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const SHELL_OPT = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : true;


async function runQuery(queryText, params = []) {
     const useSSL = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('sslmode=disable');
    const client = new pg.Client({
         connectionString: process.env.DATABASE_URL,
        ssl: useSSL ? { rejectUnauthorized: false } : false
    });
     await client.connect();
    try {
         return await client.query(queryText, params);
    } finally {
         await client.end();
    }
}



async function initDB() {
    try {
        await runQuery(`
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
        `);
        console.log(" Conectado. Tabelas de Dados prontas.");
    } catch (e) {
        console.error(" Erro ao criar tabelas:", e);
    }
}


function updateEnvFile(updates) {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    let envContent = fs.readFileSync(envPath, 'utf-8');
    let lines = envContent.split(/\r?\n/);
    let updated = false;

    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;

        const regex = new RegExp(`^${key}=.*`);
        let keyExists = false;

        lines = lines.map(line => {
            if (line.match(regex)) {
                keyExists = true;
                if (line !== `${key}=${value}`) {
                    updated = true;
                    return `${key}=${value}`;
                }
            }
            return line;
        });

        if (!keyExists) {
            lines.push(`${key}=${value}`);
            updated = true;
        }
    }

    if (updated) {
        fs.writeFileSync(envPath, lines.join('\n'));
        console.log(`.env atualizado!`);
    }
}

function findLeo() {
    try {
        const where = process.platform === 'win32' ? 'where' : 'which';
        const result = execSync(`${where} leo`, { encoding: 'utf-8', shell: SHELL_OPT });
        const leoPath = result.trim().split('\n')[0];
        if (leoPath && fs.existsSync(leoPath)) return leoPath;
    } catch (e) { }
    
    if (process.env.PATH) {
        const paths = process.env.PATH.split(path.delimiter);
        for (const p of paths) {
            const candidates = ['leo', 'leo.exe', 'leo.bat', 'leo.cmd'];
            for (const candidate of candidates) {
                const full = path.join(p, candidate);
                if (fs.existsSync(full)) return full;
            }
        }
    }
    return 'leo';
}

const LEO_CMD = findLeo();
console.log(` Usando comando 'leo' em: ${LEO_CMD}`);


class WooSDK {
    constructor(privateKey) {
        this.privateKey = privateKey;
        this.account = new aleo.Account({ privateKey });
        console.log(`🔹 Deployer (Admin Default): ${this.account.address().to_string()}`);
    }

    async spawnL3(chainId, gasTokenId) {
        console.log(`\n📦 Criando projeto L3 para Chain ID: ${chainId}...`);
        const programName = `woo_genesis_${chainId}.aleo`;
        
        
        const adminAddress = process.env.ADMIN_ADDRESS || 'aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3';
        
        
        const leoCode = `import credits.aleo;

program ${programName} {



    record NetworkState {
        owner: address,
        chain_id: u64,
        gas_token_id: u64,
        sequencer: address,
        last_batch_id: u64,
        last_state_root: field,
        is_paused: bool
    }

    record GasToken {
        owner: address,
        amount: u64,
        chain_id: u64
    }

    record ValidatorTicket {
        owner: address,
        staked_amount: u64,
        chain_id: u64
    }

    record BridgeReceipt {
        owner: address,
        amount: u64,
        token_id: u64,
        chain_id: u64
    }

    record BridgeOutReceipt {
        owner: address,
        amount: u64,
        fee_retained: u64,
        token_id: u64,
        chain_id: u64
    }

    record RollupBatch {
        owner: address,
        chain_id: u64,
        batch_id: u64,
        state_root: field,
        txs_hash: field
    }

   

    mapping authorized_relayers: address => bool;
    mapping authorized_vaults: address => bool;
    mapping is_initialized: u8 => bool;

    mapping roles: u8 => address;
    mapping bridge_stats: u8 => u64;
    mapping slashed_validators: address => bool;
    mapping validator_stakes: address => u64;
    mapping supported_chains: u64 => bool;

    @noupgrade
    constructor() {}

    

    fn transfer_admin(public new_admin: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
            roles.set(1u8, new_admin);
        };
    }

    fn accept_admin() -> Final {
        let caller_address: address = self.caller;
        return final {
            let pending_admin: address = roles.get(1u8);
            assert_eq(caller_address, pending_admin);
            roles.set(0u8, pending_admin);
            roles.remove(1u8);
        };
    }

  

    fn initialize_bridge(public mainnet_vault: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);

            let init_status: bool = is_initialized.get_or_use(0u8, false);
            assert_eq(init_status, false);

            is_initialized.set(0u8, true);
            authorized_vaults.set(mainnet_vault, true);
        };
    }

    fn spawn_chain(
        public chain_id: u64,
        public gas_token_id: u64,
        public sequencer: address
    ) -> (NetworkState, Final) {
        let state: NetworkState = NetworkState {
            owner: self.signer,
            chain_id,
            gas_token_id,
            sequencer,
            last_batch_id: 0u64,
            last_state_root: 0field,
            is_paused: false
        };

        let caller_address: address = self.caller;
        return (state, final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
            supported_chains.set(chain_id, true);
        });
    }

    fn pause_network(state: NetworkState) -> NetworkState {
        assert_eq(self.signer, state.owner);
        return NetworkState {
            owner: state.owner,
            chain_id: state.chain_id,
            gas_token_id: state.gas_token_id,
            sequencer: state.sequencer,
            last_batch_id: state.last_batch_id,
            last_state_root: state.last_state_root,
            is_paused: true
        };
    }

    fn unpause_network(state: NetworkState) -> NetworkState {
        assert_eq(self.signer, state.owner);
        return NetworkState {
            owner: state.owner,
            chain_id: state.chain_id,
            gas_token_id: state.gas_token_id,
            sequencer: state.sequencer,
            last_batch_id: state.last_batch_id,
            last_state_root: state.last_state_root,
            is_paused: false
        };
    }

    fn emergency_drain(
        public amount: u64,
        public admin_destination: address
    ) -> Final {
        assert(amount <= 100000000000u64);
        let caller_address: address = self.caller;
        let transfer_tx: Final = credits.aleo::transfer_public_as_signer(admin_destination, amount);

        return final {
            let is_valid_vault: bool = authorized_vaults.get_or_use(caller_address, false);
            assert_eq(is_valid_vault, true);

            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(admin_destination, current_admin);

            transfer_tx.run();
        };
    }

    

    fn commit_rollup(
        state: NetworkState,
        public chain_id: u64,
        public batch_id: u64,
        public state_root: field,
        public txs_hash: field
    ) -> (NetworkState, RollupBatch) {
        assert_eq(state.is_paused, false);
        assert_eq(self.signer, state.sequencer);
        assert_eq(state.chain_id, chain_id);

        let expected: u64 = state.last_batch_id + 1u64;
        assert_eq(batch_id, expected);

        let new_state: NetworkState = NetworkState {
            owner: state.owner,
            chain_id: state.chain_id,
            gas_token_id: state.gas_token_id,
            sequencer: state.sequencer,
            last_batch_id: batch_id,
            last_state_root: state_root,
            is_paused: false
        };

        let receipt: RollupBatch = RollupBatch {
            owner: self.signer,
            chain_id: state.chain_id,
            batch_id,
            state_root,
            txs_hash
        };

        return (new_state, receipt);
    }

    

    fn mint_gas(
        public chain_id: u64,
        public amount: u64,
        public receiver: address
    ) -> (GasToken, Final) {
        let token: GasToken = GasToken {
            owner: receiver,
            amount,
            chain_id
        };

        let caller_address: address = self.caller;
        return (token, final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
        });
    }

    fn stake_validator(
        public chain_id: u64,
        public stake_amount: u64,
        public vault: address
    ) -> (ValidatorTicket, Final) {
        let ticket: ValidatorTicket = ValidatorTicket {
            owner: self.signer,
            staked_amount: stake_amount,
            chain_id
        };

        let transfer_tx: Final = credits.aleo::transfer_public_as_signer(vault, stake_amount);
        let validator_address: address = self.signer;

        return (ticket, final {
            let is_valid_vault: bool = authorized_vaults.get_or_use(vault, false);
            assert_eq(is_valid_vault, true);

            let current_stake: u64 = validator_stakes.get_or_use(validator_address, 0u64);
            validator_stakes.set(validator_address, current_stake + stake_amount);

            transfer_tx.run();
        });
    }

    fn slash_validator(
        state: NetworkState,
        ticket: ValidatorTicket
    ) -> (NetworkState, Final) {
        assert_eq(self.signer, state.owner);
        assert_eq(ticket.chain_id, state.chain_id);
        let validator_address: address = ticket.owner;

        return (state, final {
            slashed_validators.set(validator_address, true);
        });
    }

    fn slash_and_seize(
        public validator_address: address,
        public destination: address,
        public vault: address
    ) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);

            let is_slashed: bool = slashed_validators.get_or_use(validator_address, false);
            assert_eq(is_slashed, true);

            let is_valid_vault: bool = authorized_vaults.get_or_use(vault, false);
            assert_eq(is_valid_vault, true);

            let stake: u64 = validator_stakes.get_or_use(validator_address, 0u64);
            assert(stake > 0u64);
            validator_stakes.set(validator_address, 0u64);
        };
    }

    fn authorize_relayer(public relayer: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
            authorized_relayers.set(relayer, true);
        };
    }

    fn revoke_relayer(public relayer: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = ${adminAddress};
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
            authorized_relayers.remove(relayer);
        };
    }

    fn bridge_in(
        public chain_id: u64,
        public token_id: u64,
        public amount: u64,
        public receiver: address,
        public vault: address
    ) -> (BridgeReceipt, Final) {
        assert(amount > 0u64);

        let receipt: BridgeReceipt = BridgeReceipt {
            owner: receiver,
            amount,
            token_id,
            chain_id
        };

        let transfer_tx: Final = credits.aleo::transfer_public_as_signer(vault, amount);

        return (receipt, final {
            let is_valid_vault: bool = authorized_vaults.get_or_use(vault, false);
            assert_eq(is_valid_vault, true);

            let is_valid_chain: bool = supported_chains.get_or_use(chain_id, false);
            assert_eq(is_valid_chain, true);

            let current_deposited: u64 = bridge_stats.get_or_use(0u8, 0u64);
            assert(current_deposited + amount >= current_deposited);
            bridge_stats.set(0u8, current_deposited + amount);

            transfer_tx.run();
        });
    }

    fn bridge_out(
        public chain_id: u64,
        public token_id: u64,
        public amount: u64,
        public fee: u64,
        public user_address: address
    ) -> (BridgeOutReceipt, Final) {
        assert_eq(token_id, 0u64);
        assert(amount > fee);

        let caller_address: address = self.caller;
        let net_amount: u64 = amount - fee;

        let receipt: BridgeOutReceipt = BridgeOutReceipt {
            owner: user_address,
            amount,
            fee_retained: fee,
            token_id,
            chain_id
        };

        let transfer_tx: Final = credits.aleo::transfer_public_as_signer(user_address, net_amount);

        return (receipt, final {
            let is_valid_vault: bool = authorized_vaults.get_or_use(caller_address, false);
            assert_eq(is_valid_vault, true);

            let is_valid_chain: bool = supported_chains.get_or_use(chain_id, false);
            assert_eq(is_valid_chain, true);

            let current_withdrawn: u64 = bridge_stats.get_or_use(1u8, 0u64);
            assert(current_withdrawn + amount >= current_withdrawn);
            bridge_stats.set(1u8, current_withdrawn + amount);

            transfer_tx.run();
        });
    }
}`;
        
        const templatesDir = path.join(__dirname, 'templates');
        const projectDir = path.join(templatesDir, programName.replace('.aleo', ''));

        if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
        if (!fs.existsSync(projectDir)) {
            execSync(`"${LEO_CMD}" new ${programName.replace('.aleo', '')}`, { cwd: templatesDir, stdio: 'inherit', shell: SHELL_OPT });
        }

        const programJsonPath = path.join(projectDir, 'program.json');
        if (fs.existsSync(programJsonPath)) {
            const pjson = JSON.parse(fs.readFileSync(programJsonPath, 'utf8'));
            
            if (!Array.isArray(pjson.dependencies)) {
                pjson.dependencies = [];
            }

            const hasCredits = pjson.dependencies.find(d => d.name === "credits.aleo");
            if (!hasCredits) {
                pjson.dependencies.push({
                    name: "credits.aleo",
                    location: "network",
                    network: "testnet"
                });
            }

            fs.writeFileSync(programJsonPath, JSON.stringify(pjson, null, 2));
            console.log("Dependência credits.aleo injetada.");
        }

        const srcDir = path.join(projectDir, 'src');
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'main.leo'), leoCode);

        const envContent = `PRIVATE_KEY=${this.privateKey}\nENDPOINT=${process.env.ENDPOINT || 'https://api.explorer.provable.com/v2'}\nNETWORK=${process.env.NETWORK || 'testnet'}`;
        fs.writeFileSync(path.join(projectDir, '.env'), envContent);

        console.log("Compilando e Deployando via CLI...");
        const cmd = `"${LEO_CMD}" deploy -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v1'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        const output = execSync(cmd, { cwd: projectDir, encoding: 'utf-8', shell: SHELL_OPT });
        const match = output.match(/transaction ID: '([^']+)'/);
        const txId = match ? match[1] : 'unknown';
        return { status: 'success', programName, txId };
    }

     async mintGas(chainId, amount, receiver) {
        const projectDir = path.join(__dirname, 'templates', `woo_genesis_${chainId}`);
        
        if (!fs.existsSync(projectDir)) {
            console.error(`\n Pasta do projeto '${projectDir}' não encontrada. Rode o deploy completo primeiro.`);
            return false;
        }

        const baseCmd = `"${LEO_CMD}" execute -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v1'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        try {
            console.log(`\n🪙 Mintando ${amount} de gas para ${receiver} na chain ${chainId}...`);
            const cmd = `${baseCmd} mint_gas ${chainId}u64 ${amount}u64 ${receiver}`;
            
            execSync(cmd, { cwd: projectDir, encoding: 'utf-8', stdio: 'inherit', shell: SHELL_OPT });
            
            console.log("\n Gás mintado com sucesso na mempool!");
            return true;
        } catch (err) {
            console.error("\n ERRO AO MINTAR GAS:", err.message);
            return false;
        }
    }

    async initializeL3(chainId, gasTokenId, sequencerAddress, initialSupply = 1000000, vaultAddress) {
        const projectDir = path.join(__dirname, 'templates', `woo_genesis_${chainId}`);
        
        if (!fs.existsSync(projectDir)) {
            console.error(`\n ERRO: pasta do projeto '${projectDir}' não existe!`);
            return null;
        }

        const baseCmd = `"${LEO_CMD}" execute -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v1'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        try {
            console.log(`\ Executando initialize_bridge para autorizar o cofre (${vaultAddress})...`);
            execSync(`${baseCmd} initialize_bridge ${vaultAddress}`, { cwd: projectDir, stdio: 'inherit', shell: SHELL_OPT });

            console.log("\n Executando spawn_chain...");
            const spawnOutput = execSync(`${baseCmd} spawn_chain ${chainId}u64 ${gasTokenId}u64 ${sequencerAddress}`, { cwd: projectDir, encoding: 'utf-8', shell: SHELL_OPT });
            
            console.log(`\n Executando mint_gas (Suprimento: ${initialSupply})...`);
            execSync(`${baseCmd} mint_gas ${chainId}u64 ${initialSupply}u64 ${sequencerAddress}`, { cwd: projectDir, stdio: 'inherit', shell: SHELL_OPT });
            
            const recordMatch = spawnOutput.match(/{\s*owner:[\s\S]*?_version:[\s\S]*?}/);
            if (recordMatch) {
                let newRecord = recordMatch[0].replace(/\n/g, '').replace(/\s+/g, '');
                
                
                await runQuery(
                    `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    ['network_record', JSON.stringify({ record: newRecord })]
                );
                await runQuery(
                    `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    ['batch_id', JSON.stringify({ id: 1 })]
                );

                console.log(`\nEstado Inicial salvo com sucesso no PostgreSQL!`);
            }

            updateEnvFile({ INITIAL_GAS_SUPPLY: initialSupply });

            return { status: 'success', message: 'rede iniciada!' };
        } catch (err) {
            console.error("\n ERRO DURANTE A INICIALIZAÇÃO DA REDE:", err.message);
            return null;
        }
    }


async bridgeIn(chainId, tokenId, amount, receiver, vaultAddress) {
        
        const projectDir = path.join(__dirname, 'templates', `woo_genesis_${chainId}`);
        
        if (!fs.existsSync(projectDir)) {
            console.error(`\n  Pasta do projeto '${projectDir}' não encontrada.`);
            console.error(`Para interagir com o contrato via Leo CLI, o projeto precisa estar na pasta templates/woo_genesis_${chainId}. Rode o deploy completo primeiro.`);
            return null;
        }

        const baseCmd = `"${LEO_CMD}" execute -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v1'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        try {
            console.log(`\n Iniciando bridge_in de ${amount} tokens (Token ID: ${tokenId}) para ${receiver}...`);
            
            
            const cmd = `${baseCmd} bridge_in ${chainId}u64 ${tokenId}u64 ${amount}u64 ${receiver} ${vaultAddress}`;
            
            
            execSync(cmd, { cwd: projectDir, encoding: 'utf-8', stdio: 'inherit', shell: SHELL_OPT });
            
            console.log("\nDepósito (bridge_in) enviado com sucesso para a mempool!");
            return true;
        } catch (err) {
            console.error("\n ERRO DURANTE O BRIDGE_IN:", err.message);
            return false;
        }
    }
}


const program = new Command();
program.name('woo-cli').description('CLI para L3 na Aleo').version('1.0.0');

function processOptionsAndSyncEnv(opts) {
    const pk = process.env.PRIVATE_KEY;
    const vault = process.env.VAULT_ADDRESS;
    
    if (!pk) {
        throw new Error('PRIVATE_KEY não definida! Adicione no .env.');
    }
    if (!vault) {
        throw new Error('VAULT_ADDRESS não definida! Adicione no .env.');
    }

    const envUpdates = {
        DEFAULT_CHAIN_ID: opts.chainId,
        DEFAULT_GAS_TOKEN_ID: opts.gasTokenId,
        L3_FOLDER_NAME: `woo_genesis_${opts.chainId}`
    };

    if (opts.sequencer) envUpdates.DEFAULT_SEQUENCER_ADDRESS = opts.sequencer;

    updateEnvFile(envUpdates);

    return { pk, vault };
}

program.command('full')
    .option('-c, --chain-id <number>', 'Chain ID', process.env.DEFAULT_CHAIN_ID)
    .option('-g, --gas-token-id <number>', 'Gas Token ID', process.env.DEFAULT_GAS_TOKEN_ID)
    .option('-s, --sequencer <address>', 'Sequenciador', process.env.DEFAULT_SEQUENCER_ADDRESS)
    .option('-m, --mint-supply <number>', 'Quantidade de Gás Inicial', '1000000')
    .action(async (opts) => {
        try {
            await initDB(); // Aguarda conectar e verificar as tabelas

            const { pk, vault } = processOptionsAndSyncEnv(opts);
            const sdk = new WooSDK(pk);
            
            const deploy = await sdk.spawnL3(parseInt(opts.chainId), parseInt(opts.gasTokenId));
            
            if (deploy?.status === 'success') {
                console.log(`\n Contrato ${deploy.programName} deployado! TX_ID: ${deploy.txId}`);
                await sdk.initializeL3(parseInt(opts.chainId), parseInt(opts.gasTokenId), opts.sequencer, parseInt(opts.mintSupply), vault);
            } else {
                console.error(' Deploy falhou!');
            }
        } catch (err) {
            console.error(" Erro fatal:", err);
        } finally {
            process.exit(0);
        }
    });

    program.command('bridge-in')
    .description('Faz o depósito (bridge_in) de tokens da L1 para a L3')
    .requiredOption('-a, --amount <number>', 'Quantidade de tokens para depositar')
    .requiredOption('-r, --receiver <address>', 'Endereço de quem vai receber na L3')
    .option('-c, --chain-id <number>', 'Chain ID da L3', process.env.DEFAULT_CHAIN_ID)
    .option('-t, --token-id <number>', 'ID do Token (Padrão: 0)', '0')
    .action(async (opts) => {
        try {
            const pk = process.env.PRIVATE_KEY;
            const vault = process.env.VAULT_ADDRESS;
            
            if (!pk) throw new Error('PRIVATE_KEY não definida! Adicione no .env.');
            if (!vault) throw new Error('VAULT_ADDRESS não definida! Adicione no .env.');
            if (!opts.chainId) throw new Error('Chain ID não definido. Passe via -c ou no .env como DEFAULT_CHAIN_ID.');

            // Inicializa o SDK
            const sdk = new WooSDK(pk);
            
            await sdk.bridgeIn(
                parseInt(opts.chainId), 
                parseInt(opts.tokenId), 
                parseInt(opts.amount), 
                opts.receiver, 
                vault
            );
            
        } catch (err) {
            console.error(" Erro fatal:", err.message);
        } finally {
        
            process.exit(0);
        }
    });

program.command('mint-gas')
    .description('Minta novos tokens de gas na L3')
    .requiredOption('-a, --amount <number>', 'Quantidade de gas a ser mintada')
    .requiredOption('-r, --receiver <address>', 'Endereço Aleo que vai receber o gas')
    .option('-c, --chain-id <number>', 'Chain ID da L3', process.env.DEFAULT_CHAIN_ID)
    .action(async (opts) => {
        try {
            const pk = process.env.PRIVATE_KEY;
            
            if (!pk) throw new Error('PRIVATE_KEY não definida! Adicione no .env.');
            if (!opts.chainId) throw new Error('Chain ID não definido. Passe via -c ou no .env como DEFAULT_CHAIN_ID.');

            const sdk = new WooSDK(pk);
            await sdk.mintGas(
                parseInt(opts.chainId),
                parseInt(opts.amount),
                opts.receiver
            );
        } catch (err) {
            console.error(" Erro fatal:", err.message);
        } finally {
            process.exit(0);
        }
    });

program.parse();
