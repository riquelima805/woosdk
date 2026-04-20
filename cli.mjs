
import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as aleo from '@aleohq/sdk';
import { Level } from 'level';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const SHELL_OPT = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : true;


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
        console.log(` Deployer: ${this.account.address().to_string()}`);
    }

    async spawnL3(chainId, gasTokenId) {
        console.log(`\n criando ${chainId}...`);
        const programName = `woo_genesis_${chainId}.aleo`;
        
        
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

    
    @noupgrade
    constructor() {}

    
    fn spawn_chain(
        public chain_id: u64,
        public gas_token_id: u64,
        public sequencer: address
    ) -> NetworkState {
        return NetworkState {
            owner: self.signer,
            chain_id,
            gas_token_id,
            sequencer,
            last_batch_id: 0u64,
            last_state_root: 0field,
            is_paused: false
        };
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

    fn commit_rollup(
        state: NetworkState,
        public batch_id: u64,
        public state_root: field,
        public txs_hash: field
    ) -> (NetworkState, RollupBatch) {
        assert_eq(state.is_paused, false);
        assert_eq(self.signer, state.sequencer);

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
    ) -> GasToken {
        return GasToken {
            owner: receiver,
            amount,
            chain_id
        };
    }

    fn stake_validator(
        public chain_id: u64,
        public stake_amount: u64
    ) -> ValidatorTicket {
        return ValidatorTicket {
            owner: self.signer,
            staked_amount: stake_amount,
            chain_id
        };
    }

    fn slash_validator(
        state: NetworkState,
        ticket: ValidatorTicket
    ) -> NetworkState {
        assert_eq(self.signer, state.owner);
        assert_eq(ticket.chain_id, state.chain_id);
        return state;
    }

    
    fn authorize_relayer(
        public relayer: address
    ) -> Final {
        let owner_address: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
        assert_eq(self.caller, owner_address);

        return final {
            authorized_relayers.set(relayer, true);
        };
    }

    fn revoke_relayer(
        public relayer: address
    ) -> Final {
        let owner_address: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
        assert_eq(self.caller, owner_address);

        return final {
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
            transfer_tx.run();
        });
    }

    
    fn bridge_out(
        public chain_id: u64,
        public token_id: u64,
        public amount: u64,
        public user_address: address
    ) -> BridgeOutReceipt {
        assert(amount > 0u64);
        return BridgeOutReceipt {
            owner: user_address,
            amount,
            token_id,
            chain_id
        };
    }
}`;
        
        const templatesDir = path.join(__dirname, 'templates');
        const projectDir = path.join(templatesDir, `woo_genesis_${chainId}`);

        if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
        if (!fs.existsSync(projectDir)) {
            execSync(`"${LEO_CMD}" new woo_genesis_${chainId}`, { cwd: templatesDir, stdio: 'inherit', shell: SHELL_OPT });
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
            console.log("Dependência credits.aleo injetada com sucesso no manifesto.");
        }

        const srcDir = path.join(projectDir, 'src');
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'main.leo'), leoCode);

        const envContent = `PRIVATE_KEY=${this.privateKey}\nENDPOINT=${process.env.ENDPOINT || 'https://api.explorer.provable.com/v2'}\nNETWORK=${process.env.NETWORK || 'testnet'}`;
        fs.writeFileSync(path.join(projectDir, '.env'), envContent);

        console.log(" Compilando e Deployando via CLI...");
        const cmd = `"${LEO_CMD}" deploy -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v2'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        const output = execSync(cmd, { cwd: projectDir, encoding: 'utf-8', shell: SHELL_OPT });
        const match = output.match(/transaction ID: '([^']+)'/);
        const txId = match ? match[1] : 'unknown';
        return { status: 'success', programName, txId };
    }

    async initializeL3(chainId, gasTokenId, sequencerAddress, initialSupply = 1000000) {
        const projectDir = path.join(__dirname, 'templates', `woo_genesis_${chainId}`);
        
        if (!fs.existsSync(projectDir)) {
            console.error(`\n ERRO: pasta do projeto '${projectDir}' não existe!`);
            return null;
        }

        const baseCmd = `"${LEO_CMD}" execute -y --broadcast --network ${process.env.NETWORK || 'testnet'} --endpoint ${process.env.ENDPOINT || 'https://api.explorer.provable.com/v1'} --consensus-version ${process.env.CONSENSUS_VERSION || 9} --private-key ${this.privateKey}`;
        
        try {
            console.log("Executando spawn_chain...");
            const spawnOutput = execSync(`${baseCmd} spawn_chain ${chainId}u64 ${gasTokenId}u64 ${sequencerAddress}`, { cwd: projectDir, encoding: 'utf-8', shell: SHELL_OPT });
            
            console.log(`Executando mint_gas (Suprimento: ${initialSupply})...`);
            execSync(`${baseCmd} mint_gas ${chainId}u64 ${initialSupply}u64 ${sequencerAddress}`, { cwd: projectDir, stdio: 'inherit', shell: SHELL_OPT });
            
            const recordMatch = spawnOutput.match(/{\s*owner:[\s\S]*?_version:[\s\S]*?}/);
            if (recordMatch) {
                let newRecord = recordMatch[0].replace(/\n/g, '').replace(/\s+/g, '');
                
                const dbPath = path.join(__dirname, `db_woo_genesis_${chainId}`);
                const db = new Level(dbPath, { valueEncoding: 'json' });
                
                await db.put('network_record', newRecord);
                await db.put('batch_id', 1);
                console.log(`\n estado Inicial salvo com suceso: ${dbPath}`);
            }

            updateEnvFile({ INITIAL_GAS_SUPPLY: initialSupply });

            return { status: 'success', message: 'rede iniciada!' };
        } catch (err) {
            console.error(err.message);
            return null;
        }
    }
}

const program = new Command();
program.name('woo-cli').description('CLI para L3 na Aleo').version('1.0.0');

function processOptionsAndSyncEnv(opts) {
    
    const pk = process.env.PRIVATE_KEY;
    
    if (!pk) {
        throw new Error('PRIVATE_KEY não definida! adcione no  .env.');
    }

    const envUpdates = {
        DEFAULT_CHAIN_ID: opts.chainId,
        DEFAULT_GAS_TOKEN_ID: opts.gasTokenId,
        L3_FOLDER_NAME: `woo_genesis_${opts.chainId}`
    };

    if (opts.sequencer) envUpdates.DEFAULT_SEQUENCER_ADDRESS = opts.sequencer;

    
    updateEnvFile(envUpdates);

    return pk;
}


program.command('full')
    .option('-c, --chain-id <number>', 'Chain ID', process.env.DEFAULT_CHAIN_ID)
    .option('-g, --gas-token-id <number>', 'Gas Token ID', process.env.DEFAULT_GAS_TOKEN_ID)
    .option('-s, --sequencer <address>', 'Sequenciador', process.env.DEFAULT_SEQUENCER_ADDRESS)
    .option('-m, --mint-supply <number>', 'Quantidade de Gás Inicial', '1000000')
    
    .action(async (opts) => {
        try {
            const pk = processOptionsAndSyncEnv(opts);
            const sdk = new WooSDK(pk);
            const deploy = await sdk.spawnL3(parseInt(opts.chainId), parseInt(opts.gasTokenId));
            if (deploy?.status === 'success') {
                await sdk.initializeL3(parseInt(opts.chainId), parseInt(opts.gasTokenId), opts.sequencer, parseInt(opts.mintSupply));
            } else {
                console.error('Deploy falhou!');
            }
        } catch (err) {
            console.error(" Erro fatal:", err);
        }
    });

program.parse();