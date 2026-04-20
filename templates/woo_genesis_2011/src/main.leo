import credits.aleo;

program woo_genesis_2011.aleo {

    
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
}