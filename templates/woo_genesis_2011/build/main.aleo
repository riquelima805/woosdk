import credits.aleo;
program woo_genesis_2011.aleo;

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

function spawn_chain:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as address.public;
    cast self.signer r0 r1 r2 0u64 0field false into r3 as NetworkState.record;
    output r3 as NetworkState.record;

function pause_network:
    input r0 as NetworkState.record;
    assert.eq self.signer r0.owner;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r0.last_batch_id r0.last_state_root true into r1 as NetworkState.record;
    output r1 as NetworkState.record;

function commit_rollup:
    input r0 as NetworkState.record;
    input r1 as u64.public;
    input r2 as field.public;
    input r3 as field.public;
    assert.eq r0.is_paused false;
    assert.eq self.signer r0.sequencer;
    add r0.last_batch_id 1u64 into r4;
    assert.eq r1 r4;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r1 r2 false into r5 as NetworkState.record;
    cast self.signer r0.chain_id r1 r2 r3 into r6 as RollupBatch.record;
    output r5 as NetworkState.record;
    output r6 as RollupBatch.record;

function mint_gas:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as address.public;
    cast r2 r1 r0 into r3 as GasToken.record;
    output r3 as GasToken.record;

function stake_validator:
    input r0 as u64.public;
    input r1 as u64.public;
    cast self.signer r1 r0 into r2 as ValidatorTicket.record;
    output r2 as ValidatorTicket.record;

function slash_validator:
    input r0 as NetworkState.record;
    input r1 as ValidatorTicket.record;
    assert.eq self.signer r0.owner;
    assert.eq r1.chain_id r0.chain_id;
    cast r0.owner r0.chain_id r0.gas_token_id r0.sequencer r0.last_batch_id r0.last_state_root r0.is_paused into r2 as NetworkState.record;
    output r2 as NetworkState.record;

function authorize_relayer:
    input r0 as address.public;
    assert.eq self.caller aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
    async authorize_relayer r0 into r1;
    output r1 as woo_genesis_2011.aleo/authorize_relayer.future;

finalize authorize_relayer:
    input r0 as address.public;
    set true into authorized_relayers[r0];

function revoke_relayer:
    input r0 as address.public;
    assert.eq self.caller aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
    async revoke_relayer r0 into r1;
    output r1 as woo_genesis_2011.aleo/revoke_relayer.future;

finalize revoke_relayer:
    input r0 as address.public;
    remove authorized_relayers[r0];

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
    async bridge_in r7 into r8;
    output r6 as BridgeReceipt.record;
    output r8 as woo_genesis_2011.aleo/bridge_in.future;

finalize bridge_in:
    input r0 as credits.aleo/transfer_public_as_signer.future;
    await r0;

function bridge_out:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as address.public;
    gt r2 0u64 into r4;
    assert.eq r4 true;
    cast r3 r2 r1 r0 into r5 as BridgeOutReceipt.record;
    output r5 as BridgeOutReceipt.record;

constructor:
    assert.eq edition 0u16;
