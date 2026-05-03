import credits.aleo;
program woo_genesis_1988.aleo;

record NetworkState:
    owner as address.private;
    chain_id as u64.private;
    gas_token_id as u64.private;
    sequencer as address.private;
    last_batch_id as u64.private;
    last_state_root as field.private;
    is_paused as boolean.private;

record GasToken:
    owner as address.private;
    amount as u64.private;
    chain_id as u64.private;

record ValidatorTicket:
    owner as address.private;
    staked_amount as u64.private;
    chain_id as u64.private;

record BridgeReceipt:
    owner as address.private;
    amount as u64.private;
    token_id as u64.private;
    chain_id as u64.private;

record BridgeOutReceipt:
    owner as address.private;
    amount as u64.private;
    fee_retained as u64.private;
    token_id as u64.private;
    chain_id as u64.private;

record RollupBatch:
    owner as address.private;
    chain_id as u64.private;
    batch_id as u64.private;
    state_root as field.private;
    txs_hash as field.private;

mapping authorized_relayers:
    key as address.public;
    value as boolean.public;

mapping authorized_vaults:
    key as address.public;
    value as boolean.public;

mapping is_initialized:
    key as u8.public;
    value as boolean.public;

mapping roles:
    key as u8.public;
    value as address.public;

mapping bridge_stats:
    key as u8.public;
    value as u64.public;

mapping slashed_validators:
    key as address.public;
    value as boolean.public;

mapping validator_stakes:
    key as address.public;
    value as u64.public;

mapping supported_chains:
    key as u64.public;
    value as boolean.public;

function transfer_admin:
    input r0 as address.public;
    async transfer_admin self.caller r0 into r1;
    output r1 as woo_genesis_1988.aleo/transfer_admin.future;

finalize transfer_admin:
    input r0 as address.public;
    input r1 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r2;
    assert.eq r0 r2;
    set r1 into roles[1u8];

function accept_admin:
    async accept_admin self.caller into r0;
    output r0 as woo_genesis_1988.aleo/accept_admin.future;

finalize accept_admin:
    input r0 as address.public;
    get roles[1u8] into r1;
    assert.eq r0 r1;
    set r1 into roles[0u8];
    remove roles[1u8];

function initialize_bridge:
    input r0 as address.public;
    async initialize_bridge self.caller r0 into r1;
    output r1 as woo_genesis_1988.aleo/initialize_bridge.future;

finalize initialize_bridge:
    input r0 as address.public;
    input r1 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r2;
    assert.eq r0 r2;
    get.or_use is_initialized[0u8] false into r3;
    assert.eq r3 false;
    set true into is_initialized[0u8];
    set true into authorized_vaults[r1];

function spawn_chain:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as address.public;
    cast self.signer r0 r1 r2 0u64 0field false into r3 as NetworkState.record;
    async spawn_chain self.caller r0 into r4;
    output r3 as NetworkState.record;
    output r4 as woo_genesis_1988.aleo/spawn_chain.future;

finalize spawn_chain:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r2;
    assert.eq r0 r2;
    set true into supported_chains[r1];

function pause_network:
    input r0 as NetworkState.record;
    assert.eq self.signer r0.owner;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r0.last_batch_id r0.last_state_root true into r1 as NetworkState.record;
    output r1 as NetworkState.record;

function unpause_network:
    input r0 as NetworkState.record;
    assert.eq self.signer r0.owner;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r0.last_batch_id r0.last_state_root false into r1 as NetworkState.record;
    output r1 as NetworkState.record;

function emergency_drain:
    input r0 as u64.public;
    input r1 as address.public;
    lte r0 100000000000u64 into r2;
    assert.eq r2 true;
    call credits.aleo/transfer_public_as_signer r1 r0 into r3;
    async emergency_drain self.caller r1 r3 into r4;
    output r4 as woo_genesis_1988.aleo/emergency_drain.future;

finalize emergency_drain:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as credits.aleo/transfer_public_as_signer.future;
    get.or_use authorized_vaults[r0] false into r3;
    assert.eq r3 true;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r4;
    assert.eq r1 r4;
    await r2;

function commit_rollup:
    input r0 as NetworkState.record;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as field.public;
    assert.eq r0.is_paused false;
    assert.eq self.signer r0.sequencer;
    assert.eq r0.chain_id r1;
    add r0.last_batch_id 1u64 into r5;
    assert.eq r2 r5;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r2 r3 false into r6 as NetworkState.record;
    cast self.signer r0.chain_id r2 r3 r4 into r7 as RollupBatch.record;
    output r6 as NetworkState.record;
    output r7 as RollupBatch.record;

function mint_gas:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as address.public;
    cast r2 r1 r0 into r3 as GasToken.record;
    async mint_gas self.caller into r4;
    output r3 as GasToken.record;
    output r4 as woo_genesis_1988.aleo/mint_gas.future;

finalize mint_gas:
    input r0 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r1;
    assert.eq r0 r1;

function stake_validator:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as address.public;
    cast self.signer r1 r0 into r3 as ValidatorTicket.record;
    call credits.aleo/transfer_public_as_signer r2 r1 into r4;
    async stake_validator r2 self.signer r1 r4 into r5;
    output r3 as ValidatorTicket.record;
    output r5 as woo_genesis_1988.aleo/stake_validator.future;

finalize stake_validator:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as credits.aleo/transfer_public_as_signer.future;
    get.or_use authorized_vaults[r0] false into r4;
    assert.eq r4 true;
    get.or_use validator_stakes[r1] 0u64 into r5;
    add r5 r2 into r6;
    set r6 into validator_stakes[r1];
    await r3;

function slash_validator:
    input r0 as NetworkState.record;
    input r1 as ValidatorTicket.record;
    assert.eq self.signer r0.owner;
    assert.eq r1.chain_id r0.chain_id;
    async slash_validator r1.owner into r2;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r0.last_batch_id r0.last_state_root r0.is_paused into r3 as NetworkState.record;
    output r3 as NetworkState.record;
    output r2 as woo_genesis_1988.aleo/slash_validator.future;

finalize slash_validator:
    input r0 as address.public;
    set true into slashed_validators[r0];

function slash_and_seize:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as address.public;
    async slash_and_seize self.caller r0 r2 into r3;
    output r3 as woo_genesis_1988.aleo/slash_and_seize.future;

finalize slash_and_seize:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r3;
    assert.eq r0 r3;
    get.or_use slashed_validators[r1] false into r4;
    assert.eq r4 true;
    get.or_use authorized_vaults[r2] false into r5;
    assert.eq r5 true;
    get.or_use validator_stakes[r1] 0u64 into r6;
    gt r6 0u64 into r7;
    assert.eq r7 true;
    set 0u64 into validator_stakes[r1];

function authorize_relayer:
    input r0 as address.public;
    async authorize_relayer self.caller r0 into r1;
    output r1 as woo_genesis_1988.aleo/authorize_relayer.future;

finalize authorize_relayer:
    input r0 as address.public;
    input r1 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r2;
    assert.eq r0 r2;
    set true into authorized_relayers[r1];

function revoke_relayer:
    input r0 as address.public;
    async revoke_relayer self.caller r0 into r1;
    output r1 as woo_genesis_1988.aleo/revoke_relayer.future;

finalize revoke_relayer:
    input r0 as address.public;
    input r1 as address.public;
    get.or_use roles[0u8] aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3 into r2;
    assert.eq r0 r2;
    remove authorized_relayers[r1];

function bridge_in:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as address.public;
    input r4 as address.public;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    cast r3 r2 r1 r0 into r6 as BridgeReceipt.record;
    call credits.aleo/transfer_public_as_signer r4 r2 into r7;
    async bridge_in r4 r0 r2 r7 into r8;
    output r6 as BridgeReceipt.record;
    output r8 as woo_genesis_1988.aleo/bridge_in.future;

finalize bridge_in:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as credits.aleo/transfer_public_as_signer.future;
    get.or_use authorized_vaults[r0] false into r4;
    assert.eq r4 true;
    get.or_use supported_chains[r1] false into r5;
    assert.eq r5 true;
    get.or_use bridge_stats[0u8] 0u64 into r6;
    add r6 r2 into r7;
    gte r7 r6 into r8;
    assert.eq r8 true;
    set r7 into bridge_stats[0u8];
    await r3;

function bridge_out:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as address.public;
    assert.eq r1 0u64;
    gt r2 r3 into r5;
    assert.eq r5 true;
    sub r2 r3 into r6;
    cast r4 r2 r3 r1 r0 into r7 as BridgeOutReceipt.record;
    call credits.aleo/transfer_public_as_signer r4 r6 into r8;
    async bridge_out self.caller r0 r2 r8 into r9;
    output r7 as BridgeOutReceipt.record;
    output r9 as woo_genesis_1988.aleo/bridge_out.future;

finalize bridge_out:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as credits.aleo/transfer_public_as_signer.future;
    get.or_use authorized_vaults[r0] false into r4;
    assert.eq r4 true;
    get.or_use supported_chains[r1] false into r5;
    assert.eq r5 true;
    get.or_use bridge_stats[1u8] 0u64 into r6;
    add r6 r2 into r7;
    gte r7 r6 into r8;
    assert.eq r8 true;
    set r7 into bridge_stats[1u8];
    await r3;

constructor:
    assert.eq edition 0u16;
