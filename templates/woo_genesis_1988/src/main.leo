import credits.aleo;

program woo_genesis_1988.aleo {

    

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

    
    // ADMIN
    

    fn transfer_admin(public new_admin: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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

            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
            let current_admin: address = roles.get_or_use(0u8, default_admin);
            assert_eq(caller_address, current_admin);
            authorized_relayers.set(relayer, true);
        };
    }

    fn revoke_relayer(public relayer: address) -> Final {
        let caller_address: address = self.caller;
        return final {
            let default_admin: address = aleo1s69ylwn0x29fudj6jep5y2ljlr36964537zpe0vexmk5syyjpy8swdazp3;
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
}