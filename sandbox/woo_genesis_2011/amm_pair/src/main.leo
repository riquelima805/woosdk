
program amm_pair.aleo {
    
    mapping reserves_x: address => u64;
    mapping reserves_y: address => u64;
    mapping total_supply: address => u64;

    
    mapping balances_x: address => u64;
    mapping balances_y: address => u64;
    mapping balance_lp: address => u64;

    
    fn add_liquidity(
        public token_x_id: address,
        public token_y_id: address,
        public amount_x_desired: u64,
        public amount_y_desired: u64,
        public min_lp_out: u64
    ) -> Final {
        let caller: address = self.caller;
        let contract_address: address = self.address;

        return final {
            
            let user_x: u64 = balances_x.get_or_use(caller, 0u64);
            let user_y: u64 = balances_y.get_or_use(caller, 0u64);
            assert(user_x >= amount_x_desired);
            assert(user_y >= amount_y_desired);

            let reserve_x: u64 = reserves_x.get_or_use(token_x_id, 0u64);
            let reserve_y: u64 = reserves_y.get_or_use(token_y_id, 0u64);
            let total_lp: u64 = total_supply.get_or_use(contract_address, 0u64);

            let amount_x_optimal: u64 = reserve_y == 0u64 ? 0u64 : (amount_y_desired * reserve_x) / reserve_y;
            let amount_y_optimal: u64 = reserve_x == 0u64 ? 0u64 : (amount_x_desired * reserve_y) / reserve_x;

            let lp_minted_x: u64 = reserve_x == 0u64 ? 0u64 : (amount_x_optimal * total_lp) / reserve_x;
            let lp_minted_y: u64 = reserve_y == 0u64 ? 0u64 : (amount_y_optimal * total_lp) / reserve_y;

            let lp_minted_existing: u64 = amount_x_optimal <= amount_x_desired ? lp_minted_x : lp_minted_y;
            let lp_minted: u64 = total_lp == 0u64 ? (amount_x_desired + amount_y_desired) : lp_minted_existing;

            assert(lp_minted >= min_lp_out);

            
            balances_x.set(caller, user_x - amount_x_desired);
            balances_y.set(caller, user_y - amount_y_desired);

            
            reserves_x.set(token_x_id, reserve_x + amount_x_desired);
            reserves_y.set(token_y_id, reserve_y + amount_y_desired);
            total_supply.set(contract_address, total_lp + lp_minted);
            
            
            let user_lp_balance: u64 = balance_lp.get_or_use(caller, 0u64);
            balance_lp.set(caller, user_lp_balance + lp_minted);
        };
    }

    
    fn swap_x_for_y(
        public token_x_id: address,
        public token_y_id: address,
        public amount_x_in: u64,
        public min_amount_y_out: u64
    ) -> Final {
        let caller: address = self.caller;

        return final {
            
            let user_x: u64 = balances_x.get_or_use(caller, 0u64);
            assert(user_x >= amount_x_in);

            let reserve_x: u64 = reserves_x.get_or_use(token_x_id, 0u64);
            let reserve_y: u64 = reserves_y.get_or_use(token_y_id, 0u64);

            let amount_x_in_with_fee: u64 = amount_x_in * 997u64;
            let numerator: u64 = amount_x_in_with_fee * reserve_y;
            let denominator: u64 = (reserve_x * 1000u64) + amount_x_in_with_fee;
            let amount_y_out: u64 = numerator / denominator;

            assert(amount_y_out >= min_amount_y_out);
            assert(amount_y_out <= reserve_y);

           
            reserves_x.set(token_x_id, reserve_x + amount_x_in);
            reserves_y.set(token_y_id, reserve_y - amount_y_out);

            
            let user_y: u64 = balances_y.get_or_use(caller, 0u64);
            balances_x.set(caller, user_x - amount_x_in);
            balances_y.set(caller, user_y + amount_y_out);
        };
    }

    
    fn swap_y_for_x(
        public token_x_id: address,
        public token_y_id: address,
        public amount_y_in: u64,
        public min_amount_x_out: u64
    ) -> Final {
        let caller: address = self.caller;

        return final {
            let user_y: u64 = balances_y.get_or_use(caller, 0u64);
            assert(user_y >= amount_y_in);

            let reserve_x: u64 = reserves_x.get_or_use(token_x_id, 0u64);
            let reserve_y: u64 = reserves_y.get_or_use(token_y_id, 0u64);

            let amount_y_in_with_fee: u64 = amount_y_in * 997u64;
            let numerator: u64 = amount_y_in_with_fee * reserve_x;
            let denominator: u64 = (reserve_y * 1000u64) + amount_y_in_with_fee;
            let amount_x_out: u64 = numerator / denominator;

            assert(amount_x_out >= min_amount_x_out);
            assert(amount_x_out <= reserve_x);

            reserves_y.set(token_y_id, reserve_y + amount_y_in);
            reserves_x.set(token_x_id, reserve_x - amount_x_out);

            let user_x: u64 = balances_x.get_or_use(caller, 0u64);
            balances_y.set(caller, user_y - amount_y_in);
            balances_x.set(caller, user_x + amount_x_out);
        };
    }

    
    
    
    fn deposit_x(public token_id: address, public amount: u64) -> Final {
        let caller: address = self.caller;
        return final {
            let current: u64 = balances_x.get_or_use(caller, 0u64);
            balances_x.set(caller, current + amount);
        };
    }

    fn withdraw_x(public token_id: address, public amount: u64) -> Final {
        let caller: address = self.caller;
        return final {
            let current: u64 = balances_x.get_or_use(caller, 0u64);
            assert(current >= amount);
            balances_x.set(caller, current - amount);
        };
    }

    
    
    fn deposit_y(public token_id: address, public amount: u64) -> Final {
        let caller: address = self.caller;
        return final {
            let current: u64 = balances_y.get_or_use(caller, 0u64);
            balances_y.set(caller, current + amount);
        };
    }

    fn withdraw_y(public token_id: address, public amount: u64) -> Final {
        let caller: address = self.caller;
        return final {
            let current: u64 = balances_y.get_or_use(caller, 0u64);
            assert(current >= amount);
            balances_y.set(caller, current - amount);
        };
    }
}